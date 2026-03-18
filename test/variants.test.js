import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRunbook } from "../lib/runner.js";

let server;
let port;
let tempDir;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sitetest-variants-"));

  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html>
      <head><title>Responsive</title></head>
      <body>
        <h1>Hello</h1>
        <p class="viewport-info">Viewport test page</p>
      </body>
    </html>`);
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  server.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("FEAT-4: multi-variant baselines", () => {
  it("two variants produce separate baseline directories", async () => {
    const result = await runRunbook({
      runbook: {
        name: "variant-baselines",
        site: `http://127.0.0.1:${port}`,
        variants: [
          { name: "wide", viewport: { width: 1280, height: 720 } },
          { name: "narrow", viewport: { width: 375, height: 667 } },
        ],
        steps: [
          { goto: "/" },
          { capture: { name: "homepage", baseline: true } },
        ],
      },
      headless: true,
      baselinesDir: join(tempDir, "__baselines__", "variant-baselines"),
    });

    assert.equal(result.failed, 0, `failed: ${JSON.stringify(result.steps.filter((s) => s.status === "failed"))}`);
    // 2 variants × 2 steps = 4 total steps
    assert.equal(result.passed, 4);

    // Verify separate baseline dirs exist
    await access(join(tempDir, "__baselines__", "variant-baselines", "homepage", "wide", "screenshot.png"));
    await access(join(tempDir, "__baselines__", "variant-baselines", "homepage", "narrow", "screenshot.png"));
  });

  it("no variants = backwards-compatible flat baselines", async () => {
    const result = await runRunbook({
      runbook: {
        name: "no-variants",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/" },
          { capture: { name: "homepage", baseline: true } },
        ],
      },
      headless: true,
      baselinesDir: join(tempDir, "__baselines__", "no-variants"),
    });

    assert.equal(result.failed, 0);
    assert.equal(result.passed, 2);

    // Baselines should be flat (no variant subdir)
    await access(join(tempDir, "__baselines__", "no-variants", "homepage", "screenshot.png"));
    // Verify no variant tag on step results
    assert.equal(result.steps[0].variant, undefined);
  });

  it("auto-generates variant name from viewport + colorScheme", async () => {
    const result = await runRunbook({
      runbook: {
        name: "auto-name",
        site: `http://127.0.0.1:${port}`,
        variants: [
          { viewport: { width: 1280, height: 720 } },
          { viewport: { width: 375, height: 667 }, colorScheme: "dark" },
        ],
        steps: [
          { goto: "/" },
          { capture: { name: "page", baseline: true } },
        ],
      },
      headless: true,
      baselinesDir: join(tempDir, "__baselines__", "auto-name"),
    });

    assert.equal(result.failed, 0);

    // Check auto-generated directory names
    await access(join(tempDir, "__baselines__", "auto-name", "page", "1280x720", "screenshot.png"));
    await access(join(tempDir, "__baselines__", "auto-name", "page", "375x667-dark", "screenshot.png"));
  });

  it("tags step results with variant name", async () => {
    const result = await runRunbook({
      runbook: {
        name: "tagged-results",
        site: `http://127.0.0.1:${port}`,
        variants: [
          { name: "desktop", viewport: { width: 1280, height: 720 } },
          { name: "mobile", viewport: { width: 375, height: 667 } },
        ],
        steps: [{ goto: "/" }],
      },
      headless: true,
    });

    assert.equal(result.failed, 0);
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].variant, "desktop");
    assert.equal(result.steps[1].variant, "mobile");
  });

  it("applies colorScheme to variant", async () => {
    const result = await runRunbook({
      runbook: {
        name: "dark-mode",
        site: `http://127.0.0.1:${port}`,
        variants: [
          { name: "dark", viewport: { width: 1280, height: 720 }, colorScheme: "dark" },
        ],
        steps: [
          { goto: "/" },
          { assert: { title: "Responsive" } },
        ],
      },
      headless: true,
    });

    assert.equal(result.failed, 0);
    assert.equal(result.steps[0].variant, "dark");
  });
});
