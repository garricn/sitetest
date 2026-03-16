# FIX-1: Headless Session Cookie Persistence

## Context

Cookies set via `Set-Cookie` headers during server-side redirect chains (e.g. NextAuth `signIn()` → callback → redirect to dashboard) are not visible to subsequent page navigations in headless mode. This breaks all auth flows.

Known Playwright issues: #12884, #31736, #29212. Cookies from 302 redirect chains can be silently dropped in headless Chromium. CDP-attached mode is unaffected because the browser already has cookies from the real session.

## Root Cause

Two problems in `runner.js` and `steps.js`:

1. **`goto` uses `waitUntil: "domcontentloaded"`** — returns before the redirect chain completes. Cookies set by intermediate redirects may not be flushed to the context cookie jar yet.

2. **No explicit wait for redirect chain completion** — after a `click` that triggers a server-side redirect (e.g. form submit → OAuth provider → callback → dashboard), the runner proceeds to the next step before cookies are settled.

## Fix

### 1. Change `goto` waitUntil to `"load"`

`"domcontentloaded"` fires too early for redirect chains. `"load"` waits for the full page load including redirects. Avoid `"networkidle"` — it hangs on SPAs with long-polling/websockets.

### 2. Add explicit cookie flush after navigation steps

After `goto` and after `click` (when it triggers navigation), call `page.context().cookies()` to force the browser to flush the cookie jar. This is a known workaround for Playwright's headless cookie bug — reading cookies forces synchronization.

### 3. The `wait: settle` step already handles the timing gap

`waitForSettle` waits for network + DOM quiet. The issue isn't timing — it's that Playwright's headless mode silently drops cookies from redirect responses. The cookie-read flush is the actual fix.

## Decision Table

| Mode | Redirect cookies work? | Fix needed? |
|------|----------------------|-------------|
| CDP-attached (headed) | Yes — real browser handles cookies | No |
| Headless, no redirects | Yes — simple `Set-Cookie` works | No |
| Headless, 302 chain | **No** — Playwright bug | **Yes — flush** |
| Headless, click → redirect | **No** — same bug | **Yes — flush** |

## Files to Modify

| File | Changes |
|------|---------|
| `lib/steps.js` | Change `goto` waitUntil to `"load"`. Add cookie flush helper. Call flush after `goto` and `click`. |
| `lib/runner.js` | No changes needed — context/page lifecycle is fine |

## Test Assertions

Unit testing this requires a real server with redirect chains. Instead:

- Add an integration test with a local HTTP server that sets cookies via 302 redirect
- `assert.ok(cookies.find(c => c.name === "session"))` after redirect completes
- `assert.equal(result.status, "passed")` for assert step checking `cookie: { name: "session", exists: true }`

## Agent Team

Recommended: No — single file change (`steps.js`) plus one integration test.

## Before Closing

- [ ] Run `node --test test/*.test.js` — all pass
- [ ] Integration test: headless, server with 302 redirect setting cookie, assert cookie exists after navigation
- [ ] Verify CDP-attached mode still works (no regression from waitUntil change)
- [ ] Verify `goto` with no redirects still works (basic case)
