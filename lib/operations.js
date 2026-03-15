import { z } from "zod";
import { resolve } from "node:path";
import { runRunbook } from "./runner.js";
import { discover as discoverFn } from "./discover.js";
import { updateBaselines } from "./baseline.js";

/**
 * Define an operation — single source of truth for all API surfaces.
 */
function defineOp({ name, description, type, input, handler }) {
  return { name, description, type, input, handler };
}

export const runOp = defineOp({
  name: "run",
  description: "Execute a sitetest runbook against a live page via CDP or headless Chrome",
  type: "mutation",
  input: z.object({
    runbook: z.string().describe("Path to YAML runbook file"),
    headless: z.boolean().default(true).describe("Launch headless Chrome"),
    cdpPort: z.number().default(9222).describe("CDP port for attached Chrome"),
    envFile: z.string().optional().describe("Path to .env file for $VAR resolution"),
    continueOnError: z.boolean().default(false).describe("Run all steps even after failures"),
  }),
  handler: async (args) => {
    const result = await runRunbook({
      runbook: resolve(args.runbook),
      headless: args.headless,
      cdpPort: args.cdpPort,
      dotenvPath: args.envFile ? resolve(args.envFile) : undefined,
      continueOnError: args.continueOnError,
    });
    return result;
  },
});

export const discoverOp = defineOp({
  name: "discover",
  description: "Discover testable behaviors from sitecap captures and generate runbooks",
  type: "query",
  input: z.object({
    sitecapDir: z.string().describe("Path to sitecap capture directory"),
    outDir: z.string().default("./runbooks").describe("Output directory for generated runbooks"),
    site: z.string().optional().describe("Base site URL (auto-detected from meta.json if omitted)"),
  }),
  handler: async (args) => {
    const results = await discoverFn({
      sitecapDir: resolve(args.sitecapDir),
      outDir: resolve(args.outDir),
      site: args.site,
    });
    return { runbooks: results };
  },
});

export const updateOp = defineOp({
  name: "update",
  description: "Accept current captures as new baselines for a runbook",
  type: "mutation",
  input: z.object({
    runbook: z.string().describe("Path to YAML runbook file"),
  }),
  handler: async (args) => {
    const updated = await updateBaselines(resolve(args.runbook));
    return { updated };
  },
});
