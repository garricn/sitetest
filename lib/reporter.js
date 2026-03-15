/**
 * Terminal reporter — step-by-step pass/fail with timing and colors.
 */

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Format a duration for display.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Print a runbook result to the terminal.
 *
 * @param {object} result
 * @param {string} result.runbook - Runbook name
 * @param {number} result.passed
 * @param {number} result.failed
 * @param {number} result.duration_ms
 * @param {Array} result.steps
 */
export function printResult(result) {
  console.log();
  console.log(`  ${result.runbook}`);

  for (const step of result.steps) {
    const icon = step.status === "passed" ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const duration = `${DIM}${formatDuration(step.duration_ms).padStart(8)}${RESET}`;
    console.log(`    ${icon} ${step.label} ${duration}`);

    if (step.status === "failed" && step.reason) {
      for (const line of step.reason.split("; ")) {
        console.log(`      ${RED}→ ${line}${RESET}`);
      }
    }
  }

  console.log();
  const summary = [];
  if (result.failed > 0) summary.push(`${RED}${result.failed} failed${RESET}`);
  summary.push(`${GREEN}${result.passed} passed${RESET}`);
  summary.push(`${DIM}(${formatDuration(result.duration_ms)})${RESET}`);
  console.log(`  ${summary.join(", ")}`);
  console.log();
}

/**
 * Format a result as JSON string.
 *
 * @param {object} result
 * @returns {string}
 */
export function formatJson(result) {
  return JSON.stringify(result, null, 2);
}
