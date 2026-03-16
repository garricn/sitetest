import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import yaml from "js-yaml";

const INTERACTIVE_ROLES = new Set([
  "link", "button", "textbox", "checkbox", "radio",
  "combobox", "listbox", "menuitem",
]);

/**
 * Parse a Playwright ariaSnapshot string into a structured element list.
 *
 * @param {string} text - Raw aria snapshot text
 * @returns {Array<{role: string, name: string|null, href: string|null, parent: string|null}>}
 */
export function parseAriaSnapshot(text) {
  const elements = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("- ")) continue;

    const content = trimmed.slice(2); // Remove "- "

    // Match: role "name" or role (no name)
    const roleMatch = content.match(/^(\w+)(?:\s+"([^"]*)")?/);
    if (!roleMatch) continue;

    const role = roleMatch[1];
    if (!INTERACTIVE_ROLES.has(role)) continue;

    const name = roleMatch[2] ?? null;

    // For links, look for /url: on the next indented line
    let href = null;
    if (role === "link") {
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trimStart();
        if (!nextTrimmed.startsWith("- ")) break;
        const urlMatch = nextTrimmed.match(/^- \/url:\s*(.+)/);
        if (urlMatch) {
          href = urlMatch[1].trim();
          break;
        }
        // If we hit another element at same or lower indent, stop
        if (lines[j].search(/\S/) <= line.search(/\S/)) break;
      }
    }

    elements.push({ role, name, href, selector: buildSelector(role, name, href) });
  }

  return elements;
}

/**
 * Build a Playwright selector for an element.
 *
 * @param {string} role
 * @param {string|null} name
 * @param {string|null} href
 * @returns {string}
 */
function buildSelector(role, name, href) {
  if (name) {
    return `role=${role}[name="${name}"]`;
  }
  if (role === "link" && href) {
    return `a[href='${href}']`;
  }
  return `role=${role}`;
}

/**
 * Classify elements by confidence level for test generation.
 *
 * @param {Array} elements - From parseAriaSnapshot
 * @returns {Array<{...element, confidence: "high"|"medium"|"low"|null, action: string}>}
 */
export function classifyElements(elements) {
  return elements.map((el) => {
    // Skip unnamed elements (untestable)
    if (!el.name && !(el.role === "link" && el.href)) {
      return { ...el, confidence: null, action: null };
    }

    switch (el.role) {
      case "link":
        if (el.href) return { ...el, confidence: "high", action: "click" };
        return { ...el, confidence: "low", action: "click" };

      case "button":
        return { ...el, confidence: "low", action: "click" };

      case "textbox":
        return { ...el, confidence: "medium", action: "fill" };

      case "checkbox":
      case "radio":
        return { ...el, confidence: "high", action: "toggle" };

      case "combobox":
      case "listbox":
        return { ...el, confidence: "medium", action: "select" };

      case "menuitem":
        return { ...el, confidence: "low", action: "click" };

      default:
        return { ...el, confidence: null, action: null };
    }
  });
}

/**
 * Generate a YAML runbook from classified elements.
 *
 * @param {Array} classified - From classifyElements
 * @param {object} opts
 * @param {string} opts.site - Base URL
 * @param {string} opts.page - Page path (e.g. "/login")
 * @param {string} [opts.name] - Runbook name
 * @returns {object} Runbook object (YAML-serializable)
 */
