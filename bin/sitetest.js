#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { runRunbook } from "../lib/runner.js";
import { printResult } from "../lib/reporter.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    headless: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    port: { type: "string", short: "p", default: "9222" },
    env: { type: "string", short: "e" },
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

Options:
  -p, --port <port>    Chrome DevTools port (default: 9222)
  -e, --env <path>     Path to .env file (default: .env)
  --headless           Launch headless Chrome instead of attaching to running Chrome
  -h, --help           Show this help

Examples:
  sitetest run tests/login-flow.yaml
  sitetest run tests/
  sitetest run tests/login-flow.yaml --headless
`);
  process.exit(0);
}

if (command === "run") {
  if (targets.length === 0) {
    console.error("Error: no runbook file or directory specified.");
    process.exit(1);
  }

  const runbookPaths = [];
  for (const target of targets) {
    const resolved = resolve(target);
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const files = await readdir(resolved);
      for (const f of files) {
        if (f.endsWith(".yaml") || f.endsWith(".yml")) {
          runbookPaths.push(resolve(resolved, f));
        }
      }
    } else {
      runbookPaths.push(resolved);
    }
  }

  if (runbookPaths.length === 0) {
    console.error("Error: no .yaml/.yml runbook files found.");
    process.exit(1);
  }

  let totalPassed = 0;
  let totalFailed = 0;

  for (const path of runbookPaths) {
    try {
      const result = await runRunbook({
        runbook: path,
        cdpPort: parseInt(values.port, 10),
        headless: values.headless,
        dotenvPath: values.env ? resolve(values.env) : undefined,
      });

      printResult(result);
      totalPassed += result.passed;
      totalFailed += result.failed;
    } catch (err) {
      console.error(`\nError running ${path}: ${err.message}`);
      totalFailed++;
    }
  }

  process.exit(totalFailed > 0 ? 1 : 0);
} else {
  console.error(`Unknown command: ${command}. Run "sitetest --help" for usage.`);
  process.exit(1);
}
