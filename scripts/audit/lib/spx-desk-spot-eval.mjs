/**
 * Full-site / RTH audit: when is SPX desk spot a hard P0 vs honest off-hours empty.
 */

/**
 * @param {Record<string, unknown> | null | undefined} desk
 * @returns {{ spot: number; source: "price" | "prior_close" | "none" }}
 */
export function groundedSpxDeskSpot(desk) {
  const record = desk && typeof desk === "object" ? desk : null;
  const price = record && "price" in record ? Number(record.price) : NaN;
  if (Number.isFinite(price) && price > 0) {
    return { spot: price, source: "price" };
  }
  const prior =
    record && ("prior_close" in record || "prev_close" in record || "pdc" in record)
      ? Number(record.prior_close ?? record.prev_close ?? record.pdc)
      : NaN;
  if (Number.isFinite(prior) && prior > 0) {
    return { spot: prior, source: "prior_close" };
  }
  return { spot: Number.isFinite(price) ? price : 0, source: "none" };
}

/**
 * @param {Record<string, unknown> | null | undefined} desk
 * @param {boolean} cashRthOpen
 */
export function spxDeskSpotAuditVerdict(desk, cashRthOpen) {
  const { spot, source } = groundedSpxDeskSpot(desk);
  if (spot > 0) {
    return {
      outcome: cashRthOpen || source === "price" ? "ok" : "ok_off_hours",
      spot,
      source,
    };
  }
  const marketOpen = Boolean(desk && typeof desk === "object" && desk.market_open);
  const available = desk && typeof desk === "object" ? desk.available : undefined;
  if (!cashRthOpen && !marketOpen && available === false) {
    return { outcome: "skip_empty_off_hours", spot: 0, source };
  }
  return { outcome: "fail", spot: 0, source };
}
