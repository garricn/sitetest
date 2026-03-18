# FEAT-4: Multi-Variant Baselines

## Context

sitetest currently captures and diffs a single viewport (hardcoded 1280x720). Real-world sites need testing across viewports and color schemes. When sitecap outputs `<page>/<viewport>[-dark]/` structure, sitetest should capture and diff per variant with baselines namespaced accordingly.

**Goal:** Add a `variants` section to runbooks. The runner loops over variants, re-running all steps for each. Capture steps produce nested baseline/capture directories per variant.

## Design Decisions

### Runbook-level variants (not per-step)

Variants are declared at the runbook top level. The runner loops over all variants, re-executing the full step list for each. This matches the real use case: test the whole flow at mobile, desktop, and dark mode — not just one capture step.

```yaml
name: homepage-test
site: https://example.com
variants:
  - name: desktop
    viewport: { width: 1280, height: 720 }
  - name: mobile
    viewport: { width: 375, height: 667 }
  - name: mobile-dark
    viewport: { width: 375, height: 667 }
    colorScheme: dark
steps:
  - goto: /
  - wait: settle
  - capture: { name: homepage, baseline: true }
```

When `variants` is omitted, behavior is unchanged — single run at default viewport. This is the backwards-compatibility path.

| variants present | behavior |
|---|---|
| Yes | Loop over variants, re-run steps for each, namespace baselines |
| No | Single run at 1280x720 (current behavior) |

### Variant naming

Each variant has a `name` field used as the directory segment. If omitted, auto-generate from `{width}x{height}[-{colorScheme}]`.

| name | viewport | colorScheme | directory |
|---|---|---|---|
| `desktop` | 1280x720 | — | `desktop/` |
| (omitted) | 375x667 | dark | `375x667-dark/` |
| `tablet` | 768x1024 | — | `tablet/` |

### Baseline directory structure

```
__baselines__/<runbook>/
  <capture-name>/
    <variant>/
      screenshot.png
      accessibility.txt
      ...
```

When no variants: `__baselines__/<runbook>/<capture-name>/` (flat, same as today). This ensures existing baselines aren't invalidated.

### Color scheme injection

Use Playwright's `page.emulateMedia({ colorScheme: 'dark' })`. This is a page-level setting, applied once per variant before step execution begins. No CSS injection needed.

### Viewport change

Use `page.setViewportSize({ width, height })` at the start of each variant loop. Playwright supports this on existing pages without creating a new context.

## Files to Modify

### `lib/runner.js` — Add variant loop

**Current flow:**
1. Create browser context + page
2. Run all steps
3. Close

**New flow:**
1. Create browser context + page
2. Parse `runbook.variants` (default: `[{ name: null }]` for no-variant mode)
3. For each variant:
   a. Set viewport via `page.setViewportSize()`
   b. Set color scheme via `page.emulateMedia()` if specified
   c. Set `ctx.variant` (string or null)
   d. Run all steps
   e. Accumulate step results (tag each with variant name for reporting)
4. Close

**Context changes:** Add `ctx.variant` (string | null). When non-null, capture/baseline/diff functions use it as a subdirectory.

### `lib/steps.js` — Variant-aware capture paths

In the `capture` case, nest the capture output dir and baseline lookup under the variant:

- Capture output: `resolve(ctx.capturesDir, captureName, ctx.variant || "")` — when variant is null, resolves to flat path (backwards-compatible)
- Baseline save: `saveBaseline(captureName, captureOutDir, ctx.baselinesDir, ctx.variant)`
- Baseline lookup: `baselinePath(captureName, ctx.baselinesDir, ctx.variant)`
- Diff: `diffCaptures(captureOutDir, baseDir, opts)` — no change to diff itself

### `lib/baseline.js` — Accept optional variant parameter

Update `saveBaseline`, `baselineExists`, and `baselinePath` to accept an optional `variant` parameter:

