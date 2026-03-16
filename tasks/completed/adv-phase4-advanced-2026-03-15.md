# ADV-1 through ADV-4: Advanced Features

## ADV-1: Sub-flows

The `run` step executes a sub-flow YAML file. Resolution: relative to the calling runbook's directory.

```yaml
- run: flows/login       # resolves to <runbook-dir>/flows/login.yaml
- run: ./login.yaml      # explicit .yaml extension
```

Resolution order: try `<path>.yaml`, then `<path>.yml`, then `<path>` as-is. Sub-flow inherits the parent's page, context, and env. Sub-flow steps are inlined into the parent's step results (not nested).

The runner needs the runbook file path in ctx to resolve relative paths. `ctx.runbookDir` already derivable from `runbook.__filePath`.

## ADV-2: JSON output

`--output json` flag on CLI. When set, suppress terminal reporter, print `formatJson(result)` instead. Already have `formatJson` in reporter.js.

## ADV-3: --continue-on-error

When set, don't break on step failure — run all steps, report all failures. The runner's loop changes from `break` on fail to `continue`. CLI flag `--continue-on-error`, library opt `continueOnError`.

## ADV-4: JUnit XML

New function `formatJunit(results)` in reporter.js. Standard JUnit XML format for CI systems. `--output junit` flag.

## Files to Modify

| File | Changes |
|------|---------|
| `lib/steps.js` | Replace `run` stub with sub-flow loading + execution |
| `lib/runner.js` | Add `runbookDir` to ctx, add `continueOnError` opt, pass to step loop |
| `lib/reporter.js` | Add `formatJunit(results)` |
| `bin/sitetest.js` | Add `--output` and `--continue-on-error` flags |

## Before Closing

- [ ] All tests pass
- [ ] Sub-flow resolves relative to calling runbook
- [ ] Sub-flow steps appear inline in results (not nested)
- [ ] `--output json` suppresses terminal output
- [ ] `--continue-on-error` runs all steps even after failure
- [ ] JUnit XML is valid (testsuites > testsuite > testcase)
