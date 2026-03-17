# OSS-1 — Open-Sourcing Readiness

## Context

sitetest is a behavior test engine for web UIs, part of the sitefix.dev pipeline. It's technically sound (clean ESM codebase, real integration tests, no hardcoded secrets) but has several structural gaps that block public release: no LICENSE file, no README, a local `file:` dependency on sitecap, internal references in CI and SECURITY.md, and no npm publish scoping.

## Goals

- Make `npm install sitetest` work for external users without access to `../sitecap`
- Provide standard open-source scaffolding (LICENSE, README, CONTRIBUTING, CoC)
- Remove internal/personal references from committed files
- Ensure CI works for forks and external contributors

## Phases

### Phase A — Critical Blockers (SRL)

These must be resolved before the repo can be made public.

#### A1. Add LICENSE file

- File: `LICENSE` (new)
- MIT license text with copyright holder and year
- Must match the `"license": "MIT"` already in package.json

#### A2. Resolve sitecap dependency

- File: `package.json`
- Current: `"sitecap": "github:garricn/sitecap"` — breaks independent installation
- **Hard prerequisite: sitecap REL-1 must complete and npm publish must succeed before this phase.**
- Replace `"sitecap": "github:garricn/sitecap"` with `"sitecap": "^1.0.0"` (published npm package)
- Once resolved, update CI workflow to remove the hardcoded checkout step

#### A3. Add `"files"` field to package.json

- File: `package.json`
- Add `"files"` array to whitelist only production artifacts:
  ```
  "files": ["lib/", "bin/", "generated/"]
  ```
- This excludes: test/, tasks/, CLAUDE.md, Skill.md, Makefile, scripts/, .github/

#### A4. Create README.md

- File: `README.md` (new)
- Sections: one-line description, install, quick start (CLI + library), runbook format overview, API surfaces (MCP/REST), link to CONTRIBUTING.md
- Draw from CLAUDE.md's project description and command reference — but rewrite for external audience (no internal pipeline references)
- Keep it concise; link to docs rather than inline everything

### Phase B — CI & Internal References (SRL, depends on A2)

#### B1. Fix CI workflow

- File: `.github/workflows/ci.yml`
- Remove the `Checkout sitecap` step (lines 13–17) once sitecap is an npm dep
- The rest of the workflow is clean

#### B2. Update SECURITY.md email

- File: `SECURITY.md`
- Replace `hello@prim.sh` with public-facing contact
- Decision required: which email? Options: a GitHub security advisory link, or a dedicated public email

#### B3. Keep CLAUDE.md and Skill.md in repo

- `CLAUDE.md` and `Skill.md` stay in the repo — useful for contributors using Claude Code.
- The `"files"` whitelist in package.json (Phase A3) already excludes them from npm publish. No action needed.

| File       | Action              | Reason                        |
|------------|---------------------|-------------------------------|
| CLAUDE.md  | Keep in repo        | Useful for Claude Code contributors; excluded from npm by `"files"` |
| Skill.md   | Keep in repo        | Useful for Claude Code contributors; excluded from npm by `"files"` |
| tasks/     | Keep in repo        | Historical context in completed plan docs; excluded from npm by `"files"` |

### Phase C — Community Scaffolding (PARA with Phase B)

#### C1. Add CONTRIBUTING.md

- File: `CONTRIBUTING.md` (new)
- Sections: how to file issues, how to submit PRs, development setup (`make setup`, `make check`), coding conventions (ESM, node:test, no mocking)
- Reference the `make` targets from Makefile

#### C2. Add CODE_OF_CONDUCT.md

- File: `CODE_OF_CONDUCT.md` (new)
- Use Contributor Covenant v2.1 (industry standard)

#### C3. Add package.json metadata

- File: `package.json`
- Add fields:
  - `"repository": { "type": "git", "url": "..." }` — needs actual GitHub URL
  - `"homepage": "https://sitefix.dev"` (or repo URL)
  - `"bugs": { "url": "..." }` — GitHub issues URL
  - `"author": "..."`
  - `"engines": { "node": ">=22" }` — CI uses Node 22, ESM features require it

#### C4. Bump version to 1.0.0

- File: `package.json`
- Change `"version": "0.5.0"` → `"version": "1.0.0"` to match sitecap and signal stable public release

### Phase D — Nice-to-Have (SRL, after C)

#### D1. Add CHANGELOG.md

- File: `CHANGELOG.md` (new)
- Populate from git history: `git log --oneline` shows versioned releases (v0.5.0, etc.)
- Use Keep a Changelog format

#### D2. Add GitHub issue/PR templates

- Files: `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/PULL_REQUEST_TEMPLATE.md` (new)
- Lightweight templates — don't over-engineer

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| sitecap resolution | Hard prereq: sitecap REL-1 + npm publish | Cleanest for consumers; sitecap is already a separate repo |
| Internal files | Keep CLAUDE.md, Skill.md in repo | Useful for Claude Code contributors; `"files"` whitelist excludes from npm |
| Version | Bump to 1.0.0 | Match sitecap; signal stable public release |
| files field vs .npmignore | `"files"` in package.json | Whitelist is safer than blacklist for excluding sensitive files |
| Node.js version | `>=22` in engines | CI runs 22; ESM + node:test features require recent Node |

## Dependency Direction

No new module dependencies introduced. Changes are to packaging/metadata only.

```
External user → npm install sitetest → gets: lib/, bin/, generated/
                                        does NOT get: test/, tasks/, CLAUDE.md, Skill.md
```

## Test Assertions

No new code logic — existing `make check` must continue to pass after all changes. Verify:

- `assert` that `npm pack --dry-run` output includes only `lib/`, `bin/`, `generated/` files
- `assert` that `npm install` works without `../sitecap` being present (after A2)

## Decisions Required From User

1. ~~**sitecap dependency**~~ — resolved: publish to npm (hard prereq: sitecap REL-1)
2. **SECURITY.md email**: what public-facing contact to use?
3. **GitHub repo URL**: needed for package.json repository/bugs fields
4. ~~**tasks/ directory**~~ — resolved: keep in repo
5. ~~**CLAUDE.md**~~ — resolved: keep in repo

## Agent Team

Recommended: No — Phases are sequential (A blocks B, C depends on A2 decision), and most changes touch package.json which would conflict across parallel agents.

## Before Closing

- [ ] Run `make check` (lint + test pass)
- [ ] Run `npm pack --dry-run` and verify only lib/, bin/, generated/ are included
- [ ] Verify `npm install` works without `../sitecap` present
- [ ] Confirm no internal emails, personal GitHub usernames, or private URLs remain in committed files
- [ ] Verify LICENSE file text matches MIT SPDX identifier
