import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { chromium } from "playwright";
import { setupNetworkCapture, setupConsoleCapture } from "sitecap/lib/capture.js";
import { executeStep } from "./steps.js";
import { buildEnv, validateEnvVars } from "./env.js";

/**
 * Parse a YAML runbook file into a runbook object.
 *
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function parseRunbook(filePath) {
  const content = await readFile(resolve(filePath), "utf-8");
  const runbook = yaml.load(content);
  if (!runbook || !Array.isArray(runbook.steps)) {
    throw new Error(`Invalid runbook: ${filePath} — missing "steps" array`);
  }
  return runbook;
}

/**
 * Execute a runbook against a live page.
 *
 * @param {object} opts
 * @param {string|object} opts.runbook - Path to YAML file or parsed runbook object
 * @param {number} [opts.cdpPort] - CDP port. Default: 9222.
 * @param {boolean} [opts.headless] - Launch headless Chrome instead of CDP attach. Default: false.
 * @param {Record<string, string>} [opts.env] - Explicit env var overrides.
 * @param {string} [opts.dotenvPath] - Path to .env file.
 * @returns {Promise<{runbook: string, passed: number, failed: number, duration_ms: number, steps: object[]}>}
 */
export async function runRunbook(opts) {
  const runbook = typeof opts.runbook === "string" ? await parseRunbook(opts.runbook) : opts.runbook;
  const cdpPort = opts.cdpPort ?? 9222;
  const headless = opts.headless ?? false;

  // Build env
  const env = await buildEnv({ dotenvPath: opts.dotenvPath, overrides: opts.env });

  // Validate all $VAR references before executing any steps
  validateEnvVars(runbook.steps, env);

  // Connect to browser
  let browser;
  let shouldCloseBrowser = false;

  if (headless) {
    browser = await chromium.launch({ headless: true });
    shouldCloseBrowser = true;
  } else {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    } catch {
      throw new Error(
        `Failed to connect to Chrome on port ${cdpPort}.\n` +
          `Start Chrome with: google-chrome --remote-debugging-port=${cdpPort}\n` +
          `Or use --headless to launch a clean browser.`
      );
    }
  }

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    // Set up network + console capture for assertion support
    setupNetworkCapture(page);
    setupConsoleCapture(page);

    const ctx = {
      env,
      site: runbook.site || "",
      previousUrl: "",
      captures: [],
    };

    const stepResults = [];
    const totalStart = Date.now();
    let passed = 0;
    let failed = 0;

    for (const step of runbook.steps) {
      ctx.previousUrl = page.url();
      const result = await executeStep(step, page, ctx);
      stepResults.push(result);

      if (result.status === "passed") {
        passed++;
      } else {
        failed++;
        // Fail-fast by default
        break;
      }
    }

    await page.close();

    return {
      runbook: runbook.name || "unnamed",
      passed,
      failed,
      duration_ms: Date.now() - totalStart,
      steps: stepResults,
    };
  } finally {
    if (shouldCloseBrowser) {
      await browser.close();
    }
  }
}
