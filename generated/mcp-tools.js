// AUTO-GENERATED — do not edit. Run: npm run generate
import * as ops from "../lib/operations.js";

export const tools = [
    {
      name: "run",
      description: "Execute a sitetest runbook against a live page via CDP or headless Chrome",
      inputSchema: {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                  "runbook": {
                        "type": "string",
                        "description": "Path to YAML runbook file"
                  },
                  "headless": {
                        "default": true,
                        "description": "Launch headless Chrome",
                        "type": "boolean"
                  },
                  "cdpPort": {
                        "default": 9222,
                        "description": "CDP port for attached Chrome",
                        "type": "number"
                  },
                  "envFile": {
                        "description": "Path to .env file for $VAR resolution",
                        "type": "string"
                  },
                  "continueOnError": {
                        "default": false,
                        "description": "Run all steps even after failures",
                        "type": "boolean"
                  }
            },
            "required": [
                  "runbook",
                  "headless",
                  "cdpPort",
                  "continueOnError"
            ],
            "additionalProperties": false
      },
    },
    {
      name: "discover",
      description: "Discover testable behaviors from sitecap captures and generate runbooks",
      inputSchema: {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                  "sitecapDir": {
                        "type": "string",
                        "description": "Path to sitecap capture directory"
                  },
                  "outDir": {
                        "default": "./runbooks",
                        "description": "Output directory for generated runbooks",
                        "type": "string"
                  },
                  "site": {
                        "description": "Base site URL (auto-detected from meta.json if omitted)",
                        "type": "string"
                  }
            },
            "required": [
                  "sitecapDir",
                  "outDir"
            ],
            "additionalProperties": false
      },
    },
    {
      name: "update",
      description: "Accept current captures as new baselines for a runbook",
      inputSchema: {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                  "runbook": {
                        "type": "string",
                        "description": "Path to YAML runbook file"
                  }
            },
            "required": [
                  "runbook"
            ],
            "additionalProperties": false
      },
    }
  ];

export async function handleTool(name, args) {
  switch (name) {
      case "run":
        return ops.runOp.handler(ops.runOp.input.parse(args));
      case "discover":
        return ops.discoverOp.handler(ops.discoverOp.input.parse(args));
      case "update":
        return ops.updateOp.handler(ops.updateOp.input.parse(args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
