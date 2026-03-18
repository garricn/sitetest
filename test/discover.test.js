import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { parseAriaSnapshot, classifyElements, generateRunbook, discover } from "../lib/discover.js";

const EXAMPLE_COM_SNAPSHOT = `- document:
  - heading "Example Domain" [level=1]
  - paragraph: This domain is for use in documentation examples.
  - paragraph:
    - link "Learn more":
      - /url: https://iana.org/domains/example`;

const GITHUB_LOGIN_SNAPSHOT = `- document:
  - main:
    - heading "Sign in to GitHub" [level=1]
    - textbox "Username or email address"
    - textbox "Password"
    - link "Forgot password?":
      - /url: /password_reset
    - button "Sign in"
    - button "Continue with Google"
    - link "Create an account":
      - /url: /signup
    - button "Sign in with a passkey"`;

const UNNAMED_ELEMENTS_SNAPSHOT = `- document:
  - button
  - link
  - textbox "Email"
  - button "Submit"`;

describe("parseAriaSnapshot", () => {
  it("parses example.com — one link", () => {
    const elements = parseAriaSnapshot(EXAMPLE_COM_SNAPSHOT);
    assert.equal(elements.length, 1);
    assert.equal(elements[0].role, "link");
    assert.equal(elements[0].name, "Learn more");
    assert.equal(elements[0].href, "https://iana.org/domains/example");
  });

  it("parses GitHub login — textboxes, buttons, links", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const textboxes = elements.filter((e) => e.role === "textbox");
    const buttons = elements.filter((e) => e.role === "button");
    const links = elements.filter((e) => e.role === "link");
    assert.equal(textboxes.length, 2);
    assert.equal(buttons.length, 3);
    assert.equal(links.length, 2);
  });

  it("captures href from /url: lines", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const forgot = elements.find((e) => e.name === "Forgot password?");
    assert.equal(forgot.href, "/password_reset");
  });

  it("handles unnamed elements", () => {
    const elements = parseAriaSnapshot(UNNAMED_ELEMENTS_SNAPSHOT);
    const unnamed = elements.filter((e) => e.name === null);
    assert.equal(unnamed.length, 2); // button and link without names
  });
});

describe("classifyElements", () => {
  it("classifies link with href as high confidence", () => {
    const elements = parseAriaSnapshot(EXAMPLE_COM_SNAPSHOT);
    const classified = classifyElements(elements);
    assert.equal(classified[0].confidence, "high");
    assert.equal(classified[0].action, "click");
  });

  it("classifies button as low confidence", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const classified = classifyElements(elements);
    const signIn = classified.find((e) => e.name === "Sign in");
    assert.equal(signIn.confidence, "low");
  });

  it("classifies textbox as medium confidence", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const classified = classifyElements(elements);
    const username = classified.find((e) => e.name === "Username or email address");
    assert.equal(username.confidence, "medium");
    assert.equal(username.action, "fill");
  });

  it("skips unnamed elements (confidence null)", () => {
    const elements = parseAriaSnapshot(UNNAMED_ELEMENTS_SNAPSHOT);
    const classified = classifyElements(elements);
    const unnamed = classified.filter((e) => e.confidence === null);
    assert.equal(unnamed.length, 2);
  });
});

