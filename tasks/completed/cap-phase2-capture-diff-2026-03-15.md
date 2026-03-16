# CAP-1 through CAP-4: Capture + Diff

## Context

Phase 1 delivered the core runner with a stub `capture` step that records captures to `ctx.captures` but does nothing. Phase 2 wires sitecap's `capturePage()` into the runner, adds baseline management, and implements 5-type diffing (screenshot, accessibility, console, network, storage — HTML off by default).

`no_console_errors` and `no_network_errors` already exist in `assertions.js` from Phase 1. `a11y_complete` does not.

## Goals

- `capture` step calls sitecap's `capturePage()` and saves/diffs against baselines
- `sitetest update` CLI command accepts current captures as new baselines
- Library API exports `update()` for sitefix.dev
- `a11y_complete` invariant assertion added

## Design Decisions

### Baseline + capture directory layout

Baselines live relative to the **runbook file**, not cwd:

```
runbooks/
  login-flow.yaml
  __baselines__/
    login-flow/
      dashboard/
        screenshot.png
        accessibility.txt
        console.json
        network.json
        storage.json
        meta.json
      settings/
        ...
```

Current-run captures go to a temp directory under `__captures__/<runbook-name>/<capture-name>/`. This directory is cleaned up after the run unless `--keep-captures` is passed or a diff fails (keep for inspection).

### Baseline resolution

```
baselinesDir = resolve(dirname(runbookPath), "__baselines__", runbookName)
captureDir   = resolve(dirname(runbookPath), "__captures__", runbookName)
```

`runbookName` is derived from the runbook's `name` field (slugified), falling back to the filename without extension.

### Capture step behavior

| `baseline` | `diff` | Behavior |
|-----------|--------|----------|
| true | false | Capture → save to baselines dir (overwrite if exists) |
| false | true | Capture → save to captures dir → diff against baseline → report |
| true | true | Invalid — error at parse time |
| false | false | Capture → save to captures dir (no diff, just record) |

### Diff result shape

Each diff type returns:

```js
{ type: "screenshot", passed: false, reason: "2.3% pixels differ (threshold 0.1%)", diffPath: "..." }
```

A capture step fails if **any** diff type fails. All diff types run regardless (no short-circuit) — report all failures.

### Dependencies to add

- `pixelmatch` — screenshot pixel comparison
- `pngjs` — PNG decode/encode for pixelmatch (reads PNG buffers)

### How `update` works

`update(runbookPath)` copies every capture from `__captures__/<name>/` to `__baselines__/<name>/`, overwriting existing baselines. Requires a prior run — if `__captures__` is empty, error.

`update --all` does the same for every runbook in a directory.

## Files to Modify

| File | Changes |
|------|---------|
| `lib/baseline.js` | **New.** `saveBaseline(name, captureDir, baselinesDir)`, `loadBaseline(name, baselinesDir)`, `updateBaselines(runbookPath)` |
| `lib/diff.js` | **New.** `diffCaptures(captureDir, baselineDir, opts)` → returns array of diff results per type. Screenshot via pixelmatch, others via JSON/text set diff |
| `lib/steps.js` | Replace capture stub with real implementation: call `capturePage()`, then save or diff based on flags |
| `lib/assertions.js` | Add `a11y_complete` — parse aria snapshot, find interactive elements without names |
| `lib/runner.js` | Pass `baselinesDir` and `capturesDir` in ctx. Clean up captures dir after run. Accept `baselinesDir` in opts |
| `lib/index.js` | Export `update` |
| `bin/sitetest.js` | Add `update` subcommand |
| `package.json` | Add `pixelmatch`, `pngjs` deps |

## Diff Logic Per Type

### Screenshot (`screenshot.png`)

Read both PNGs with `pngjs`, run `pixelmatch(baseline, current, diff, width, height, { threshold: 0.1 })`. Threshold is fraction of pixels (0.001 = 0.1%). If mismatch count / total pixels > threshold → fail. Write diff PNG to capture dir as `screenshot-diff.png`.

**Edge case:** if dimensions differ, fail immediately with "dimensions changed" message (don't attempt pixelmatch).

### Accessibility (`accessibility.txt`)

Line-by-line text comparison. Split both files by newline, diff as sets. Report added/removed lines. Only interactive element lines matter — filter lines containing role keywords (`button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, `listbox`, `menuitem`).

### Console (`console.json`)

Parse both as JSON arrays. Extract `type: "error"` entries. Compare error message sets (by `text` field). Report new errors not in baseline.

### Network (`network.json`)

Parse both as JSON arrays. Build sets of `"${method} ${url} → ${status}"` strings. Report new/missing entries.

### Storage (`storage.json`)

Compare cookie names (set diff) and localStorage keys (set diff). Report new/removed.

## a11y_complete Assertion

Parse the current page's aria snapshot (`page.locator(":root").ariaSnapshot()`). Find lines matching interactive roles (`button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, `listbox`, `menuitem`). Flag any that have empty or missing names. Report count and first 3 examples.

Pattern to match: a line like `- button ""` or `- link` (no quoted name) indicates unnamed interactive element.

## Test Assertions

### diff.js

- `assert.equal(result.length, 0)` when baseline and capture are identical files
- `assert.equal(result[0].passed, false)` when screenshot has >0.1% pixel diff
- `assert.equal(result[0].type, "screenshot")` and `reason` contains "pixels differ"
- `assert.equal(result[0].passed, false)` when console has new error not in baseline
- `assert.equal(result[0].passed, true)` when console errors match baseline exactly
- `assert.equal(result[0].passed, false)` when network has new/missing URL

### baseline.js

- `assert.ok(existsSync(baselineDir + "/screenshot.png"))` after `saveBaseline`
- `assert.throws(() => updateBaselines("nonexistent.yaml"))` when no captures exist

### assertions.js (a11y_complete)

- `failures.length === 0` when all interactive elements have names
- `failures[0].key === "a11y_complete"` when unnamed button exists

## Agent Team

Recommended: No — sequential dependencies. `diff.js` needs `baseline.js` directory logic. `steps.js` capture implementation needs both. All files share the same baseline/capture directory conventions.

## Before Closing

- [ ] Run `node --test test/*.test.js` — all pass
- [ ] Verify screenshot diff handles mismatched dimensions without crashing
- [ ] Verify capture step with `baseline: true` overwrites existing baseline
- [ ] Verify capture step with `diff: true` fails clearly when no baseline exists
- [ ] Verify `__captures__` dir is cleaned up after successful run
- [ ] Verify `a11y_complete` correctly parses Playwright's ariaSnapshot format
- [ ] For diff boolean logic: both "baseline matches" and "baseline differs" paths are tested per type
