# /test

Run behavior tests against a web UI using sitetest — execute runbooks, discover testable behaviors, or capture baselines.

## Usage

```
/test <runbook.yaml> [options]
/test discover <sitecap-dir>
```

## Instructions

When this skill is invoked:

**Running a runbook:**
```bash
npx sitetest run <runbook.yaml> --headless
```

After the run completes, report the results: steps passed/failed, timing, and any failure reasons. If a capture diff fails, read the diff image to show what changed.

**Discovering behaviors:**
```bash
npx sitetest discover <sitecap-dir> -o /tmp/sitetest-runbooks
```

After discovery, read the generated YAML runbooks and summarize: how many pages, how many testable elements per page, confidence levels.

**With env vars (for auth flows):**
```bash
npx sitetest run <runbook.yaml> --headless -e <path-to-.env>
```

## Options

Pass additional flags after the runbook path:
- `--headless` — launch headless Chrome (default for skill)
- `--continue-on-error` — run all steps even after failures
- `--output json` — structured JSON output
- `--output junit` — JUnit XML for CI
- `-e <path>` — .env file for `$VAR` resolution in runbooks

## Examples

```
/test tests/login-flow.yaml
/test tests/ --continue-on-error
/test discover ./captures/example.com
```