- `baselinePath(captureName, baselinesDir, variant)` → `join(baselinesDir, captureName, variant || "")`
- `saveBaseline(captureName, sourceDir, baselinesDir, variant)` → copies to variant-nested path
- `baselineExists(captureName, baselinesDir, variant)` → checks variant-nested path

When `variant` is null/undefined, behavior is identical to today.

### `lib/reporter.js` — Tag results with variant

Step results should include the variant name for output clarity:

```
✓ [desktop] goto /
✓ [desktop] capture "homepage"
✓ [mobile-dark] goto /
✗ [mobile-dark] capture "homepage" — screenshot: 12.3% pixel diff
```

Add variant prefix to step labels when `ctx.variant` is non-null.

### `test/variants.test.js` — New integration test

**Test server:** Simple HTTP server returning HTML with viewport-dependent content (CSS media queries showing different text at different widths).

**Test cases:**

1. **Two variants produce separate baselines**
   - Run with `variants: [{ name: "wide", viewport: {width: 1280, height: 720} }, { name: "narrow", viewport: {width: 375, height: 667} }]`
   - Capture with `baseline: true`
   - Assert both `__baselines__/<runbook>/homepage/wide/screenshot.png` and `__baselines__/<runbook>/homepage/narrow/screenshot.png` exist
   - `assert.equal(result.failed, 0)`

2. **Diff detects per-variant regressions**
   - Save baselines for two variants
   - Modify server response
   - Run with `diff: true`
   - Assert diff failures appear tagged with variant name

3. **No variants = backwards-compatible**
   - Run without `variants` key
   - Assert baselines are flat (no variant subdir)
   - `assert.equal(result.failed, 0)`

4. **Auto-generated variant names**
   - Omit `name` from variant config
   - Assert directory name is `{width}x{height}` or `{width}x{height}-{colorScheme}`

5. **Color scheme variant**
   - Run with `colorScheme: "dark"` variant
   - Assert `page.emulateMedia()` was applied (capture should reflect dark mode)

### `test/baseline.test.js` — Add variant parameter tests

- `baselinePath("capture", dir, "desktop")` → `join(dir, "capture", "desktop")`
- `baselinePath("capture", dir, null)` → `join(dir, "capture")` (unchanged)
- `saveBaseline("capture", src, dir, "mobile")` → files in `dir/capture/mobile/`

## Dependency Direction

```
runner.js → steps.js (passes ctx.variant — no new imports)
steps.js → baseline.js (passes variant param — existing import)
baseline.js (adds optional variant param — no new imports)
reporter.js (reads ctx.variant for labels — no new imports)
diff.js (no changes)
```

## Prerequisite: sitecap VARIANT-1

The task description says "depends on sitecap VARIANT-1" but the research shows sitetest can implement this independently. Sitetest creates its own capture directories via `capturePage()` — it controls the output path. Sitecap's output structure only matters for `discover()`, which is out of scope for this task.

**Recommendation:** Remove the dependency. Implement FEAT-4 standalone. If sitecap later adds variant output, `discover()` can be updated separately to parse it.

## Validation

### Automated (local + CI)

- `make check` — lint + all tests including new `test/variants.test.js`
- Integration tests with real Playwright verifying viewport changes affect screenshots
- Baseline test updates verifying nested directory paths
- No mocking — real browser, real file I/O

### Manual

- None required.

## Agent Team

Recommended: No — changes span runner → steps → baseline in a tight dependency chain. Each layer depends on the prior layer's interface.

## Before Closing

- [ ] Run `make check` (lint + tests pass)
- [ ] Verify no-variant runbooks still work identically (backwards compatibility)
- [ ] Verify existing baselines are not invalidated (flat path when no variants)
- [ ] For every boolean condition (variant present/absent), verify both paths tested
- [ ] Verify `page.setViewportSize()` and `page.emulateMedia()` are called correctly per variant
- [ ] Clean up temp directories in test `after()` hooks
