# sitetest — Behavior Test Engine for Web UIs

## Context

sitetest is a standalone product (sitetest.dev) and an a la carte module within the sitefix.dev pipeline. It has two jobs:

1. **Discover** — read a page's interactive elements (from sitecap's aria tree + sitegrade's testability analysis), generate structured test runbooks
2. **Run** — execute runbooks against a live site via CDP, report pass/fail

**Standalone (sitetest.dev):** Users who just want behavior testing for their site. Connect to Chrome, discover testable behaviors, generate and run runbooks. No need to buy the full sitefix.dev pipeline.

**Within sitefix.dev:** The testing layer in `sitecap (capture) → sitegrade (analyze) → sitetest (test) → sitefix (fix)`. sitefix.dev orchestrates sitetest as part of the scan-fix-verify cycle.

The primary runbook author is an agent (LLM), not a human. The format is optimized for reliable machine generation and deterministic execution — not human readability. Humans review and approve runbooks; they don't hand-write them.

No existing tool combines: (1) CDP-attach to a running Chrome with real auth, (2) structured runbook execution, (3) multi-type capture assertions via sitecap, and (4) auto-discovery of testable behaviors from accessibility tree analysis.

## Goals

- Standalone product at sitetest.dev, also available as a la carte module in sitefix.dev
- Execute behavior test runbooks against live sites via CDP-attached Chrome (inherit cookies/auth)
- Auto-discover testable behaviors from sitecap aria tree + sitegrade testability scores
- Support behavioral assertions (did the action work?) and capture-diff assertions (does the page still look right?)
- Use capture-as-fallback for low-confidence assertions where expected outcome is unknown
- First-class CLI, first-class library API — both are primary interfaces

## Architecture

```
sitetest
  ├── discover   — reads sitecap aria tree + sitegrade findings → emits runbooks
  ├── runner     — parses + executes runbooks step-by-step
  ├── assertions — behavioral checks (url, element state, content)
  ├── diff       — capture-based checks (screenshot, aria, console, network, storage)
  └── reporter   — terminal + JSON output
      ↓
  sitecap/lib/capture.js  (6-type page capture)
  playwright              (CDP connection + interactions)
```

### Distribution

| Surface | How sitetest is used |
|---------|---------------------|
| sitetest.dev (standalone SaaS) | Users sign up, connect Chrome or provide URL, discover + run tests, manage baselines, view results |
| sitetest CLI (npm package) | `sitetest discover`, `sitetest run` — local dev, CI/CD pipelines |
| sitetest library (npm package) | `import { discover, run, update } from 'sitetest'` — consumed by sitefix.dev and other tools |
| sitefix.dev (a la carte module) | sitefix orchestrator calls sitetest as part of scan → fix → verify pipeline |

### Dependency Resolution

sitetest depends on sitecap. Both are local ESM packages. Resolution via `file:` dependency in package.json:

```json
{ "dependencies": { "sitecap": "file:../sitecap" } }
```

For production/npm: publish sitecap first, reference by version.

## Discovery

`sitetest discover` reads sitecap's accessibility snapshot and sitegrade's testability analysis to enumerate interactive elements and generate test runbooks.

### Input

1. **sitecap aria tree** (`accessibility.txt`) — structured list of every interactive element with role, name, and state
2. **sitegrade testability findings** (optional) — which elements have accessible names, which don't, overall testability score

### Discovery Logic

Parse the aria tree. For each interactive element, classify by confidence:

| Element type | Discoverable action | Expected outcome | Confidence |
|---|---|---|---|
| `link` with href | click | URL changes to href | High |
| `button` with form context | click | form submits, URL or content changes | Medium |
| `button` (standalone) | click | unknown — use capture diff | Low |
| `textbox` | fill with test value | value accepted, no error shown | Medium |
| `checkbox` / `radio` | toggle | checked state flips | High |
| `combobox` / `listbox` | select first option | value changes | Medium |
| `navigation` > `link` | click each | URL changes per href | High |

### Confidence Handling

- **High** — generate runbook with explicit `assert` (url, element state)
- **Medium** — generate runbook with `assert` + `capture` as safety net
- **Low** — generate runbook with `capture` only (baseline mode). First run captures baseline. Agent or human reviews and confirms. Subsequent runs diff against baseline.

