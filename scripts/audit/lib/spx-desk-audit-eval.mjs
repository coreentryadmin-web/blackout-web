/**
 * SPX desk spot expectations for full-site / GHA audits — align with deploy smoke:
 * live spot is required during cash RTH; off-hours allow prior close or honest empty shell.
 */

/** @typedef {{ price?: number; spx_price?: number; prior_close?: number; prev_close?: number; available?: boolean }} SpxDeskLike */

export function deskSpotNumber(d) {
  const spot = Number(d?.price ?? d?.spx_price);
  return Number.isFinite(spot) && spot > 0 ? spot : null;
}

export function deskPriorClose(d) {
  const prior = Number(d?.prior_close ?? d?.prev_close);
  return Number.isFinite(prior) && prior > 0 ? prior : null;
}

/**
 * @returns {"ok_live"|"ok_offhours"|"fail"}
 */
export function spxDeskSpotAuditVerdict(d, rthOpen) {
  if (deskSpotNumber(d) != null) return "ok_live";
  if (!rthOpen) {
    if (deskPriorClose(d) != null) return "ok_offhours";
    if (d?.available === false) return "ok_offhours";
  }
  return "fail";
}
