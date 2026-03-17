# FEAT-1 — sitetest --video

## Context

sitetest currently creates browser contexts and pages manually in `runner.js` (lines 79–80). sitecap already provides `createCaptureSession(browser, viewport, opts)` which wraps context+page creation and optionally enables Playwright's built-in video recording. The `closeCaptureSession(session)` counterpart finalizes the video file.

This task wires up that existing API so users can record full test runs as `.webm` videos via `--video` on the CLI, `video: true` in the library API, and the MCP/REST operations.

## Goals

- `sitetest run runbook.yaml --video` produces a `.webm` in `__captures__/<runbook>/`
- Library callers pass `video: true` to `runRunbook()` for the same effect
- MCP/REST `run` operation accepts `video` boolean
- No video overhead when flag is off — current behavior is unchanged
- Graceful degradation: if video recording fails, the run still completes

## Phases

### Phase A — Runner Integration (SRL)

#### A1. Replace manual context/page creation with `createCaptureSession()`

- File: `lib/runner.js`
- Current (lines 79–80):
  ```
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  ```
- Change: when `opts.video` is truthy, call `createCaptureSession(browser, viewport, { video: true, videoDir })` instead
- When `opts.video` is falsy, call `createCaptureSession(browser, viewport, {})` (no video) — this unifies the page creation path
- `videoDir` = `capturesDir` (already computed at line ~90 as `__captures__/<runbook-name>`)
- `viewport` = `{ width: 1280, height: 720 }` (Playwright default; can be made configurable later)
- Store the session object returned by `createCaptureSession()` for cleanup

**Decision table — which code path creates the page:**

| `opts.video` | Code path |
|--------------|-----------|
| `true`       | `createCaptureSession(browser, viewport, { video: true, videoDir })` |
| `false`/omit | `createCaptureSession(browser, viewport, {})` |

Both paths return `{ context, page, hasVideo, videoDir }`. The runner uses `session.page` from here on.

#### A2. Finalize video on session end

- File: `lib/runner.js`
- After all steps complete (before `page.close()`), call `closeCaptureSession(session)`
- If `session.hasVideo`, the returned `videoPath` should be included in the run result
- The cleanup logic that removes `capturesDir` when no failures (line ~129) must NOT delete the video. When video is enabled, always keep captures dir (or at minimum keep the `.webm`).

**Decision table — captures cleanup:**

| video | failures | keepCaptures | Action |
|-------|----------|--------------|--------|
| false | 0        | false        | Remove capturesDir |
| false | 0        | true         | Keep capturesDir |
| false | >0       | any          | Keep capturesDir |
| true  | any      | any          | Keep capturesDir (video is there) |

> **Inversion-prone**: the condition for "should we clean up?" is `!video && !keepCaptures && failures === 0`. All three must be false/zero. Test both true and false for each independently.

#### A3. Add `video` option to `runRunbook()` signature

- File: `lib/runner.js`
- Add `video` to the destructured opts (alongside `headless`, `cdpPort`, etc.)
- Default: `false`

#### A4. Import `createCaptureSession` and `closeCaptureSession`

- File: `lib/runner.js`
- Add import: `import { createCaptureSession, closeCaptureSession } from "sitecap/browser";`
- Verify the import path matches sitecap's exports map (currently exports `"./browser"` → `"./lib/browser.js"`)

### Phase B — CLI & API Surfaces (SRL, depends on A)

#### B1. Add `--video` CLI flag

- File: `bin/sitetest.js`
- Add `--video` boolean flag to the `run` command argument parser
- Pass through to `runRunbook({ ..., video: true })`

#### B2. Add `video` to run result

- File: `lib/runner.js`
- The result object returned by `runRunbook()` currently has `{ runbook, passed, failed, duration_ms, steps }`.
- Add `videoPath: string | null` — the path to the `.webm` file, or null if video was not enabled/failed.

#### B3. Update `runOp` operation schema