### Discovery Output

A YAML runbook per page (or per logical flow):

```yaml
name: discover-login
site: https://app.example.com
source: auto-discover
confidence: mixed
generated: 2026-03-15T21:00:00Z

steps:
  - goto: /login
  - wait: settle
  - capture: { name: "login-initial", baseline: true }

  # High confidence — link with known href
  - click: { selector: "a[href='/forgot-password']" }
  - wait: settle
  - assert: { url: /forgot-password }
  - goto: /login

  # Medium confidence — form submission
  - fill: { selector: "[name='email']", value: "$TEST_EMAIL" }
  - fill: { selector: "[name='password']", value: "$TEST_PASSWORD" }
  - click: { selector: "button[type='submit']" }
  - wait: settle
  - assert: { url_changed: true, no_console_errors: true }
  - capture: { name: "after-login-submit", baseline: true }

  # Low confidence — standalone button, unknown effect
  - goto: /login
  - click: { selector: "button.theme-toggle" }
  - wait: settle
  - capture: { name: "after-theme-toggle", diff: true }
```

The `source: auto-discover` field marks this as machine-generated. The `confidence` field tells reviewers how much human verification is needed.

## Runbook Format

YAML. Each runbook is a named flow with sequential steps. Optimized for deterministic execution — no conditionals, no loops, no dynamic logic. An agent generates multiple runbooks for different flows rather than one complex runbook with branching.

### Step Types

| Step | Description | Timeout |
|------|-------------|---------|
| `goto` | Navigate to URL (absolute or relative to `site`) | 30s |
| `click` | Click element by Playwright selector | 10s |
| `fill` | Clear + type into input field | 5s |
| `select` | Select dropdown option by value or label | 5s |
| `check` / `uncheck` | Toggle checkbox | 5s |
| `press` | Keyboard key press (e.g., `Enter`, `Tab`) | 5s |
| `scroll` | Scroll to element or coordinates | 5s |
| `hover` | Hover over element | 5s |
| `wait` | Wait for condition (see below) | 30s |
| `assert` | Behavioral assertion (see below) | 10s |
| `capture` | Run sitecap 6-type capture | 30s |
| `run` | Execute a sub-flow by name/path | inherited |

All timeouts are defaults. Each step can override with `timeout: <ms>`.

### Wait Conditions

`wait` supports four modes:

```yaml
- wait: settle              # network idle (no requests for 500ms) + no DOM mutations for 500ms
- wait: { selector: ".loaded" }   # element appears in DOM
- wait: { url: /dashboard }       # URL matches pattern
- wait: { ms: 2000 }              # fixed delay (discouraged, last resort)
```

**"settle" definition:** No in-flight network requests (XHR/fetch) for 500ms AND no DOM mutations (via MutationObserver) for 500ms. Max wait 10s, then proceed. This aligns with sitecap's planned `waitForPageSettle()` (CORE-2).

### Assert Options

All keys in a single assert step are evaluated. All must pass. Failures report every failing key, not just the first.

```yaml
# Navigation
url: /expected-path              # exact match or regex (prefix with ~ for regex: ~^/users/\d+)
url_changed: true                # URL is different from before the preceding action
title: "Page Title"

# Content
contains: "text on page"
not_contains: "error message"
element:
  selector: ".foo"
  visible: true                  # default true if element key present
  text: "bar"                    # text content matches
  count: 3                       # number of matching elements
  enabled: true                  # not disabled
  checked: true                  # for checkboxes/radios

# State
cookie: { name: "session", exists: true }
localStorage: { key: "token", exists: true }

# Network
request: { url: "/api/data", status: 200 }

# Invariants
no_console_errors: true          # no console.error since last step
no_network_errors: true          # no 4xx/5xx responses since last step
a11y_complete: true              # no unnamed interactive elements in current aria tree
```

### Capture + Diff

When a `capture` step runs:

- Calls sitecap's `capturePage(page, outDir, opts)` to produce all 6 files
- `baseline: true` — save as reference in `__baselines__/<runbook-name>/<capture-name>/`
- `diff: true` — compare against saved baseline

