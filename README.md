# sitetest

Behavior test engine for web UIs. Discovers testable behaviors from page accessibility trees, generates YAML runbooks, and executes them against live sites via CDP or headless Chrome.

## Install

```bash
npm install sitetest
```

Requires Node.js >= 22.

## Quick Start

### CLI

```bash
# Run a runbook against a running Chrome (CDP on port 9222)
sitetest run tests/login-flow.yaml

# Run headless
sitetest run tests/login-flow.yaml --headless

# Record video of the run
sitetest run tests/login-flow.yaml --headless --video

# Run all runbooks in a directory
sitetest run tests/

# Discover testable behaviors from sitecap captures
sitetest discover ./captures/example.com -o ./runbooks

# Accept current captures as new baselines
sitetest update tests/login-flow.yaml
```

### Library

```js
import { run, discover, update } from "sitetest";

const result = await run({ runbook: "tests/login.yaml", headless: true });
console.log(`${result.passed} passed, ${result.failed} failed`);
```

## Runbook Format

Runbooks are YAML files with sequential steps:

```yaml
name: login-flow
site: https://example.com
steps:
  - goto: /login
  - fill: { selector: "#email", value: "$EMAIL" }
  - fill: { selector: "#password", value: "$PASSWORD" }
  - click: button[type="submit"]
  - assert: { url: /dashboard }
  - capture: { name: dashboard }
```

Environment variables (`$VAR`) are resolved from `.env` files and `process.env`.

### Step Types

| Step | Example |
|------|---------|
| `goto` | `{ goto: "/login" }` |
| `click` | `{ click: "button.submit" }` |
| `fill` | `{ fill: { selector: "#email", value: "test@example.com" } }` |
| `select` | `{ select: { selector: "#role", value: "admin" } }` |
| `check` / `uncheck` | `{ check: "#agree" }` |
| `press` | `{ press: "Enter" }` |
| `hover` | `{ hover: ".menu" }` |
| `scroll` | `{ scroll: "#footer" }` |
| `wait` | `{ wait: "settle" }` or `{ wait: { ms: 1000 } }` |
| `assert` | `{ assert: { url: "/dashboard", title: "Home" } }` |
| `capture` | `{ capture: { name: "state", baseline: true } }` |
| `run` | `{ run: "sub-flow.yaml" }` |

### Assertions

- `url` / `url_changed` — current URL matches
- `title` — page title matches
- `element` — element exists on page
- `contains` — page contains text
- `cookie` / `localStorage` — storage assertions
- `invariants` — `no_console_errors`, `no_network_errors`, `a11y_complete`

## CLI Options

```
sitetest run <target>
  --headless               Launch headless Chrome (default: attach via CDP)
  --video                  Record video (.webm)
  -p, --port <port>        CDP port (default: 9222)
  -e, --env <path>         Path to .env file
  --output <format>        terminal | json | junit
  --continue-on-error      Run all steps even after failures

sitetest discover <sitecap-dir>
  -o, --out <dir>          Output directory (default: ./runbooks)
  -s, --site <url>         Base URL (auto-detected if omitted)
  --sitegrade <file>       Sitegrade findings JSON

sitetest update <target>
  --all                    Update all runbooks in directory
```

## API Surfaces

sitetest exposes MCP and REST API surfaces generated from operation schemas:

```bash
npm run mcp    # MCP server (stdio)
npm run api    # REST API on port 3200
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
