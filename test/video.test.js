import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { runRunbook } from "../lib/runner.js";

let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><head><title>Video Test</title></head><body><h1>Hello</h1></body></html>");
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => server.close());

const TMP = join(import.meta.dirname, "__tmp_video_test__");

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("FEAT-1: video recording", () => {
  it("returns null videoPath when video is not enabled", async () => {
    const runbookPath = join(TMP, "no-video.yaml");
    await writeFile(
      runbookPath,
      yaml.dump({
        name: "no-video",
        steps: [{ goto: `http://127.0.0.1:${port}/` }, { assert: { title: "Video Test" } }],
      })
    );

    const result = await runRunbook({ runbook: runbookPath, headless: true });
    assert.strictEqual(result.videoPath, null);
    assert.strictEqual(result.failed, 0);
  });

  it("produces a .webm video file when video is enabled", async () => {
    const runbookPath = join(TMP, "with-video.yaml");
    await writeFile(
      runbookPath,
      yaml.dump({
        name: "with-video",
        steps: [{ goto: `http://127.0.0.1:${port}/` }, { assert: { title: "Video Test" } }],
      })
    );

    const result = await runRunbook({ runbook: runbookPath, headless: true, video: true });
    assert.strictEqual(result.failed, 0);
    assert.ok(result.videoPath, "videoPath should be set");
    assert.ok(result.videoPath.endsWith(".webm"), "videoPath should end with .webm");

    const info = await stat(result.videoPath);
    assert.ok(info.size > 0, "video file should not be empty");
  });

  it("keeps captures directory when video is enabled even with no failures", async () => {
    const runbookPath = join(TMP, "video-keeps-captures.yaml");
    await writeFile(
      runbookPath,
      yaml.dump({
        name: "video-keeps-captures",
        steps: [{ goto: `http://127.0.0.1:${port}/` }],
      })
    );

    const result = await runRunbook({ runbook: runbookPath, headless: true, video: true });
    assert.strictEqual(result.failed, 0);
    assert.ok(result.videoPath);

    // The video file should still exist (captures dir was not cleaned)
    const info = await stat(result.videoPath);
    assert.ok(info.size > 0);
  });
});
