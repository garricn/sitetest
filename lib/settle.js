/**
 * Wait for page to settle: no DOM mutations AND no new network resources
 * for `quietMs` consecutive milliseconds.
 *
 * Re-exports sitecap's waitForPageSettle if available, otherwise provides
 * a standalone implementation.
 *
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {number} [opts.quietMs] - Required quiet period. Default: 500.
 * @param {number} [opts.maxTimeout] - Absolute max wait. Default: 10000.
 */
export async function waitForSettle(page, opts = {}) {
  const { waitForPageSettle } = await import("sitecap/lib/capture.js");
  return waitForPageSettle(page, opts);
}
