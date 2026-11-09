/**
 * SPX desk spot gate for full-site-deep-audit — session-aware (scheduled 4:30 PM ET runs are off RTH).
 */

/**
 * @param {{ spot: unknown, priorClose: unknown, sessionOpen: boolean }} input
 */
export function spxDeskSpotAuditVerdict({ spot, priorClose, sessionOpen }) {
  const live = typeof spot === "number" && spot > 0;
  if (live) return { ok: true, kind: "live" };

  const prior = typeof priorClose === "number" ? priorClose : Number(priorClose);
  if (!sessionOpen && Number.isFinite(prior) && prior > 1000) {
    return { ok: true, kind: "off_hours_prior_close", ref: prior };
  }

  return { ok: false, kind: "missing", spot: spot ?? null };
}
