// AUTO-GENERATED — do not edit. Run: npm run generate
import { Buffer } from "node:buffer";
import * as ops from "../lib/operations.js";

const VERSION = "0.5.0";

const routes = [
  { method: "POST", path: "/run", op: ops.runOp },
  { method: "GET", path: "/discover", op: ops.discoverOp },
  { method: "POST", path: "/update", op: ops.updateOp }
];

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

function respond(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function handleRequest(req, res) {
  try {
    const parsed = new URL(req.url, "http://localhost");
    const pathname = parsed.pathname;

    if (req.method === "GET" && pathname === "/health") {
      return respond(res, 200, { ok: true, version: VERSION });
    }

    const route = routes.find((r) => r.method === req.method && r.path === pathname);
    if (!route) return respond(res, 404, { error: "not found" });

    const input = req.method === "GET"
      ? Object.fromEntries(parsed.searchParams)
      : await readBody(req);

    const validated = route.op.input.parse(input);
    const result = await route.op.handler(validated);
    respond(res, 200, result);
  } catch (err) {
    if (err.name === "ZodError") {
      respond(res, 400, { error: "validation", details: err.errors });
    } else {
      respond(res, 500, { error: err.message });
    }
  }
}
