import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { capturePage } from "sitecap/lib/capture.js";
import { waitForSettle } from "./settle.js";
import { evaluateAssertions } from "./assertions.js";
import { resolveEnvVars } from "./env.js";
import { saveBaseline, baselineExists, baselinePath } from "./baseline.js";
import { diffCaptures } from "./diff.js";

/**
 * @typedef {object} StepResult
 * @property {string} type - Step type (goto, click, fill, etc.)
 * @property {string} label - Human-readable description
 * @property {"passed"|"failed"} status
 * @property {number} duration_ms
 * @property {string} [reason] - Failure reason
 * @property {Array} [failures] - Assertion failures (for assert steps)
 */

const DEFAULT_TIMEOUTS = {
  goto: 30_000,
  click: 10_000,
  fill: 5_000,
  select: 5_000,
  check: 5_000,
  uncheck: 5_000,
  press: 5_000,
  scroll: 5_000,
  hover: 5_000,
  wait: 30_000,
  assert: 10_000,
  capture: 30_000,
};

/**
 * Parse a raw step object from YAML into { type, def }.
 * YAML steps are either `{ type: value }` or `{ type: { ...opts } }`.
 *
 * @param {object} rawStep
 * @returns {{ type: string, def: any }}
 */
export function parseStep(rawStep) {
  const keys = Object.keys(rawStep);
  // Filter out 'timeout' — it's a meta key, not a step type
  const stepKeys = keys.filter((k) => k !== "timeout");
  if (stepKeys.length !== 1) {
    throw new Error(`Invalid step: expected exactly one step type, got: ${stepKeys.join(", ")}`);
  }
  const type = stepKeys[0];
  return { type, def: rawStep[type], timeout: rawStep.timeout };
}

/**
 * Execute a single step.
 *
 * @param {object} rawStep - Raw step from runbook
 * @param {import('playwright').Page} page
 * @param {object} ctx - Runner context
 * @param {Record<string, string>} ctx.env - Resolved env vars
 * @param {string} ctx.site - Base site URL
 * @param {string} ctx.previousUrl - URL before this step
 * @returns {Promise<StepResult>}
 */