Diff logic per capture type:

| Type | Diff method | Threshold |
|------|-------------|-----------|
| Screenshot | pixelmatch pixel comparison | 0.1% different pixels (configurable) |
| Accessibility | Line-by-line text diff | Any addition/removal of interactive elements |
| Console | Set diff on error-type messages | Any new error not in baseline |
| Network | Set diff on XHR/fetch URLs + status codes | Any new/missing URL or changed status |
| Storage | Key diff on cookies + localStorage | Any new/removed key |
| HTML | Off by default (too noisy) | N/A |

Baseline management:

```
__baselines__/
  login-flow/
    login-initial/
      screenshot.png
      accessibility.txt
      console.json
      network.json
      storage.json
    after-submit/
      ...
```

`sitetest update <runbook>` accepts current captures as new baselines. `sitetest update --all` accepts all.

### Env Vars / Secrets

Runbooks reference env vars with `$VAR` syntax. Resolved at runtime from `.env` file or shell environment. Never stored in runbook files or baselines.

```yaml
- fill: { selector: "#password", value: "$TEST_PASSWORD" }
```

Env resolution happens in Phase 1 (required for any auth flow testing).

### Sub-flows

Common sequences (login, navigate-to-settings) defined as separate runbook files and invoked with `run`:

```yaml
# flows/login.yaml
name: login
steps:
  - goto: /login
  - fill: { selector: "[name='email']", value: "$TEST_EMAIL" }
  - fill: { selector: "[name='password']", value: "$TEST_PASSWORD" }
  - click: "button[type='submit']"
  - wait: settle
  - assert: { url: /dashboard }
```

```yaml
# runbooks/settings.yaml
steps:
  - run: flows/login
  - click: "nav >> text=Settings"
  - assert: { url: /settings }
```

## CLI

First-class standalone CLI and library API. Used directly by developers/CI and programmatically by sitefix.dev.

```
sitetest discover <sitecap-dir> [--sitegrade <findings.json>] [--out <dir>]
sitetest run <runbook.yaml>
sitetest run <dir>                    # run all runbooks in directory
sitetest run <runbook.yaml> --headed  # attach to running Chrome (default)
sitetest run <runbook.yaml> --headless  # launch headless Chrome for CI
sitetest update <runbook.yaml>        # accept current captures as baselines
sitetest update --all
sitetest list <dir>                   # list runbooks with last pass/fail status
```

Default is `--headed` (attach to running Chrome via CDP). `--headless` launches a clean browser.

### Output

Terminal (default):

```
sitetest run runbooks/login-flow.yaml

  login-flow
    ✓ goto /login                          12ms
    ✓ wait settle                         340ms
    ✓ capture "login-initial" (baseline)  1.2s
    ✓ fill [name='email']                  45ms
    ✓ fill [name='password']               38ms
    ✓ click button[type='submit']          22ms
    ✓ wait settle                         890ms
    ✓ assert url /dashboard                 2ms
    ✓ assert no_console_errors              1ms
    ✗ capture "after-login" — screenshot diff 2.3% (threshold 0.1%)
      → diff: __baselines__/login-flow/after-login/screenshot-diff.png

  1 failed, 9 passed (2.6s)
```

JSON (`--output json`):

```json
{
  "runbook": "login-flow",
  "passed": 9,
  "failed": 1,
  "duration_ms": 2600,
  "steps": [
    { "type": "goto", "target": "/login", "status": "passed", "duration_ms": 12 },
    { "type": "capture", "name": "after-login", "status": "failed",
      "reason": "screenshot diff 2.3% exceeds threshold 0.1%",
      "diff_path": "__baselines__/login-flow/after-login/screenshot-diff.png" }
  ]
}
```

## Library API

The primary interface for sitefix.dev integration:

