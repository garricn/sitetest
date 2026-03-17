#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { runRunbook } from "../lib/runner.js";
import { updateBaselines } from "../lib/baseline.js";
import { discover } from "../lib/discover.js";
import { printResult, formatJson, formatJunit } from "../lib/reporter.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    headless: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    port: { type: "string", short: "p", default: "9222" },
    env: { type: "string", short: "e" },
    out: { type: "string", short: "o" },
    output: { type: "string" },
    site: { type: "string", short: "s" },
    sitegrade: { type: "string" },
    video: { type: "boolean", default: false },
    "continue-on-error": { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0];
const targets = positionals.slice(1);

if (values.help || !command) {
  console.log(`sitetest — behavior test engine for web UIs

Usage:
  sitetest run <runbook.yaml>              Run a single runbook
  sitetest run <dir>                       Run all runbooks in directory
  sitetest run <runbook.yaml> --headless   Launch headless Chrome (default: attach via CDP)
  sitetest discover <sitecap-dir>          Discover testable behaviors from sitecap output
  sitetest update <runbook.yaml>           Accept current captures as new baselines
  sitetest update <dir> --all              Accept all captures in directory

Options:
  -p, --port <port>        Chrome DevTools port (default: 9222)
  -e, --env <path>         Path to .env file (default: .env)
  -o, --out <dir>          Output directory for discovered runbooks (default: ./runbooks)
  -s, --site <url>         Base site URL (for discover; auto-detected from meta.json)
  --output <format>        Output format: terminal (default), json, junit
  --sitegrade <file>       Sitegrade findings JSON (for discover; optional)
  --headless               Launch headless Chrome instead of attaching to running Chrome
  --video                  Record video of test run (.webm in captures directory)
  --continue-on-error      Run all steps even after failures
  --all                    Update all runbooks in directory (for update command)
  -h, --help               Show this help

Examples:
  sitetest run tests/login-flow.yaml
  sitetest run tests/
  sitetest run tests/login-flow.yaml --headless
  sitetest discover ./captures/example.com -o ./runbooks
  sitetest discover ./captures/example.com --sitegrade findings.json
  sitetest update tests/login-flow.yaml
  sitetest update tests/ --all
`);
  process.exit(0);
}

async function collectRunbooks(targets) {
  const paths = [];
  for (const target of targets) {
    const resolved = resolve(target);
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const files = await readdir(resolved);
      for (const f of files) {
        if (f.endsWith(".yaml") || f.endsWith(".yml")) {
          paths.push(resolve(resolved, f));
        }
      }
    } else {
      paths.push(resolved);
    }
  }
  return paths;
}

if (command === "run") {
  if (targets.length === 0) {
    console.error("Error: no runbook file or directory specified.");
    process.exit(1);
  }

  const runbookPaths = await collectRunbooks(targets);

  if (runbookPaths.length === 0) {
    console.error("Error: no .yaml/.yml runbook files found.");
    process.exit(1);
  }

  let totalFailed = 0;
  const allResults = [];

  for (const path of runbookPaths) {
    try {
      const result = await runRunbook({
        runbook: path,
        cdpPort: parseInt(values.port, 10),
        headless: values.headless,
        video: values.video,
        dotenvPath: values.env ? resolve(values.env) : undefined,
        continueOnError: values["continue-on-error"],
      });

      allResults.push(result);
      if (!values.output || values.output === "terminal") {
        printResult(result);
      }
      totalFailed += result.failed;
    } catch (err) {
      console.error(`\nError running ${path}: ${err.message}`);
      totalFailed++;
    }
  }

  if (values.output === "json") {
    console.log(formatJson(allResults.length === 1 ? allResults[0] : allResults));
  } else if (values.output === "junit") {
    console.log(formatJunit(allResults));
  }

  process.exit(totalFailed > 0 ? 1 : 0);
} else if (command === "update") {
  if (targets.length === 0) {
    console.error("Error: no runbook file or directory specified.");
    process.exit(1);
  }

  const runbookPaths = await collectRunbooks(targets);

  if (runbookPaths.length === 0) {
    console.error("Error: no .yaml/.yml runbook files found.");
    process.exit(1);
  }

  for (const path of runbookPaths) {
    try {
      const updated = await updateBaselines(path);
      console.log(`Updated baselines for ${path}: ${updated.join(", ")}`);
    } catch (err) {
      console.error(`Error updating ${path}: ${err.message}`);
      process.exit(1);
    }
  }
} else if (command === "discover") {
  if (targets.length === 0) {
    console.error("Error: no sitecap directory specified.");
    process.exit(1);
  }

  const sitecapDir = resolve(targets[0]);

  let sitegradeFindings;
  if (values.sitegrade) {
    try {
      const raw = await readFile(resolve(values.sitegrade), "utf-8");
      sitegradeFindings = JSON.parse(raw);
    } catch (err) {
      console.error(`Error reading sitegrade findings: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    const results = await discover({
      sitecapDir,
      outDir: values.out ? resolve(values.out) : undefined,
      site: values.site,
      sitegradeFindings,
    });

    if (results.length === 0) {
      console.log("No testable elements found.");
    } else {
      for (const r of results) {
        console.log(`${r.name}: ${r.testable}/${r.elements} testable elements → ${r.path}`);
      }
      console.log(`\n${results.length} runbook(s) generated.`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}. Run "sitetest --help" for usage.`);
  process.exit(1);
}