export async function executeStep(rawStep, page, ctx) {
  const { type, def, timeout: customTimeout } = parseStep(rawStep);
  const timeout = customTimeout ?? DEFAULT_TIMEOUTS[type] ?? 10_000;
  const start = Date.now();

  const result = { type, label: stepLabel(type, def), status: "passed", duration_ms: 0 };

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Step timed out after ${timeout}ms`)), timeout)
    );
    const stepPromise = executeStepInner(type, def, page, ctx);
    const stepResult = await Promise.race([stepPromise, timeoutPromise]);

    // Assert steps return failures array
    if (type === "assert" && stepResult && stepResult.length > 0) {
      result.status = "failed";
      result.failures = stepResult;
      result.reason = stepResult.map((f) => f.message).join("; ");
    }
  } catch (err) {
    result.status = "failed";
    result.reason = err.message;
  }

  result.duration_ms = Date.now() - start;
  return result;
}

/**
 * @param {string} type
 * @param {any} def
 * @param {import('playwright').Page} page
 * @param {object} ctx
 */
async function executeStepInner(type, def, page, ctx) {
  switch (type) {
    case "goto": {
      const url = resolveUrl(resolveEnvVars(def, ctx.env), ctx.site);
      await page.goto(url, { waitUntil: "load" });
      // Force cookie jar sync — workaround for Playwright headless cookie bug
      // (issues #12884, #31736). Reading cookies forces the browser to flush
      // Set-Cookie headers from redirect chains into the context cookie jar.
      await page.context().cookies();
      return;
    }

    case "click": {
      const selector = typeof def === "string" ? def : def.selector;
      await page.locator(resolveEnvVars(selector, ctx.env)).click();
      // Flush cookies after click — clicks can trigger navigation with
      // server-side redirects that set cookies (e.g. OAuth/NextAuth flows).
      await page.context().cookies();
      return;
    }

    case "fill": {
      const selector = resolveEnvVars(def.selector, ctx.env);
      const value = resolveEnvVars(def.value, ctx.env);
      await page.locator(selector).fill(value);
      return;
    }

    case "select": {
      const selector = resolveEnvVars(def.selector, ctx.env);
      const value = resolveEnvVars(def.value, ctx.env);
      await page.locator(selector).selectOption(value);
      return;
    }

    case "check": {
      const selector = typeof def === "string" ? def : def.selector;
      await page.locator(resolveEnvVars(selector, ctx.env)).check();
      return;
    }

    case "uncheck": {
      const selector = typeof def === "string" ? def : def.selector;
      await page.locator(resolveEnvVars(selector, ctx.env)).uncheck();
      return;
    }

    case "press": {
      const key = typeof def === "string" ? def : def.key;
      await page.keyboard.press(key);
      return;
    }

    case "scroll": {
      if (typeof def === "string" || (def && def.selector)) {
        const selector = typeof def === "string" ? def : def.selector;
        await page.locator(selector).scrollIntoViewIfNeeded();
      } else if (def && (def.x !== undefined || def.y !== undefined)) {
        await page.evaluate(({ x, y }) => window.scrollTo(x ?? 0, y ?? 0), def);
      }
      return;
    }

    case "hover": {
      const selector = typeof def === "string" ? def : def.selector;
      await page.locator(resolveEnvVars(selector, ctx.env)).hover();
      return;
    }

    case "wait": {
      if (def === "settle") {
        await waitForSettle(page);
      } else if (typeof def === "object") {
        if (def.selector) {
          await page.locator(def.selector).waitFor({ state: "visible" });
        } else if (def.url) {
          await page.waitForURL(def.url.startsWith("~") ? new RegExp(def.url.slice(1)) : `**${def.url}`);
        } else if (def.ms) {
          await page.waitForTimeout(def.ms);
        }
      }
      return;
    }

    case "assert": {
      return evaluateAssertions(def, page, ctx);
    }

    case "capture": {
      const captureName = def.name || "unnamed";
      const isBaseline = !!def.baseline;
      const isDiff = !!def.diff;

      if (isBaseline && isDiff) {
        throw new Error(`Capture "${captureName}": baseline and diff cannot both be true`);
      }

      // Capture to a temp directory
      const captureOutDir = resolve(ctx.capturesDir, captureName);
      await mkdir(captureOutDir, { recursive: true });
      await capturePage(page, captureOutDir, {
        types: ["screenshot", "accessibility", "console", "network", "storage"],
      });

      if (isBaseline) {
        await saveBaseline(captureName, captureOutDir, ctx.baselinesDir);
        return;
      }

      if (isDiff) {
        const hasBaseline = await baselineExists(captureName, ctx.baselinesDir);
        if (!hasBaseline) {
          throw new Error(`Capture "${captureName}": no baseline found. Run with baseline: true first.`);
        }
        const baseDir = baselinePath(captureName, ctx.baselinesDir);
        const diffs = await diffCaptures(captureOutDir, baseDir, {
          screenshotThreshold: def.threshold,
        });
        const failures = diffs.filter((d) => !d.passed);
        if (failures.length > 0) {
          ctx.keepCaptures = true;
          const reasons = failures.map((f) => `${f.type}: ${f.reason}`);
          throw new Error(reasons.join("; "));
        }
      }

      return;
    }

    case "run": {
      // Phase 4 — sub-flows
      throw new Error(`Sub-flows (run step) not yet implemented`);
    }

    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

function resolveUrl(urlOrPath, site) {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return urlOrPath;
  }
  if (site) {
    return new URL(urlOrPath, site).href;
  }
  return urlOrPath;
}

function stepLabel(type, def) {
  switch (type) {
    case "goto":
      return `goto ${typeof def === "string" ? def : def}`;
    case "click":
      return `click ${typeof def === "string" ? def : def.selector}`;
    case "fill":
      return `fill ${def.selector}`;
    case "select":
      return `select ${def.selector}`;
    case "check":
      return `check ${typeof def === "string" ? def : def.selector}`;
    case "uncheck":
      return `uncheck ${typeof def === "string" ? def : def.selector}`;
    case "press":
      return `press ${typeof def === "string" ? def : def.key}`;
    case "scroll":
      return `scroll ${typeof def === "string" ? def : def.selector || `${def.x},${def.y}`}`;
    case "hover":
      return `hover ${typeof def === "string" ? def : def.selector}`;
    case "wait":
      return `wait ${typeof def === "string" ? def : JSON.stringify(def)}`;
    case "assert": {
      const keys = Object.keys(def);
      return `assert ${keys.join(", ")}`;
    }
    case "capture":
      return `capture "${def.name || "unnamed"}"`;
    case "run":
      return `run ${def}`;
    default:
      return type;
  }
}
