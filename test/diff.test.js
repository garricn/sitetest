import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { diffCaptures } from "../lib/diff.js";

const TMP = join(import.meta.dirname, "__tmp_diff_test__");
const CAPTURE = join(TMP, "capture");
const BASELINE = join(TMP, "baseline");

beforeEach(async () => {
  await mkdir(CAPTURE, { recursive: true });
  await mkdir(BASELINE, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

function makePng(width, height, r, g, b) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("diffCaptures", () => {
  it("passes when screenshots are identical", async () => {
    const buf = makePng(10, 10, 255, 0, 0);
    await writeFile(join(CAPTURE, "screenshot.png"), buf);
    await writeFile(join(BASELINE, "screenshot.png"), buf);

    const results = await diffCaptures(CAPTURE, BASELINE);
    const ss = results.find((r) => r.type === "screenshot");
    assert.equal(ss.passed, true);
  });

  it("fails when screenshots differ beyond threshold", async () => {
    await writeFile(join(CAPTURE, "screenshot.png"), makePng(10, 10, 255, 0, 0));
    await writeFile(join(BASELINE, "screenshot.png"), makePng(10, 10, 0, 255, 0));

    const results = await diffCaptures(CAPTURE, BASELINE);
    const ss = results.find((r) => r.type === "screenshot");
    assert.equal(ss.passed, false);
    assert.ok(ss.reason.includes("pixels differ"));
  });

  it("fails when screenshot dimensions change", async () => {
    await writeFile(join(CAPTURE, "screenshot.png"), makePng(10, 10, 255, 0, 0));
    await writeFile(join(BASELINE, "screenshot.png"), makePng(20, 20, 255, 0, 0));

    const results = await diffCaptures(CAPTURE, BASELINE);
    const ss = results.find((r) => r.type === "screenshot");
    assert.equal(ss.passed, false);
    assert.ok(ss.reason.includes("Dimensions changed"));
  });

  it("passes when console errors match baseline", async () => {
    const data = JSON.stringify([{ type: "error", text: "known error" }]);
    await writeFile(join(CAPTURE, "console.json"), data);
    await writeFile(join(BASELINE, "console.json"), data);

    const results = await diffCaptures(CAPTURE, BASELINE);
    const c = results.find((r) => r.type === "console");
    assert.equal(c.passed, true);
  });

  it("fails when console has new errors", async () => {
    await writeFile(join(CAPTURE, "console.json"), JSON.stringify([
      { type: "error", text: "known error" },
      { type: "error", text: "new error" },
    ]));
    await writeFile(join(BASELINE, "console.json"), JSON.stringify([
      { type: "error", text: "known error" },
    ]));

    const results = await diffCaptures(CAPTURE, BASELINE);
    const c = results.find((r) => r.type === "console");
    assert.equal(c.passed, false);
    assert.ok(c.reason.includes("new console error"));
  });

  it("fails when network has new URLs", async () => {
    await writeFile(join(CAPTURE, "network.json"), JSON.stringify([
      { method: "GET", url: "https://example.com/api/data", status: 200 },
      { method: "POST", url: "https://example.com/api/new", status: 201 },
    ]));
    await writeFile(join(BASELINE, "network.json"), JSON.stringify([
      { method: "GET", url: "https://example.com/api/data", status: 200 },
    ]));

    const results = await diffCaptures(CAPTURE, BASELINE);
    const n = results.find((r) => r.type === "network");
    assert.equal(n.passed, false);
    assert.ok(n.reason.includes("new"));
  });

  it("passes when storage matches", async () => {
    const data = JSON.stringify({ cookies: [{ name: "sid" }], localStorage: { key: "val" } });
    await writeFile(join(CAPTURE, "storage.json"), data);
    await writeFile(join(BASELINE, "storage.json"), data);

    const results = await diffCaptures(CAPTURE, BASELINE);
    const s = results.find((r) => r.type === "storage");
    assert.equal(s.passed, true);
  });

  it("fails when storage has new cookies", async () => {
    await writeFile(join(CAPTURE, "storage.json"), JSON.stringify({
      cookies: [{ name: "sid" }, { name: "tracking" }],
      localStorage: {},
    }));
    await writeFile(join(BASELINE, "storage.json"), JSON.stringify({
      cookies: [{ name: "sid" }],
      localStorage: {},
    }));

    const results = await diffCaptures(CAPTURE, BASELINE);
    const s = results.find((r) => r.type === "storage");
    assert.equal(s.passed, false);
    assert.ok(s.reason.includes("tracking"));
  });

  it("skips types when files are missing", async () => {
    // No files at all
    const results = await diffCaptures(CAPTURE, BASELINE);
    assert.equal(results.length, 0);
  });
});
