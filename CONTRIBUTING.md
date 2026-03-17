# Contributing to sitetest

## Filing Issues

Use [GitHub Issues](https://github.com/garricn/sitetest/issues) for bug reports and feature requests. Include steps to reproduce for bugs.

## Development Setup

```bash
git clone https://github.com/garricn/sitetest.git
cd sitetest
make setup          # install dependencies
npx playwright install chromium
make check          # lint + test
```

## Submitting PRs

1. Create a branch from `main`
2. Make your changes
3. Run `make check` — all tests must pass
4. If you changed operations in `lib/operations.js`, run `make generate`
5. Open a PR against `main`

## Coding Conventions

- **ESM only** — all files use ES module syntax
- **node:test** — tests use Node.js built-in test runner, no external frameworks
- **No mocking** — integration tests run real headless Playwright against local HTTP servers
- **Zod schemas** — all operation inputs/outputs use Zod for validation
- **API-first codegen** — MCP tools and REST routes are generated from `lib/operations.js` via `make generate`. Do not hand-write API handlers.

## Make Targets

| Target | Description |
|--------|-------------|
| `make setup` | Install dependencies |
| `make test` | Run tests |
| `make lint` | Run ESLint |
| `make check` | Lint + test |
| `make generate` | Regenerate API surfaces |
| `make clean` | Remove artifacts |

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
