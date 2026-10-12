/**
 * `fetchIndexSnapshots()` (polygon.ts) silently falls back to `session.previous_close`
 * when Polygon's live index `value` hasn't ticked yet — true for every call made before
 * the first SPX index print of the session, i.e. the exact window the Legacy morning-
 * confirm cron runs in (~9:15 ET, pre-open). The morning-confirm route then computes
 * `overnight_gap_pts = spxPremarket - priorClose`, where `priorClose` is independently
 * fetched from Polygon daily bars and resolves to the SAME prior session's close — so a
 * fallback-sourced "premarket" price produces `previous_close - previous_close = 0`, a
 * fabricated flat gap rendered to members as `SPX gap +0.00 (0.00%)`, not an honest
 * "no live premarket print yet" state. Reproduced live 2026-10-12: the edition's own
 * recap text (built the prior evening from a different, real gap estimate) read "Gap up
 * 0.27%" while the morning-confirm macro strip on the same page read "0.00%".
 *
 * Detect the fallback by comparing the returned `price` to the SAME quote's own
 * `prev_close` field (polygon.ts returns both) — if they're identical, the "live" price
 * is really just yesterday's close reflected back, so the gap can't be trusted.
 */
export function resolveLiveIndexPrice(
  quote: { price: number; prev_close: number | null } | null | undefined
): number | null {
  if (!quote) return null;
  if (quote.prev_close != null && quote.price === quote.prev_close) return null;
  return quote.price;
}