export function generateRunbook(classified, opts) {
  const testable = classified.filter((el) => el.confidence !== null);
  const pagePart = opts.page.replace(/\//g, "-").replace(/^-|-$/g, "");
  const name = opts.name || (pagePart ? `discover-${pagePart}` : "discover-index");
  const confidences = new Set(testable.map((el) => el.confidence));
  const overallConfidence = confidences.size === 1 ? [...confidences][0] : "mixed";

  const steps = [];

  // Initial navigation + capture
  steps.push({ goto: opts.page });
  steps.push({ wait: "settle" });
  steps.push({ capture: { name: `${name}-initial`, baseline: true } });

  for (const el of testable) {
    const label = el.name || el.href || el.role;

    switch (el.confidence) {
      case "high": {
        if (el.role === "link" && el.href) {
          steps.push({ click: { selector: el.selector } });
          steps.push({ wait: "settle" });
          steps.push({ assert: { url: el.href } });
          steps.push({ goto: opts.page }); // Return to original page
          steps.push({ wait: "settle" });
        } else if (el.role === "checkbox" || el.role === "radio") {
          steps.push({ check: { selector: el.selector } });
          steps.push({ assert: { element: { selector: el.selector, checked: true } } });
          steps.push({ uncheck: { selector: el.selector } });
        }
        break;
      }

      case "medium": {
        if (el.action === "fill") {
          steps.push({ fill: { selector: el.selector, value: `test-${el.name || "value"}` } });
          steps.push({ assert: { no_console_errors: true } });
        } else if (el.action === "select") {
          // Can't reliably auto-select without knowing options
          steps.push({ capture: { name: `after-${slugify(label)}`, baseline: true } });
        }
        break;
      }

      case "low": {
        steps.push({ click: { selector: el.selector } });
        steps.push({ wait: "settle" });
        steps.push({ capture: { name: `after-${slugify(label)}`, baseline: true } });
        steps.push({ goto: opts.page }); // Return to original page
        steps.push({ wait: "settle" });
        break;
      }
    }
  }

  return {
    name,
    site: opts.site,
    source: "auto-discover",
    confidence: overallConfidence,
    generated: new Date().toISOString(),
    steps,
  };
}

/**
 * Run discovery on sitecap output directory.
 *
 * @param {object} opts
 * @param {string} opts.sitecapDir - Directory with sitecap captures (subdirs per page)
 * @param {string} [opts.outDir] - Output directory for runbooks. Default: ./runbooks
 * @param {string} [opts.site] - Base site URL. Derived from meta.json if not provided.
 * @param {object} [opts.sitegradeFindings] - Optional sitegrade findings to filter untestable elements
 * @returns {Promise<Array<{name: string, path: string, elements: number, testable: number}>>}
 */
export async function discover(opts) {
  const sitecapDir = resolve(opts.sitecapDir);
  const outDir = resolve(opts.outDir || "./runbooks");
  await mkdir(outDir, { recursive: true });

  // Find all page capture directories (each has accessibility.txt)
  const entries = await readdir(sitecapDir, { withFileTypes: true });
  const pageDirs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      pageDirs.push(entry.name);
    }
  }

  // If sitecapDir itself has accessibility.txt, treat it as a single page
  try {
    await readFile(join(sitecapDir, "accessibility.txt"), "utf-8");
    pageDirs.length = 0;
    pageDirs.push("."); // Current dir is the page
  } catch {
    // Not a single page — use subdirs
  }

  const results = [];

  for (const pageDir of pageDirs) {
    const dir = pageDir === "." ? sitecapDir : join(sitecapDir, pageDir);

    // Read aria snapshot
    let ariaText;
    try {
      ariaText = await readFile(join(dir, "accessibility.txt"), "utf-8");
    } catch {
      continue; // No accessibility data for this page
    }

    // Read meta.json for URL
    let site = opts.site || "";
    let pagePath = "/";
    try {
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8"));
      if (meta.url) {
        const u = new URL(meta.url);
        site = site || u.origin;
        pagePath = u.pathname;
      }
    } catch {
      // No meta.json — use defaults
    }

    // Parse and classify
    const elements = parseAriaSnapshot(ariaText);
    const classified = classifyElements(elements);

    // Filter by sitegrade findings if provided
    let testable = classified.filter((el) => el.confidence !== null);
    if (opts.sitegradeFindings) {
      testable = filterBySitegrade(testable, opts.sitegradeFindings);
    }

    if (testable.length === 0) continue;

    // Generate runbook from filtered testable elements
    const runbook = generateRunbook(testable, { site, page: pagePath });
    const runbookPath = join(outDir, `${runbook.name}.yaml`);
    await writeFile(runbookPath, yaml.dump(runbook, { lineWidth: 120, noRefs: true }));

    results.push({
      name: runbook.name,
      path: runbookPath,
      elements: elements.length,
      testable: testable.length,
    });
  }

  return results;
}

/**
 * Filter elements based on sitegrade testability findings.
 * Removes elements that sitegrade flagged as untestable.
 *
 * @param {Array} elements - Classified elements
 * @param {object} findings - Sitegrade findings object
 * @returns {Array}
 */
function filterBySitegrade(elements, findings) {
  // If sitegrade provides a list of untestable selectors/names, filter them out
  const untestable = new Set();
  if (findings.untestableElements) {
    for (const el of findings.untestableElements) {
      untestable.add(el.name || el.selector);
    }
  }
  if (untestable.size === 0) return elements;
  return elements.filter((el) => !untestable.has(el.name) && !untestable.has(el.selector));
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
