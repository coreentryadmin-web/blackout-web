// Day-change anchoring for the SPX desk's index tiles — pure, no server/provider import chain so it
// stays unit-testable (spx-desk.ts pulls in Postgres via the Polygon GEX provider).

/**
 * Day-change % DERIVED from the prior close the payload already carries, rather than transported
 * from an upstream whose anchor is unknowable.
 *
 * This is the "derive, don't transport" half of the 2026-08-07 P0. The transported `change_pct`
 * crosses Redis (`spx:pulse:snapshot`) and a WS store, and at no point does the value carry the
 * anchor it was computed against — so a change% measured from the SESSION OPEN is indistinguishable
 * from one measured from the PRIOR CLOSE. Live that produced a header tile reading
 * `SPX 7,734.13 −0.01%` in RED while SPX was **+0.31%** on the day, next to a `TREND Bullish` tile,
 * and oscillating −0.04 / +0.30 / −0.01 across 39 seconds depending on whether the Redis snapshot
 * happened to be fresh on that request.
 *
 * `open_source === "rest"` (the FIX-A guard, added on the transport path) stops a KNOWN-bad anchor
 * from being trusted. Deriving goes further and makes the bug UNEXPRESSIBLE: the tile shows both
 * `price` and `prior_close`, so computing the third number from those two makes the header
 * self-consistent by construction — a member can check the arithmetic on screen.
 *
 * Falls back to the transported value only when the payload has no usable prior close (pre-open on
 * a cold cache, degraded lane). That is strictly better than today, never worse: with no prior
 * close there is nothing to derive from, and the transported value is the only number there is.
 *
 * Returns PERCENT (0.41 = +0.41%), matching what every caller already serves.
 */
export function pulseChangePctFromPriorClose(
  price: number | null | undefined,
  priorClose: number | null | undefined,
  transported: number
): number {
  if (
    typeof price === "number" && Number.isFinite(price) && price > 0 &&
    typeof priorClose === "number" && Number.isFinite(priorClose) && priorClose > 0
  ) {
    return ((price - priorClose) / priorClose) * 100;
  }
  return transported;
}