- File: `lib/operations.js`
- Add `video: z.boolean().default(false)` to `runOp`'s input schema
- Pass `video` through to `runRunbook()`
- Add `videoPath: z.string().nullable()` to result if the operation returns structured data

#### B4. Regenerate API surfaces

- Run `make generate` to regenerate MCP tools, REST routes, and OpenAPI from updated operations
- Files affected: `generated/mcp-tools.js`, `generated/rest-routes.js`, `generated/openapi.json`, `generated/tools.json`

### Phase C — Reporter & Library Exports (SRL, depends on B)

#### C1. Report video path in terminal output

- File: `lib/reporter.js`
- When `result.videoPath` is non-null, print the video path at the end of the run summary
- Format: `Video: __captures__/runbook-name/session-video.webm`

#### C2. Include video path in JSON/JUnit output

- File: `lib/reporter.js`
- JSON output: add `"videoPath"` field to root object
- JUnit XML: add `<property name="videoPath" value="..." />` to `<testsuite>` properties

#### C3. Library exports — no change needed

- `lib/index.js` already exports `run` (alias for `runRunbook`). The new `video` option flows through automatically.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Unify page creation through `createCaptureSession()` | Yes — both video and non-video paths use it | Single code path, less branching in runner. sitecap handles the conditional internally. |
| Video output location | `capturesDir` (`__captures__/<runbook>/`) | Consistent with existing capture artifacts. Already has cleanup logic. |
| Default viewport | `1280x720` hardcoded initially | Matches Playwright default. Can add `--viewport` flag later if needed. |
| CDP-attached sessions | Video may not work when attaching to existing Chrome via CDP | Playwright requires context creation for video. Document this limitation. Flag it in output if video was requested but CDP attach is used. |

**CDP limitation detail:** When connecting via CDP (`chromium.connectOverCDP()`), `createCaptureSession()` creates a *new* context. This works. But if the user expected to record an *existing* browser tab, that's not supported. The current runner already creates a new page even in CDP mode, so this is not a behavior change.

## Dependency Direction

```
bin/sitetest.js → lib/runner.js → sitecap/browser (createCaptureSession, closeCaptureSession)
                                 → sitecap/capture (setupNetworkCapture, etc. — unchanged)
lib/operations.js → lib/runner.js (unchanged direction)
lib/reporter.js ← lib/runner.js result (reads videoPath from result)
```

No new dependency directions introduced. `runner.js` already depends on sitecap; this adds one more import from a different sitecap subpath.

## Test Assertions

New test file: `test/video.test.js`

- `assert.strictEqual(result.videoPath, null)` — when `video` is not passed
- `assert.ok(result.videoPath)` — when `video: true` and headless
- `assert.ok(result.videoPath.endsWith('.webm'))` — correct file extension
- `assert.ok(fs.existsSync(result.videoPath))` — file actually exists on disk
- `assert.ok(fs.statSync(result.videoPath).size > 0)` — file is not empty

Cleanup logic tests (in existing or new test):
- `assert.ok(!fs.existsSync(capturesDir))` — when `video: false`, no failures, `keepCaptures: false` → dir removed
- `assert.ok(fs.existsSync(capturesDir))` — when `video: true`, no failures → dir kept

## Agent Team

Recommended: No — Phase A modifies runner.js which Phase B and C depend on for the new option and result shape. Sequential execution required.

## Before Closing

- [ ] Run `make check` (lint + test pass)
- [ ] Run `make generate` and verify generated files are updated
- [ ] Verify `sitetest run <runbook> --video --headless` produces a `.webm` file
- [ ] Verify `sitetest run <runbook> --headless` (no `--video`) produces no video and cleans up captures as before
- [ ] For every boolean condition (`video`, `keepCaptures`, `failures`), verify both True and False paths are covered by tests
- [ ] Confirm CDP-attach mode doesn't crash when `--video` is passed
