# FEAT-2: Cookie Persistence for Authenticated E2E Runs

## Context

sitetest runbooks execute in isolated browser contexts. When testing authenticated flows, every runbook must repeat the login sequence. This is slow, fragile (login flows break tests unrelated to login), and doesn't reflect real user sessions where cookies persist.

**Goal:** Add `cookies: save` and `cookies: load` steps so one runbook can authenticate and save the session, and subsequent runbooks can load it and run authenticated — no repeated login.

## Design Decisions

### Step name: `cookies` (not `cookie`)

Consistent with Playwright's `context.cookies()` (plural). A single step type with an `action` discriminator keeps the YAML surface small.

### YAML format

```yaml
# Save all cookies to a file
- cookies: save
  file: .cookies/session.json

# Load cookies from a file
- cookies: load
  file: .cookies/session.json

# Clear all cookies
- cookies: clear
```

**`file` is a top-level step key** (like `timeout`), parsed alongside the step definition. `parseStep()` in steps.js already strips `timeout`; extend it to strip `file` and attach to `def`.

**`save` / `load` / `clear` are string values** — no nested object needed for the common case. This matches the existing pattern where simple steps use string defs (`click: "button"`, `wait: settle`).

### File path resolution

| `file` value | Resolution |
|---|---|
| Absolute path | Used as-is |
| Relative path | Resolved from `ctx.runbookDir` |
| Omitted | Error for save/load; n/a for clear |

`ctx.runbookDir` already exists in the runner context — it's the directory containing the runbook YAML. Cookie files live alongside runbooks by convention.

### Cookie file format

Raw JSON array from Playwright's `context.cookies()`:

```json
[
  { "name": "session_id", "value": "abc123", "domain": ".example.com", "path": "/", "expires": 1742500000, "httpOnly": true, "secure": true, "sameSite": "Lax" }
]
```

No wrapper object, no metadata. Playwright's format is the format — zero transformation means zero bugs.

### What gets saved

**All cookies** from the browser context. No filtering by domain or name. Rationale: auth sessions often involve multiple cookies (CSRF tokens, session IDs, feature flags set at login). Filtering risks breaking auth. Users who need selective save can filter the JSON file externally.

## Files to Modify

### `lib/steps.js` — Add `cookies` case to `executeStepInner()`

- Parse `action` from `def` (string value: `"save"`, `"load"`, `"clear"`)
- `save`: `await writeFile(filePath, JSON.stringify(await page.context().cookies(), null, 2))`
- `load`: `await page.context().addCookies(JSON.parse(await readFile(filePath, "utf8")))`
- `clear`: `await page.context().clearCookies()`
- `save` and `load` must validate that `file` is present; throw if missing
- `save` must `mkdir` parent directory (recursive) before writing

Add corresponding case in `stepLabel()`:
- `"save"` → `cookies → save → <file>`
- `"load"` → `cookies → load → <file>`
- `"clear"` → `cookies → clear`

### `lib/steps.js` — Extend `parseStep()` to extract `file`

Currently strips `timeout` from object-form steps. Also strip `file` and attach it to `def` as `def.file` (or return it alongside `type`, `def`, `timeout`).

**Decision:** Return `{ type, def, timeout, file }` from `parseStep()`. Update `executeStep()` to pass `file` into `executeStepInner()` or attach to `def`. Prefer attaching to context over modifying `def` — but since `def` is already the step-specific payload, attaching `file` to `def` is cleanest:

```
parseStep extracts file → sets def = { action: "save", file: "path" }
```

For string defs like `cookies: save`, `def` is the string `"save"`. When `file` is present, convert to `{ action: "save", file: "path" }`.

| def type | file present | result |
|---|---|---|
| string `"save"` | yes | `{ action: "save", file: "path" }` |
| string `"save"` | no | error (file required for save/load) |
| string `"clear"` | no | `"clear"` (no file needed) |

### `test/cookies.test.js` — New integration test file

**Test server:** HTTP server that:
- `GET /login` → sets `Set-Cookie: session=abc123; Path=/` and redirects to `/dashboard`
- `GET /dashboard` → returns 200 if `session` cookie present, 401 otherwise
- `GET /api/me` → returns 200 with `{"user":"test"}` if `session` cookie present, 401 otherwise

**Test cases:**

1. **Save and load round-trip**
   - Run steps: `goto: /login`, `cookies: save` with file, clear context, `cookies: load` from file, `goto: /dashboard`, `assert: { status: 200 }`
   - `assert.equal(result.failed, 0)`

2. **Load restores authentication**
   - Pre-write a cookie JSON file with valid session cookie
   - Run steps: `cookies: load`, `goto: /dashboard`, `assert: { cookie: { name: "session", exists: true } }`
   - `assert.equal(result.failed, 0)`

3. **Clear removes all cookies**
   - Run steps: `goto: /login`, `cookies: clear`, `goto: /dashboard`
   - Assert dashboard returns 401 (or assert cookie doesn't exist)
   - `assert.equal(result.failed, 0)` for the clear step; assert redirect/failure for dashboard

4. **Save without file throws**
   - Run steps: `cookies: save` (no file key)
   - `assert.equal(result.failed, 1)`
   - `assert.ok(result.steps[0].reason.includes("file"))`

5. **Load with missing file throws**
   - Run steps: `cookies: load` with file pointing to nonexistent path
   - `assert.equal(result.failed, 1)`

6. **Save creates parent directories**
   - Use `file: .cookies/deep/nested/session.json`
   - `assert.equal(result.failed, 0)`
   - Verify file exists on disk after run

## Dependency Direction

```
runner.js → steps.js (no change — runner already calls executeStep)
steps.js  → fs/promises (new import: writeFile, readFile, mkdir)
steps.js  → path (existing import: resolve, dirname)
```

No new module. No changes to runner, assertions, operations, or generated surfaces. Cookie steps are purely step-level — they don't need API exposure.

## Validation

### Automated (local + CI)

- `make check` — lint + all tests including new `test/cookies.test.js`
- Integration tests use real headless Playwright, no mocking
- Tests cover: save/load round-trip, load-only, clear, error cases (missing file, missing path)
- Cookie file I/O is real disk I/O — no mocking fs

### Manual

- None required. All behavior is testable via headless browser + local HTTP server.

### site* tools

- `sitetest` — this IS sitetest; the tests validate it
- No other site* tools needed for this feature

## Agent Team

Recommended: No — all changes are in `lib/steps.js` + one new test file. Sequential dependency: step implementation must exist before tests can run.

## Before Closing

- [ ] Run `make check` (lint + typecheck + tests pass)
- [ ] Re-read each AC and locate the line of code that enforces it
- [ ] For every boolean condition, verify both True and False paths are covered by tests
- [ ] Verify `parseStep()` changes don't break existing step types (run full test suite)
- [ ] Verify cookie file is valid JSON after save (test reads it back)
- [ ] Clean up temp cookie files in test `after()` hooks
