import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * @typedef {object} DiffResult
 * @property {string} type - Capture type (screenshot, accessibility, etc.)
 * @property {boolean} passed
 * @property {string} [reason] - Failure reason
 * @property {string} [diffPath] - Path to diff artifact (e.g. screenshot-diff.png)
 */

/**
 * Diff all capture types between a current capture and a baseline.
 *
 * @param {string} captureDir - Directory with current capture files
 * @param {string} baselineDir - Directory with baseline capture files
 * @param {object} [opts]
 * @param {number} [opts.screenshotThreshold] - Fraction of pixels allowed to differ. Default: 0.001 (0.1%)
 * @returns {Promise<DiffResult[]>}
 */
export async function diffCaptures(captureDir, baselineDir, opts = {}) {
  const results = [];
  const threshold = opts.screenshotThreshold ?? 0.001;

  // Screenshot diff
  results.push(await diffScreenshot(captureDir, baselineDir, threshold));

  // Accessibility diff
  results.push(await diffAccessibility(captureDir, baselineDir));

  // Console diff
  results.push(await diffConsole(captureDir, baselineDir));

  // Network diff
  results.push(await diffNetwork(captureDir, baselineDir));

  // Storage diff
  results.push(await diffStorage(captureDir, baselineDir));

  // Filter out skipped types (file not present)
  return results.filter((r) => r !== null);
}

/**
 * @param {string} captureDir
 * @param {string} baselineDir
 * @param {number} threshold
 * @returns {Promise<DiffResult|null>}
 */
