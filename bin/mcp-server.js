#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runRunbook } from "../lib/runner.js";
import { discover } from "../lib/discover.js";
import { updateBaselines } from "../lib/baseline.js";

const server = new Server({ name: "sitetest", version: "0.5.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run",
      description: "Execute a sitetest runbook against a live page via CDP or headless Chrome",
      inputSchema: {
        type: "object",
        properties: {
          runbook: { type: "string", description: "Path to YAML runbook file" },
          headless: { type: "boolean", description: "Launch headless Chrome (default: true)", default: true },
          cdpPort: { type: "number", description: "CDP port for attached Chrome (default: 9222)" },
          envFile: { type: "string", description: "Path to .env file for $VAR resolution" },
          continueOnError: { type: "boolean", description: "Run all steps even after failures" },
        },
        required: ["runbook"],
      },
    },
    {
      name: "discover",
      description: "Discover testable behaviors from sitecap captures and generate runbooks",
      inputSchema: {
        type: "object",
        properties: {
          sitecapDir: { type: "string", description: "Path to sitecap capture directory" },
          outDir: { type: "string", description: "Output directory for generated runbooks (default: ./runbooks)" },
          site: { type: "string", description: "Base site URL (auto-detected from meta.json if omitted)" },
        },
        required: ["sitecapDir"],
      },
    },
    {
      name: "update",
      description: "Accept current captures as new baselines for a runbook",
      inputSchema: {
        type: "object",
        properties: {
          runbook: { type: "string", description: "Path to YAML runbook file" },
        },
        required: ["runbook"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "run") {
      const result = await runRunbook({
        runbook: args.runbook,
        headless: args.headless ?? true,
        cdpPort: args.cdpPort,
        dotenvPath: args.envFile,
        continueOnError: args.continueOnError,
      });
      const summary = `${result.runbook}: ${result.passed} passed, ${result.failed} failed (${result.duration_ms}ms)`;
      const failures = result.steps.filter((s) => s.status === "failed").map((s) => `  ✗ ${s.label} — ${s.reason}`);
      return { content: [{ type: "text", text: [summary, ...failures].join("\n") }] };
    }

    if (name === "discover") {
      const results = await discover({
        sitecapDir: args.sitecapDir,
        outDir: args.outDir,
        site: args.site,
      });
      if (results.length === 0) {
        return { content: [{ type: "text", text: "No testable elements found." }] };
      }
      const lines = results.map((r) => `${r.name}: ${r.testable}/${r.elements} testable → ${r.path}`);
      lines.push(`\n${results.length} runbook(s) generated.`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    if (name === "update") {
      const updated = await updateBaselines(args.runbook);
      return { content: [{ type: "text", text: `Updated baselines: ${updated.join(", ")}` }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
