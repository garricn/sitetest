import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDirs, saveBaseline, baselineExists, baselinePath } from "../lib/baseline.js";

const TMP = join(import.meta.dirname, "__tmp_baseline_test__");

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("resolveDirs", () => {
  it("derives dirs from runbook path", () => {
    const { baselinesDir, capturesDir, runbookName } = resolveDirs("/foo/tests/login.yaml");
    assert.ok(baselinesDir.includes("__baselines__/login"));
    assert.ok(capturesDir.includes("__captures__/login"));
    assert.equal(runbookName, "login");
  });

  it("uses override name", () => {
    const { baselinesDir, runbookName } = resolveDirs("/foo/tests/login.yaml", "my-flow");
    assert.ok(baselinesDir.includes("my-flow"));
    assert.equal(runbookName, "my-flow");
  });
});

describe("saveBaseline", () => {
  it("copies files to baseline dir", async () => {
    const src = join(TMP, "capture", "dash");
    const baseDir = join(TMP, "baselines");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "screenshot.png"), "fake-png");
    await writeFile(join(src, "console.json"), "[]");

    await saveBaseline("dash", src, baseDir);

    const saved = await readFile(join(baseDir, "dash", "screenshot.png"), "utf-8");
    assert.equal(saved, "fake-png");
  });
});

describe("saveBaseline with variant", () => {
  it("saves to variant-nested path", async () => {
    const src = join(TMP, "capture", "page");
    const baseDir = join(TMP, "baselines");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "screenshot.png"), "fake-png");

    await saveBaseline("page", src, baseDir, "desktop");

    const saved = await readFile(join(baseDir, "page", "desktop", "screenshot.png"), "utf-8");
    assert.equal(saved, "fake-png");
  });

  it("saves flat when variant is null", async () => {
    const src = join(TMP, "capture", "page");
    const baseDir = join(TMP, "baselines");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "screenshot.png"), "fake-png");

    await saveBaseline("page", src, baseDir, null);

    const saved = await readFile(join(baseDir, "page", "screenshot.png"), "utf-8");
    assert.equal(saved, "fake-png");
  });
});

describe("baselineExists", () => {
  it("returns false when no baseline", async () => {
    assert.equal(await baselineExists("missing", TMP), false);
  });

  it("returns true when baseline dir exists", async () => {
    await mkdir(join(TMP, "exists"), { recursive: true });
    assert.equal(await baselineExists("exists", TMP), true);
  });

  it("checks variant-nested path", async () => {
    await mkdir(join(TMP, "cap", "desktop"), { recursive: true });
    assert.equal(await baselineExists("cap", TMP, "desktop"), true);
    assert.equal(await baselineExists("cap", TMP, "mobile"), false);
  });
});

describe("baselinePath with variant", () => {
  it("returns nested path with variant", () => {
    const p = baselinePath("capture", "/baselines", "desktop");
    assert.ok(p.endsWith(join("capture", "desktop")));
  });

  it("returns flat path without variant", () => {
    const p = baselinePath("capture", "/baselines", null);
    assert.ok(p.endsWith("capture"));
    // Should not have any subdirectory after "capture"
    assert.equal(p, join("/baselines", "capture"));
  });
});
