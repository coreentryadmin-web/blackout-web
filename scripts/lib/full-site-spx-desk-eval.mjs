/**
 * Verdict helper for full-site deep audit SPX desk spot — mirrors deploy-smoke off-hours discipline.
 */

export function evaluateFullSiteSpxDeskSpot({ spot, available, rthLive }) {
  if (available === false) {
    return {
      outcome: "skip",
      severity: null,
      message: "available:false — live desk not served",
    };
  }
  const n = Number(spot);
  if (Number.isFinite(n) && n > 0) {
    return { outcome: "ok", severity: null, message: String(n) };
  }
  if (!rthLive) {
    return {
      outcome: "skip",
      severity: null,
      message: `off-hours — spot ${Number.isFinite(n) ? n : "—"} not required`,
    };
  }
  return {
    outcome: "fail",
    severity: "P0",
    message: `spot missing or invalid: ${spot ?? "—"}`,
  };
}
