import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { runRunbook } from "../lib/runner.js";
import { formatJunit } from "../lib/reporter.js";

let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    if (req.url === "/page-a") {
      res.end("<html><head><title>Page A</title></head><body>Page A content</body></html>");
    } else if (req.url === "/page-b") {
      res.end("<html><head><title>Page B</title></head><body>Page B content</body></html>");
    } else {
      res.end("<html><head><title>Home</title></head><body>Home page</body></html>");
    }
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => server.close());

const TMP = join(import.meta.dirname, "__tmp_advanced_test__");

beforeEach(async () => {
  await mkdir(join(TMP, "flows"), { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("ADV-1: sub-flows", () => {
  it("executes a sub-flow and inlines results", async () => {
    // Write a sub-flow
    await writeFile(
      join(TMP, "flows", "goto-a.yaml"),
      yaml.dump({
        name: "goto-a",
        steps: [
          { goto: "/page-a" },
          { assert: { title: "Page A" } },
        ],
      })
    );

    const result = await runRunbook({
      runbook: {
        name: "test-subflow",
        site: `http://127.0.0.1:${port}`,
        __filePath: join(TMP, "main.yaml"),
        steps: [
          { goto: "/" },
          { assert: { title: "Home" } },
          { run: "flows/goto-a" },
          { assert: { title: "Page A" } },
        ],
      },
      headless: true,
    });

    // Sub-flow steps should be inlined (2 from main before run, 2 from sub-flow, 1 after)
    assert.equal(result.passed, 5);
    assert.equal(result.failed, 0);
  });

  it("resolves .yaml extension automatically", async () => {
    await writeFile(
      join(TMP, "flows", "simple.yaml"),
      yaml.dump({ name: "simple", steps: [{ goto: "/page-b" }] })
    );

    const result = await runRunbook({
      runbook: {
        name: "test-auto-ext",
        site: `http://127.0.0.1:${port}`,
        __filePath: join(TMP, "main.yaml"),
        steps: [{ run: "flows/simple" }],
      },
      headless: true,
    });

    assert.equal(result.failed, 0);
  });

  it("fails clearly when sub-flow not found", async () => {
    const result = await runRunbook({
      runbook: {
        name: "test-missing-flow",
        site: `http://127.0.0.1:${port}`,
        __filePath: join(TMP, "main.yaml"),
        steps: [{ run: "flows/nonexistent" }],
      },
      headless: true,
    });

    assert.equal(result.failed, 1);
    assert.ok(result.steps[0].reason.includes("Sub-flow not found"));
  });
});

describe("ADV-3: continue-on-error", () => {
  it("stops on first failure by default", async () => {
    const result = await runRunbook({
      runbook: {
        name: "test-failfast",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/" },
          { assert: { title: "Wrong Title" } },
          { assert: { title: "Home" } }, // Should not run
        ],
      },
      headless: true,
    });

    assert.equal(result.steps.length, 2); // Only 2 steps ran
    assert.equal(result.failed, 1);
  });

  it("runs all steps when continueOnError is true", async () => {
    const result = await runRunbook({
      runbook: {
        name: "test-continue",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/" },
          { assert: { title: "Wrong Title" } },
          { assert: { title: "Home" } }, // Should still run
        ],
      },
      headless: true,
      continueOnError: true,
    });

    assert.equal(result.steps.length, 3); // All 3 steps ran
    assert.equal(result.failed, 1);
    assert.equal(result.passed, 2);
  });
});

describe("ADV-4: JUnit XML", () => {
  it("generates valid JUnit XML structure", () => {
    const result = {
      runbook: "test-suite",
      passed: 2,
      failed: 1,
      duration_ms: 1500,
      steps: [
        { type: "goto", label: "goto /", status: "passed", duration_ms: 100 },
        { type: "assert", label: "assert title", status: "passed", duration_ms: 5 },
        { type: "assert", label: "assert url", status: "failed", duration_ms: 3, reason: "Expected /foo, got /bar" },
      ],
    };

    const xml = formatJunit(result);
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes("<testsuites"));
    assert.ok(xml.includes('<testsuite name="test-suite"'));
    assert.ok(xml.includes('tests="3"'));
    assert.ok(xml.includes('failures="1"'));
    assert.ok(xml.includes("<failure"));
    assert.ok(xml.includes("Expected /foo, got /bar"));
  });

  it("escapes XML special characters", () => {
    const result = {
      runbook: "test <special> & \"chars\"",
      passed: 0,
      failed: 1,
      duration_ms: 100,
      steps: [
        { type: "assert", label: 'assert <a href="/">', status: "failed", duration_ms: 1, reason: "a < b & c > d" },
      ],
    };

    const xml = formatJunit(result);
    assert.ok(xml.includes("&lt;special&gt;"));
    assert.ok(xml.includes("&amp;"));
    assert.ok(xml.includes("&quot;"));
    assert.ok(!xml.includes("<special>"));
  });
});
