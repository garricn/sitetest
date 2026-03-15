import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Load env vars from a .env file into an object.
 * Does NOT mutate process.env.
 *
 * @param {string} filePath
 * @returns {Promise<Record<string, string>>}
 */
async function loadDotenv(filePath) {
  const vars = {};
  let content;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return vars;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Build a merged env from .env file + process.env + explicit overrides.
 * Explicit overrides > process.env > .env file.
 *
 * @param {object} [opts]
 * @param {string} [opts.dotenvPath] - Path to .env file. Default: .env in cwd.
 * @param {Record<string, string>} [opts.overrides] - Explicit env vars.
 * @returns {Promise<Record<string, string>>}
 */
export async function buildEnv(opts = {}) {
  const dotenvPath = opts.dotenvPath ?? resolve(".env");
  const dotenvVars = await loadDotenv(dotenvPath);
  return { ...dotenvVars, ...process.env, ...opts.overrides };
}

/**
 * Resolve $VAR references in a string using the given env.
 * Throws if a referenced var is not found.
 *
 * @param {string} str
 * @param {Record<string, string>} env
 * @returns {string}
 */
export function resolveEnvVars(str, env) {
  if (typeof str !== "string") return str;
  return str.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) => {
    if (!(name in env)) {
      throw new Error(`Missing env var: $${name}`);
    }
    return env[name];
  });
}

/**
 * Scan all steps in a runbook and collect referenced $VAR names.
 * Validates that all are present in env. Throws with all missing vars.
 *
 * @param {object[]} steps
 * @param {Record<string, string>} env
 */
export function validateEnvVars(steps, env) {
  const missing = new Set();
  const scan = (val) => {
    if (typeof val === "string") {
      const matches = val.matchAll(/\$([A-Z_][A-Z0-9_]*)/g);
      for (const m of matches) {
        if (!(m[1] in env)) missing.add(m[1]);
      }
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val)) scan(v);
    }
  };
  for (const step of steps) scan(step);
  if (missing.size > 0) {
    throw new Error(`Missing env vars: ${[...missing].map((n) => "$" + n).join(", ")}`);
  }
}
