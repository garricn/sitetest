#!/usr/bin/env node

import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { allOperations } from "../lib/registry.js";

function toJsonSchema(zodSchema) {
  return z.toJSONSchema(zodSchema);
}

const OUT = resolve("generated");
await mkdir(OUT, { recursive: true });

const pkg = JSON.parse(await readFile(resolve("package.json"), "utf-8"));
const VERSION = pkg.version;

// ── MCP tools ──────────────────────────────────────────────────────────

function generateMcpTools() {
  const toolDefs = allOperations.map((op) => {
    const jsonSchema = toJsonSchema(op.input);
    return `    {
      name: ${JSON.stringify(op.name)},
      description: ${JSON.stringify(op.description)},
      inputSchema: ${JSON.stringify(jsonSchema, null, 6).replace(/\n/g, "\n      ")},
    }`;
  });

  const cases = allOperations.map(
    (op) => `      case ${JSON.stringify(op.name)}:
        return ops.${op.name}Op.handler(ops.${op.name}Op.input.parse(args));`
  );

  return `// AUTO-GENERATED — do not edit. Run: npm run generate
import * as ops from "../lib/operations.js";

export const tools = [
${toolDefs.join(",\n")}
  ];

export async function handleTool(name, args) {
  switch (name) {
${cases.join("\n")}
    default:
      throw new Error(\`Unknown tool: \${name}\`);
  }
}
`;
}

// ── API routes ─────────────────────────────────────────────────────────

function generateApiRoutes() {
  const routes = allOperations.map((op) => {
    const method = op.type === "mutation" ? "POST" : "GET";
    return `  { method: ${JSON.stringify(method)}, path: ${JSON.stringify("/" + op.name)}, op: ops.${op.name}Op }`;
  });

  return `// AUTO-GENERATED — do not edit. Run: npm run generate
import { Buffer } from "node:buffer";
import * as ops from "../lib/operations.js";

const VERSION = ${JSON.stringify(VERSION)};

const routes = [
${routes.join(",\n")}
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
`;
}

// ── OpenAPI spec ───────────────────────────────────────────────────────

function generateOpenApi() {
  const paths = {};
  for (const op of allOperations) {
    const method = op.type === "mutation" ? "post" : "get";
    const schema = toJsonSchema(op.input);
    const path = `/${op.name}`;

    paths[path] = {
      [method]: {
        summary: op.description,
        operationId: op.name,
        ...(method === "post"
          ? { requestBody: { required: true, content: { "application/json": { schema } } } }
          : { parameters: Object.entries(schema.properties || {}).map(([name, s]) => ({
              name, in: "query", required: (schema.required || []).includes(name), schema: s,
            })) }),
        responses: { "200": { description: "Success" }, "400": { description: "Validation error" }, "500": { description: "Server error" } },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: { title: "sitetest API", version: VERSION },
    servers: [{ url: "http://localhost:3200" }],
    paths,
  };
}

// ── Function-calling tools ─────────────────────────────────────────────

function generateToolsJson() {
  return allOperations.map((op) => {
    const schema = toJsonSchema(op.input);
    return {
      name: `sitetest_${op.name}`,
      description: op.description,
      input_schema: schema,
    };
  });
}

// ── Write all files ────────────────────────────────────────────────────

await writeFile(join(OUT, "mcp-tools.js"), generateMcpTools());
await writeFile(join(OUT, "api-routes.js"), generateApiRoutes());
await writeFile(join(OUT, "openapi.json"), JSON.stringify(generateOpenApi(), null, 2));
await writeFile(join(OUT, "tools.json"), JSON.stringify(generateToolsJson(), null, 2));

console.log(`Generated 4 files in ${OUT}`);
