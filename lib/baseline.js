import { mkdir, cp, readdir, rm, access } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import yaml from "js-yaml";
import { readFile } from "node:fs/promises";

/**
 * Derive the baselines and captures directories from a runbook path.
 *
 * @param {string} runbookPath - Absolute path to runbook YAML
 * @param {string} [runbookName] - Override name (otherwise derived from file)
 * @returns {{ baselinesDir: string, capturesDir: string, runbookName: string }}
 */
export function resolveDirs(runbookPath, runbookName) {
  const dir = dirname(runbookPath);
  const name = runbookName || basename(runbookPath, extname(runbookPath));
  return {
    baselinesDir: resolve(dir, "__baselines__", name),
    capturesDir: resolve(dir, "__captures__", name),
    runbookName: name,
  };
}

/**
 * Save a capture directory as a baseline.
 *
 * @param {string} captureName - e.g. "dashboard"
 * @param {string} sourceDir - Directory with current capture files
 * @param {string} baselinesDir - Root baselines dir for this runbook
 */
export async function saveBaseline(captureName, sourceDir, baselinesDir) {
  const dest = resolve(baselinesDir, captureName);
  await mkdir(dest, { recursive: true });
  // Copy all files from source to baseline
  const files = await readdir(sourceDir);
  for (const file of files) {
    await cp(resolve(sourceDir, file), resolve(dest, file));
  }
}

/**
 * Check if a baseline exists for a given capture name.
 *
 * @param {string} captureName
 * @param {string} baselinesDir
 * @returns {Promise<boolean>}
 */
export async function baselineExists(captureName, baselinesDir) {
  try {
    await access(resolve(baselinesDir, captureName));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the baseline directory path for a capture.
 *
 * @param {string} captureName
 * @param {string} baselinesDir
 * @returns {string}
 */
export function baselinePath(captureName, baselinesDir) {
  return resolve(baselinesDir, captureName);
}

/**
 * Update baselines from current captures for a runbook.
 *
 * @param {string} runbookPath - Path to runbook YAML file
 * @returns {Promise<string[]>} Names of updated captures
 */
export async function updateBaselines(runbookPath) {
  const absPath = resolve(runbookPath);
  const content = await readFile(absPath, "utf-8");
  const runbook = yaml.load(content);
  const name = runbook?.name || basename(absPath, extname(absPath));
  const { baselinesDir, capturesDir } = resolveDirs(absPath, name);

  let entries;
  try {
    entries = await readdir(capturesDir);
  } catch {
    throw new Error(`No captures found at ${capturesDir}. Run the runbook first.`);
  }

  if (entries.length === 0) {
    throw new Error(`No captures found at ${capturesDir}. Run the runbook first.`);
  }

  const updated = [];
  for (const entry of entries) {
    const src = resolve(capturesDir, entry);
    const dest = resolve(baselinesDir, entry);
    await mkdir(dest, { recursive: true });
    const files = await readdir(src);
    for (const file of files) {
      await cp(resolve(src, file), resolve(dest, file));
    }
    updated.push(entry);
  }

  return updated;
}

/**
 * Clean up captures directory after a run.
 *
 * @param {string} capturesDir
 */
export async function cleanCaptures(capturesDir) {
  try {
    await rm(capturesDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