```js
import { discover, run, update } from 'sitetest';

// Discovery — generate runbooks from sitecap output
const runbooks = await discover({
  sitecapDir: './captures/example.com',
  sitegradeFindings: findings,  // optional, from sitegrade analysis
  outDir: './runbooks',
});

// Execution — run a runbook against a live page
const result = await run({
  runbook: './runbooks/login-flow.yaml',
  // or: runbook: parsedRunbookObject,
  cdpPort: 9222,          // default, attach to running Chrome
  // or: headless: true,  // launch clean browser
  env: { TEST_EMAIL: '...', TEST_PASSWORD: '...' },
  baselinesDir: './__baselines__',
});

// result: { passed, failed, steps[], duration_ms }

// Baseline update
await update({ runbook: './runbooks/login-flow.yaml', baselinesDir: './__baselines__' });
```

## Tech Stack

- Node.js (ESM)
- Playwright — browser control (connectOverCDP + interaction APIs)
- sitecap — 6-type page capture (`file:../sitecap` dep)
- pixelmatch — screenshot diffing
- js-yaml — runbook parsing
- No build step, no TypeScript (plain JS with JSDoc types)

## Project Structure

```
bin/sitetest.js        — CLI entry point (commander or similar)
lib/index.js           — library API exports (discover, run, update)
lib/discover.js        — aria tree parser, runbook generator, confidence classification
lib/runner.js          — runbook executor (parse YAML, iterate steps, collect results)
lib/steps.js           — step implementations (goto, click, fill, wait, etc.)
lib/assertions.js      — behavioral assertion logic (url, element, content, invariants)
lib/diff.js            — capture diff logic (pixelmatch, text diff, JSON diff)
lib/baseline.js        — baseline read/write/update
lib/settle.js          — waitForSettle implementation (network idle + DOM quiet)
lib/reporter.js        — terminal + JSON output formatting
lib/env.js             — $VAR resolution from .env + process.env
```

## Phases

### Phase 1 — Core Runner + Env

- package.json with sitecap `file:` dependency
- CLI entry point (`sitetest run`)
- Runbook parser (YAML → step array)
- CDP connection (attach to running Chrome or launch headless, reuse sitecap's pattern)
- `waitForSettle` implementation (network idle 500ms + DOM quiet 500ms, 10s max)
- Step execution: goto, click, fill, select, check/uncheck, press, scroll, hover, wait
- Env var resolution ($VAR syntax from .env + process.env) — required for auth flows
- Behavioral assertions: url, url_changed, title, contains, not_contains, element (visible/text/count/enabled/checked), cookie, localStorage, request
- Error handling: per-step timeout with clear failure message, fail-fast by default
- Terminal reporter (step-by-step pass/fail with timing)
- Library API: `run()` function

### Phase 2 — Capture + Diff

- Import sitecap's `capturePage()` for capture steps
- Baseline save/load to `__baselines__/` directories
- Screenshot diff with pixelmatch (configurable threshold)
- Accessibility tree text diff (flag added/removed interactive elements)
- Console diff (flag new errors)
- Network diff (flag new/missing URLs, changed status codes)
- Storage diff (flag new/removed keys)
- `sitetest update` command for baseline management
- Invariant assertions: no_console_errors, no_network_errors, a11y_complete
- Library API: `update()` function

### Phase 3 — Discovery

- Aria tree parser (sitecap `accessibility.txt` → structured element list)
- Confidence classification per element type
- Runbook generator (elements → YAML runbook with appropriate assertions per confidence)
- sitegrade testability integration (consume findings to skip untestable elements)
- `sitetest discover` CLI command
- Library API: `discover()` function

### Phase 4 — Advanced

- Sub-flows (`run` step type, flow file resolution)
- JSON output mode (`--output json`)
- `--continue-on-error` flag (run all steps, report all failures)
- `sitetest list` command
- JUnit XML output for CI systems

## Before Closing

- [ ] Run lint + tests pass
- [ ] Verify `waitForSettle` handles SPAs (no false positives from long-polling or websockets)
- [ ] Verify env vars resolve before any step executes (fail early if $VAR is missing)
- [ ] Verify capture diff thresholds are configurable per-runbook and per-capture
- [ ] Verify CDP-attach is the default mode, headless is opt-in
- [ ] Verify library API matches what sitefix.dev orchestrator needs (discover, run, update)
- [ ] Verify all assertions evaluate fully (report all failures, not just first)
- [ ] For every boolean condition in assertion logic, verify both True and False paths are tested
