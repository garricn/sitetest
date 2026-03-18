import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRunbook } from "../lib/runner.js";

let server;
let port;
let tempDir;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sitetest-cookies-"));

  server = http.createServer((req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (req.url === "/login") {
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": "session=abc123; Path=/; HttpOnly",
      });
      res.end();
    } else if (req.url === "/dashboard") {
      if (cookies.session) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><head><title>Dashboard</title></head><body>Welcome</body></html>");
      } else {
        res.writeHead(401, { "Content-Type": "text/html" });
        res.end("<html><head><title>Unauthorized</title></head><body>Login required</body></html>");
      }
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Home</title></head><body>Home</body></html>");
    }
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

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(header.split(";").map((c) => c.trim().split("=")));
}

describe("cookies step", () => {
  it("save and load round-trip", async () => {
    const cookieFile = join(tempDir, "session.json");

    // First run: login and save cookies
    const r1 = await runRunbook({
      runbook: {
        name: "save-cookies",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/login" },
          { assert: { cookie: { name: "session", exists: true } } },
          { cookies: "save", file: cookieFile },
        ],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(r1.failed, 0, `save run failed: ${JSON.stringify(r1.steps.filter((s) => s.status === "failed"))}`);

    // Verify file is valid JSON
    const saved = JSON.parse(await readFile(cookieFile, "utf-8"));
    assert.ok(Array.isArray(saved));
    assert.ok(saved.some((c) => c.name === "session"));

    // Second run: load cookies and access dashboard without login
    const r2 = await runRunbook({
      runbook: {
        name: "load-cookies",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { cookies: "load", file: cookieFile },
          { goto: "/dashboard" },
          { assert: { title: "Dashboard" } },
          { assert: { cookie: { name: "session", exists: true } } },
        ],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(r2.failed, 0, `load run failed: ${JSON.stringify(r2.steps.filter((s) => s.status === "failed"))}`);
  });

  it("load restores authentication from pre-written file", async () => {
    const cookieFile = join(tempDir, "prewritten.json");
    await writeFile(
      cookieFile,
      JSON.stringify([
        { name: "session", value: "abc123", domain: "127.0.0.1", path: "/" },
      ])
    );

    const result = await runRunbook({
      runbook: {
        name: "prewritten-load",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { cookies: "load", file: cookieFile },
          { goto: "/dashboard" },
          { assert: { title: "Dashboard" } },
          { assert: { cookie: { name: "session", exists: true } } },
        ],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(result.failed, 0, `failed: ${JSON.stringify(result.steps.filter((s) => s.status === "failed"))}`);
  });

  it("clear removes all cookies", async () => {
    const result = await runRunbook({
      runbook: {
        name: "clear-cookies",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/login" },
          { assert: { cookie: { name: "session", exists: true } } },
          { cookies: "clear" },
          { assert: { cookie: { name: "session", exists: false } } },
        ],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(result.failed, 0, `failed: ${JSON.stringify(result.steps.filter((s) => s.status === "failed"))}`);
  });

  it("save without file fails", async () => {
    const result = await runRunbook({
      runbook: {
        name: "save-no-file",
        site: `http://127.0.0.1:${port}`,
        steps: [{ cookies: "save" }],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(result.failed, 1);
    assert.ok(result.steps[0].reason.includes("file"));
  });

  it("load with missing file fails", async () => {
    const result = await runRunbook({
      runbook: {
        name: "load-missing",
        site: `http://127.0.0.1:${port}`,
        steps: [{ cookies: "load", file: join(tempDir, "nonexistent.json") }],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(result.failed, 1);
  });

  it("save creates parent directories", async () => {
    const cookieFile = join(tempDir, "deep", "nested", "session.json");
    const result = await runRunbook({
      runbook: {
        name: "save-mkdir",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/login" },
          { cookies: "save", file: cookieFile },
        ],
      },
      headless: true,
      runbookDir: tempDir,
    });
    assert.equal(result.failed, 0, `failed: ${JSON.stringify(result.steps.filter((s) => s.status === "failed"))}`);

    // Verify file was created
    const saved = JSON.parse(await readFile(cookieFile, "utf-8"));
    assert.ok(Array.isArray(saved));
  });
});
