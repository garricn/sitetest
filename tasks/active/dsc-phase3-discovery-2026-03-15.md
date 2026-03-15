# DSC-1 through DSC-4: Discovery

## Context

Phase 3 adds auto-discovery: read a page's aria snapshot from sitecap, parse interactive elements, classify by confidence, generate YAML runbooks. This is the "agent writes tests" capability — the primary differentiator of sitetest.

## Aria Snapshot Format

Playwright's `ariaSnapshot()` returns YAML-like indented text:

```
- document:
  - heading "Sign in" [level=1]
  - textbox "Username"
  - textbox "Password"
  - button "Sign in"
  - link "Forgot password?":
    - /url: /password_reset
  - link "Create an account":
    - /url: /signup
```

Key patterns:
- `- <role> "<name>"` — element with accessible name
- `- <role>` — element without name (unnamed)
- `- /url: <href>` — child of a link, contains the URL
- Indentation = nesting (2 spaces per level)
- Roles: `link`, `button`, `textbox`, `checkbox`, `radio`, `combobox`, `listbox`, `menuitem`, `heading`, `paragraph`, `img`, `navigation`, `banner`, `main`, `contentinfo`, `region`, `list`, `listitem`

## Design Decisions

### Parser output shape

```js
{
  url: "https://example.com/login",
  elements: [
    { role: "textbox", name: "Username", selector: "[role='textbox'][name='Username']", parent: null },
    { role: "textbox", name: "Password", selector: "[role='textbox'][name='Password']", parent: null },
    { role: "button", name: "Sign in", selector: "button:has-text('Sign in')", parent: null },
    { role: "link", name: "Forgot password?", href: "/password_reset", selector: "a:has-text('Forgot password?')", parent: null },
  ]
}
```

Selectors use Playwright locator strategies: `getByRole()` semantics mapped to CSS-compatible selectors. Prefer accessible name selectors over fragile CSS paths.

### Selector generation strategy

| Role | Selector pattern |
|------|-----------------|
| link (with name) | `link:has-text("Name")` — Playwright text selector |
| link (with href, no name) | `a[href='<href>']` |
| button (with name) | `button:has-text("Name")` |
| button (no name) | Skip — untestable without name |
| textbox (with name) | `getByRole('textbox', { name: 'Name' })` → `role=textbox[name="Name"]` |
| checkbox/radio (with name) | `role=checkbox[name="Name"]` |
| combobox/listbox (with name) | `role=combobox[name="Name"]` |

Use Playwright role selectors (`role=<role>[name="<name>"]`) as primary strategy — they're stable across DOM changes.

### sitegrade integration (DSC-4)

Optional. If sitegrade findings are provided, filter out elements that sitegrade flagged as untestable (unnamed, hidden, unreachable). If not provided, discover uses its own unnamed-element detection (skip elements without names).

## Files to Create/Modify

| File | Changes |
|------|---------|
| `lib/discover.js` | **New.** `parseAriaSnapshot(text)`, `classifyElements(elements)`, `generateRunbook(classified, opts)`, `discover(opts)` |
| `lib/index.js` | Export `discover` |
| `bin/sitetest.js` | Add `discover` subcommand |
| `test/discover.test.js` | **New.** Unit tests for parser, classifier, generator |

## Test Assertions

### parseAriaSnapshot

- Input: example.com snapshot → `elements.length === 1` (one link: "Learn more")
- Input: GitHub login snapshot → `elements.filter(e => e.role === "textbox").length === 2`
- Input: element with no name → `element.name === null`
- Input: link with `/url:` child → `element.href` is populated

### classifyElements

- `link` with href → `confidence === "high"`
- `button` with name → `confidence === "low"` (standalone, no form context in snapshot)
- `textbox` with name → `confidence === "medium"`
- `checkbox` with name → `confidence === "high"`
- Element with no name → `confidence === null` (skipped)

### generateRunbook

- Output is valid YAML parseable by js-yaml
- Output contains `source: "auto-discover"` field
- High-confidence link generates `click` + `assert: { url: <href> }` + `goto` (return)
- Medium-confidence textbox generates `fill` + `capture` as safety net
- Low-confidence button generates `click` + `capture: { baseline: true }`

## Agent Team

Recommended: No — parser, classifier, and generator are tightly coupled; each depends on the prior's output shape.

## Before Closing

- [ ] Run `node --test test/*.test.js` — all pass
- [ ] Verify parser handles real aria snapshots (example.com, GitHub login)
- [ ] Verify generated runbooks are valid YAML
- [ ] Verify unnamed elements are skipped (not generated as steps)
- [ ] Verify `sitetest discover` CLI outputs YAML files to specified directory
- [ ] Verify `discover()` library API returns runbook objects