describe("generateRunbook", () => {
  it("generates valid YAML-serializable runbook", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const classified = classifyElements(elements);
    const runbook = generateRunbook(classified, { site: "https://github.com", page: "/login" });

    assert.equal(runbook.source, "auto-discover");
    assert.ok(runbook.steps.length > 0);
    assert.equal(runbook.site, "https://github.com");

    // Verify it serializes to valid YAML
    const yamlStr = yaml.dump(runbook);
    const parsed = yaml.load(yamlStr);
    assert.equal(parsed.source, "auto-discover");
  });

  it("generates click + assert url for high-confidence links", () => {
    const elements = parseAriaSnapshot(EXAMPLE_COM_SNAPSHOT);
    const classified = classifyElements(elements);
    const runbook = generateRunbook(classified, { site: "https://example.com", page: "/" });

    const clickStep = runbook.steps.find((s) => s.click);
    assert.ok(clickStep, "Should have a click step");

    const assertStep = runbook.steps.find((s) => s.assert?.url);
    assert.ok(assertStep, "Should have an assert url step");
    assert.equal(assertStep.assert.url, "https://iana.org/domains/example");
  });

  it("generates fill for medium-confidence textboxes", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const classified = classifyElements(elements);
    const runbook = generateRunbook(classified, { site: "https://github.com", page: "/login" });

    const fillSteps = runbook.steps.filter((s) => s.fill);
    assert.equal(fillSteps.length, 2); // Username + Password
  });

  it("generates capture baseline for low-confidence buttons", () => {
    const elements = parseAriaSnapshot(GITHUB_LOGIN_SNAPSHOT);
    const classified = classifyElements(elements);
    const runbook = generateRunbook(classified, { site: "https://github.com", page: "/login" });

    const captureSteps = runbook.steps.filter((s) => s.capture && s.capture.baseline);
    assert.ok(captureSteps.length >= 1, "Should have baseline capture steps for low-confidence elements");
  });
});

const TMP = join(import.meta.dirname, "__tmp_discover_test__");

describe("discover", () => {
  beforeEach(async () => {
    await mkdir(join(TMP, "captures", "page1"), { recursive: true });
    await writeFile(join(TMP, "captures", "page1", "accessibility.txt"), GITHUB_LOGIN_SNAPSHOT);
    await writeFile(
      join(TMP, "captures", "page1", "meta.json"),
      JSON.stringify({ url: "https://github.com/login", timestamp: "2026-03-15T00:00:00Z", duration_ms: 1234 })
    );
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("discovers elements and writes runbook YAML files with capture timing", async () => {
    const outDir = join(TMP, "runbooks");
    const results = await discover({
      sitecapDir: join(TMP, "captures"),
      outDir,
    });

    assert.equal(results.length, 1);
    assert.ok(results[0].testable > 0);

    // Verify YAML file was written
    const yamlContent = await readFile(results[0].path, "utf-8");
    assert.match(yamlContent, /capture: \d+\.\d+s/);
    assert.match(yamlContent, /discovery: \d+\.\d+s/);
    const parsed = yaml.load(yamlContent);
    assert.equal(parsed.source, "auto-discover");
    assert.ok(parsed.steps.length > 0);
  });

  it("header omits capture time when meta.json lacks duration_ms", async () => {
    // Overwrite meta.json without duration_ms
    await writeFile(
      join(TMP, "captures", "page1", "meta.json"),
      JSON.stringify({ url: "https://github.com/login", timestamp: "2026-03-15T00:00:00Z" })
    );
    const outDir = join(TMP, "runbooks-no-duration");
    const results = await discover({
      sitecapDir: join(TMP, "captures"),
      outDir,
    });

    assert.equal(results.length, 1);
    const yamlContent = await readFile(results[0].path, "utf-8");
    assert.match(yamlContent, /capture time not included/);
    assert.match(yamlContent, /discovery: \d+\.\d+s/);
  });

  it("filters untestable elements with sitegrade findings", async () => {
    const outDir = join(TMP, "runbooks-filtered");
    const results = await discover({
      sitecapDir: join(TMP, "captures"),
      outDir,
      sitegradeFindings: {
        untestableElements: [{ name: "Username or email address" }, { name: "Password" }],
      },
    });

    assert.equal(results.length, 1);
    // Should have fewer testable elements after filtering
    const yamlContent = await readFile(results[0].path, "utf-8");
    const parsed = yaml.load(yamlContent);
    const fillSteps = parsed.steps.filter((s) => s.fill);
    assert.equal(fillSteps.length, 0, "Filtered textboxes should not generate fill steps");
  });
});
