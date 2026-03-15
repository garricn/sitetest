import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runRunbook } from "../lib/runner.js";

let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/login") {
      // Redirect to /callback, setting a session cookie
      res.writeHead(302, {
        Location: "/callback",
        "Set-Cookie": "session=abc123; Path=/; HttpOnly",
      });
      res.end();
    } else if (req.url === "/callback") {
      // Redirect to /dashboard, setting another cookie
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": "auth_token=xyz789; Path=/",
      });
      res.end();
    } else if (req.url === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Dashboard</title></head><body>Welcome back</body></html>");
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Home</title></head><body><a href='/login'>Login</a></body></html>");
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
});

describe("cookie persistence through redirect chains", () => {
  it("preserves cookies set during 302 redirect chain in headless mode", async () => {
    const result = await runRunbook({
      runbook: {
        name: "cookie-redirect-test",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/login" },
          { assert: { url: "/dashboard", title: "Dashboard", contains: "Welcome back" } },
          { assert: { cookie: { name: "session", exists: true } } },
          { assert: { cookie: { name: "auth_token", exists: true } } },
        ],
      },
      headless: true,
    });

    assert.equal(result.failed, 0, `Expected 0 failures, got: ${JSON.stringify(result.steps.filter(s => s.status === "failed"))}`);
    assert.equal(result.passed, 4);
  });

  it("preserves cookies across separate navigations in same context", async () => {
    const result = await runRunbook({
      runbook: {
        name: "cookie-persist-test",
        site: `http://127.0.0.1:${port}`,
        steps: [
          { goto: "/login" },
          { assert: { url: "/dashboard" } },
          { goto: "/" },
          { assert: { cookie: { name: "session", exists: true } } },
          { assert: { cookie: { name: "auth_token", exists: true } } },
        ],
      },
      headless: true,
    });

    assert.equal(result.failed, 0, `Expected 0 failures, got: ${JSON.stringify(result.steps.filter(s => s.status === "failed"))}`);
    assert.equal(result.passed, 5);
  });
});
