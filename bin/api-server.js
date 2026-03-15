#!/usr/bin/env node

import { createServer } from "node:http";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";
import { runRunbook } from "../lib/runner.js";
import { discover } from "../lib/discover.js";
import { updateBaselines } from "../lib/baseline.js";

const PORT = parseInt(process.env.SITETEST_PORT || "3200", 10);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

function respond(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/run") {
      const body = await readBody(req);
      const { runbook, headless = true, cdpPort, envFile, continueOnError } = body;

      if (!runbook) return respond(res, 400, { error: "runbook path is required" });

      const result = await runRunbook({
        runbook: resolve(runbook),
        headless,
        cdpPort,
        dotenvPath: envFile ? resolve(envFile) : undefined,
        continueOnError,
      });

      respond(res, 200, result);

    } else if (req.method === "POST" && req.url === "/discover") {
      const body = await readBody(req);
      const { sitecapDir, outDir, site, sitegradeFindings } = body;

      if (!sitecapDir) return respond(res, 400, { error: "sitecapDir is required" });

      const results = await discover({
        sitecapDir: resolve(sitecapDir),
        outDir: outDir ? resolve(outDir) : undefined,
        site,
        sitegradeFindings,
      });

      respond(res, 200, { ok: true, runbooks: results });

    } else if (req.method === "POST" && req.url === "/update") {
      const body = await readBody(req);
      const { runbook } = body;

      if (!runbook) return respond(res, 400, { error: "runbook path is required" });

      const updated = await updateBaselines(resolve(runbook));
      respond(res, 200, { ok: true, updated });

    } else if (req.method === "GET" && req.url === "/health") {
      respond(res, 200, { ok: true, version: "0.5.0" });

    } else {
      respond(res, 404, { error: "not found" });
    }
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`sitetest API listening on http://localhost:${PORT}`);
});
