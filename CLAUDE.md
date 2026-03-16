# sitetest

Behavior test engine for web UIs. Discovers testable behaviors from page accessibility trees, generates YAML runbooks, and executes them against live sites via CDP or headless Chrome. Part of the sitefix.dev pipeline.

## Tech Stack

- Node.js (ESM)
- Playwright (CDP connection or headless launch)
- sitecap (page capture for diff-based assertions)
- Zod (operation schemas, API codegen)
- No build step

## Project Structure

```
bin/sitetest.js       — CLI entry point (run, discover, update)
bin/api-server.js     — REST API (thin shell over generated routes)
bin/mcp-server.js     — MCP server (thin shell over generated tools)
lib/
  index.js            — library exports (run, update, discover)
  runner.js           — runbook parser + executor
  steps.js            — step implementations (goto, click, fill, assert, capture, run, etc.)
  assertions.js       — behavioral assertions (url, element, content, invariants)
  discover.js         — aria tree parser, confidence classification, runbook generation
  diff.js             — capture diff (pixelmatch, text, JSON)
  baseline.js         — baseline read/write/update
  settle.js           — waitForSettle (delegates to sitecap)
  env.js              — $VAR resolution from .env + process.env
  reporter.js         — terminal, JSON, JUnit XML output
  operations.js       — defineOp() + Zod schemas (SSoT for API surfaces)
  registry.js         — collects all operations
scripts/generate.js   — codegen: MCP tools, REST routes, OpenAPI, tools.json
generated/            — codegen output (committed, not gitignored)
test/                 — node:test
```

## Commands

```bash
make setup          # install deps
make test           # run tests
make check          # lint + test
make generate       # regenerate API surfaces from operations
make clean          # remove artifacts

# CLI
node bin/sitetest.js run <runbook.yaml> --headless
node bin/sitetest.js discover <sitecap-dir> -o ./runbooks
node bin/sitetest.js update <runbook.yaml>

# API surfaces
npm run api         # REST API on port 3200
npm run mcp         # MCP server (stdio)
```

## Architecture

### Dependency Direction

```
bin/ → generated/ → lib/operations.js → lib/runner.js, lib/discover.js, lib/baseline.js
                                        ↓
                                   lib/steps.js → lib/assertions.js
                                                → lib/settle.js → sitecap
                                                → lib/diff.js
                                                → lib/baseline.js
```

Core logic (`lib/`) imports nothing from API layer (`bin/`, `generated/`). Operations are the bridge — they import core logic and export handlers consumed by generated surfaces.

### API-First Codegen

All API surfaces (MCP, REST, OpenAPI, function-calling tools) are generated from `lib/operations.js` via `scripts/generate.js`. Do not hand-write API handlers — define operations with Zod schemas, run `make generate`.

### Runbook Format

YAML files with sequential steps. Optimized for agent-authored test generation, not human hand-writing. See `tasks/completed/PLAN-sitetest.md` for full spec.

## Testing

```bash
make test           # node --test test/*.test.js
```

Tests use `node:test` (no framework). Integration tests spin up local HTTP servers and run headless Playwright. No mocking of browser — all tests are real.
