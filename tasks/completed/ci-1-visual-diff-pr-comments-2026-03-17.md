# CI-1: Post Visual Diff Images as PR Comments

## Context

When sitetest snapshot tests fail in CI, diff images (`screenshot-diff.png`) are saved to `__captures__/` but reviewers must download the artifact to see them. CI-1 posts failed diff images directly as inline images on the PR comment.

**Goal:** After `make check` fails with snapshot diffs, upload captures as an artifact and post a PR comment with inline diff images so reviewers see what changed without leaving GitHub.

## Design Decisions

### Workflow-only change — no lib/ code changes

This is purely CI infrastructure. The captures directory and diff images already exist when tests fail. We just need to:
1. Upload `__captures__/` as an artifact
2. Post a PR comment with links to the diff images

### Only run on pull_request events

Push events to main don't have a PR to comment on. The visual diff step only triggers on `pull_request`.

| event | artifact upload | PR comment |
|---|---|---|
| `pull_request` | Yes | Yes |
| `push` | Yes (useful for debugging) | No (no PR) |

### Use `actions/upload-artifact` + `gh api` for comment

No third-party action needed. Upload captures as an artifact, then use `gh api` to create a PR comment with a markdown table of failed captures. Images in artifacts aren't directly embeddable, so the comment links to the artifact download.

**Alternative considered:** Using `peter-evans/create-or-update-comment` — adds a dependency. `gh api` is already available in runners and is simpler.

### Comment format

```markdown
## 🔴 Snapshot diffs detected

| Capture | Diff |
|---------|------|
| `homepage/wide` | [View in artifact](link) |
| `homepage/narrow` | [View in artifact](link) |

📦 [Download captures artifact](artifact-link)
```

Since GitHub artifacts don't support inline image embedding, the comment provides a direct link to the artifact. The artifact itself contains the diff PNGs reviewers can inspect locally.

### Preserve captures on failure

The runner already sets `keepCaptures = true` when diffs fail (in `steps.js` line 234). The `__captures__/` directory will exist after a failed run. For test-level runs (via `node --test`), captures are written to per-test temp dirs — but the CI workflow runs `make check` which runs `node --test`, and individual test captures go to test-scoped temp dirs that get cleaned up.

**Key insight:** CI-1 is only useful when running sitetest against a real site in CI (not during `make check` unit tests). This means CI-1 needs an additional workflow step that runs sitetest against a target, separate from the lint+test step.

**Revised scope:** Add the artifact upload + comment infrastructure. The actual "run sitetest against a site" step is a separate concern (requires a target site, runbooks in the repo, etc.). CI-1 provides the plumbing — the capture-upload-comment pipeline — that any CI job can use after running sitetest.

## Files to Modify

### `.github/workflows/ci.yml`

Add three steps after the existing `Lint + test` step:

1. **Upload captures artifact** — `actions/upload-artifact@v4` with path `__captures__/`, `if: failure()` so it only runs when tests fail. Use `if-no-files-found: ignore` since captures may not exist.

2. **Post PR comment** — runs `gh api` to create a comment on the PR. Only on `pull_request` events and only on failure. The comment lists the artifact download link.

### No lib/ changes

All capture/diff infrastructure already exists. This is workflow-only.

## Dependency Direction

```
.github/workflows/ci.yml → actions/upload-artifact@v4 (new)
.github/workflows/ci.yml → gh api (built-in)
```

No code changes. No new npm dependencies.

## Validation

### Automated

- Workflow YAML syntax: `actionlint` or manual review (no local actionlint in this repo)
- The workflow itself is tested by opening a PR with a deliberately failing snapshot test

### Manual (pre-merge)

1. Open a PR that includes a failing capture diff test
2. Verify artifact appears in the Actions tab
3. Verify PR comment is posted with artifact link
4. Verify comment is NOT posted on push events or passing tests

### Manual (post-merge)

- No post-merge validation needed — this only runs on PRs

## Agent Team

Recommended: No — single workflow file change.

## Before Closing

- [ ] Verify `if: failure()` conditions are correct (not `if: always()`)
- [ ] Verify `if: github.event_name == 'pull_request'` on the comment step
- [ ] Verify artifact upload uses `if-no-files-found: ignore`
- [ ] Test with a real PR that has a failing snapshot diff
