/**
 * Browser-side readiness probes for site-latency-audit.
 * Playwright waitForFunction serializes these into the page — never close over Node constants.
 */
export function dashboardMatrixReady(minRows) {
  return (
    document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= minRows ||
    document.body.innerText.length > 800
  );
}