async function diffScreenshot(captureDir, baselineDir, threshold) {
  const currentPath = join(captureDir, "screenshot.png");
  const baselinePath = join(baselineDir, "screenshot.png");

  let currentBuf, baselineBuf;
  try {
    [currentBuf, baselineBuf] = await Promise.all([readFile(currentPath), readFile(baselinePath)]);
  } catch {
    return null; // One or both missing — skip
  }

  const current = PNG.sync.read(currentBuf);
  const baseline = PNG.sync.read(baselineBuf);

  if (current.width !== baseline.width || current.height !== baseline.height) {
    return {
      type: "screenshot",
      passed: false,
      reason: `Dimensions changed: ${baseline.width}x${baseline.height} → ${current.width}x${current.height}`,
    };
  }

  const { width, height } = current;
  const diff = new PNG({ width, height });
  const numDiff = pixelmatch(current.data, baseline.data, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;
  const diffFraction = numDiff / totalPixels;

  if (diffFraction > threshold) {
    const diffPath = join(captureDir, "screenshot-diff.png");
    await writeFile(diffPath, PNG.sync.write(diff));
    return {
      type: "screenshot",
      passed: false,
      reason: `${(diffFraction * 100).toFixed(1)}% pixels differ (threshold ${(threshold * 100).toFixed(1)}%)`,
      diffPath,
    };
  }

  return { type: "screenshot", passed: true };
}

/**
 * @param {string} captureDir
 * @param {string} baselineDir
 * @returns {Promise<DiffResult|null>}
 */
async function diffAccessibility(captureDir, baselineDir) {
  const currentPath = join(captureDir, "accessibility.txt");
  const baselinePath = join(baselineDir, "accessibility.txt");

  let currentText, baselineText;
  try {
    [currentText, baselineText] = await Promise.all([
      readFile(currentPath, "utf-8"),
      readFile(baselinePath, "utf-8"),
    ]);
  } catch {
    return null;
  }

  const interactiveRoles = /\b(button|link|textbox|checkbox|radio|combobox|listbox|menuitem)\b/;
  const currentLines = currentText.split("\n").filter((l) => interactiveRoles.test(l));
  const baselineLines = baselineText.split("\n").filter((l) => interactiveRoles.test(l));

  const currentSet = new Set(currentLines.map((l) => l.trim()));
  const baselineSet = new Set(baselineLines.map((l) => l.trim()));

  const added = [...currentSet].filter((l) => !baselineSet.has(l));
  const removed = [...baselineSet].filter((l) => !currentSet.has(l));

  if (added.length === 0 && removed.length === 0) {
    return { type: "accessibility", passed: true };
  }

  const parts = [];
  if (added.length > 0) parts.push(`${added.length} added: ${added.slice(0, 3).join(", ")}`);
  if (removed.length > 0) parts.push(`${removed.length} removed: ${removed.slice(0, 3).join(", ")}`);

  return { type: "accessibility", passed: false, reason: parts.join("; ") };
}

/**
 * @param {string} captureDir
 * @param {string} baselineDir
 * @returns {Promise<DiffResult|null>}
 */
async function diffConsole(captureDir, baselineDir) {
  let current, baseline;
  try {
    [current, baseline] = await Promise.all([
      readFile(join(captureDir, "console.json"), "utf-8").then(JSON.parse),
      readFile(join(baselineDir, "console.json"), "utf-8").then(JSON.parse),
    ]);
  } catch {
    return null;
  }

  const currentErrors = new Set(current.filter((m) => m.type === "error").map((m) => m.text));
  const baselineErrors = new Set(baseline.filter((m) => m.type === "error").map((m) => m.text));
  const newErrors = [...currentErrors].filter((e) => !baselineErrors.has(e));

  if (newErrors.length === 0) {
    return { type: "console", passed: true };
  }

  return {
    type: "console",
    passed: false,
    reason: `${newErrors.length} new console error(s): ${newErrors.slice(0, 3).join("; ")}`,
  };
}

/**
 * @param {string} captureDir
 * @param {string} baselineDir
 * @returns {Promise<DiffResult|null>}
 */
async function diffNetwork(captureDir, baselineDir) {
  let current, baseline;
  try {
    [current, baseline] = await Promise.all([
      readFile(join(captureDir, "network.json"), "utf-8").then(JSON.parse),
      readFile(join(baselineDir, "network.json"), "utf-8").then(JSON.parse),
    ]);
  } catch {
    return null;
  }

  const toKey = (r) => `${r.method} ${new URL(r.url).pathname} → ${r.status}`;
  const currentSet = new Set(current.map(toKey));
  const baselineSet = new Set(baseline.map(toKey));

  const added = [...currentSet].filter((k) => !baselineSet.has(k));
  const removed = [...baselineSet].filter((k) => !currentSet.has(k));

  if (added.length === 0 && removed.length === 0) {
    return { type: "network", passed: true };
  }

  const parts = [];
  if (added.length > 0) parts.push(`${added.length} new: ${added.slice(0, 3).join(", ")}`);
  if (removed.length > 0) parts.push(`${removed.length} missing: ${removed.slice(0, 3).join(", ")}`);

  return { type: "network", passed: false, reason: parts.join("; ") };
}

/**
 * @param {string} captureDir
 * @param {string} baselineDir
 * @returns {Promise<DiffResult|null>}
 */
async function diffStorage(captureDir, baselineDir) {
  let current, baseline;
  try {
    [current, baseline] = await Promise.all([
      readFile(join(captureDir, "storage.json"), "utf-8").then(JSON.parse),
      readFile(join(baselineDir, "storage.json"), "utf-8").then(JSON.parse),
    ]);
  } catch {
    return null;
  }

  const changes = [];

  // Cookie names
  const currentCookies = new Set((current.cookies || []).map((c) => c.name));
  const baselineCookies = new Set((baseline.cookies || []).map((c) => c.name));
  const addedCookies = [...currentCookies].filter((n) => !baselineCookies.has(n));
  const removedCookies = [...baselineCookies].filter((n) => !currentCookies.has(n));
  if (addedCookies.length > 0) changes.push(`cookies added: ${addedCookies.join(", ")}`);
  if (removedCookies.length > 0) changes.push(`cookies removed: ${removedCookies.join(", ")}`);

  // localStorage keys
  const currentLs = new Set(Object.keys(current.localStorage || {}));
  const baselineLs = new Set(Object.keys(baseline.localStorage || {}));
  const addedLs = [...currentLs].filter((k) => !baselineLs.has(k));
  const removedLs = [...baselineLs].filter((k) => !currentLs.has(k));
  if (addedLs.length > 0) changes.push(`localStorage added: ${addedLs.join(", ")}`);
  if (removedLs.length > 0) changes.push(`localStorage removed: ${removedLs.join(", ")}`);

  if (changes.length === 0) {
    return { type: "storage", passed: true };
  }

  return { type: "storage", passed: false, reason: changes.join("; ") };
}
