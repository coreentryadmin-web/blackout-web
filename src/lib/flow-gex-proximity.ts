export type GexProximityLabel =
  | "at_gamma_flip"
  | "at_call_wall"
  | "at_put_wall"
  | "near_call_wall"
  | "near_put_wall";

/** Within 0.5% of a level — covers roughly ±2 strikes for SPX/SPY/single-names. */
function isNear(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.005;
}

/** Within 0.15% — "at" rather than merely "near". */
function isAt(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.0015;
}

export function computeGexProximity(
  strike: number,
  flip: number | null,
  callWall: number | null,
  putWall: number | null
): GexProximityLabel | null {
  if (isAt(strike, flip)) return "at_gamma_flip";
  if (isAt(strike, callWall)) return "at_call_wall";
  if (isAt(strike, putWall)) return "at_put_wall";
  if (isNear(strike, callWall)) return "near_call_wall";
  if (isNear(strike, putWall)) return "near_put_wall";
  return null;
}

export type GexLevelSnapshot = {
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
};

/**
 * Attach GEX proximity to a print, and — the point of this function's shape — record that the
 * print WAS evaluated even when the answer is "not near any level".
 *
 * WHY `gex_evaluated` EXISTS. An absent `gex_proximity` used to mean three different things that
 * no consumer could tell apart:
 *   1. the strike genuinely is not near a level;
 *   2. the GEX lookup timed out (300ms) or the per-ticker cache was cold;
 *   3. the ticker fell beyond the 100-name enrichment cap on a wide page.
 * On the tape all three render as *no badge*, and they reach Largo identically through
 * `get_ecosystem_context`'s `flow_full_state`.
 *
 * MEASURED (live prod tape, 5000 rows, 2026-08-22 — docs/audit/HELIX-MAP.md §9.3): the tape spans
 * **273 distinct tickers**, so **173 were past the cap and never evaluated at all**, and
 * `gex_proximity` was present on just **2.2%** of rows. So the dominant meaning of absence is not
 * "not near a level" — it is "never checked", which is the reading the payload could not express.
 * That is absence published as measurement (_COMMON.md #7), the same class this lane already fixed
 * in `call_pct`, `pct`, `route_breakdown` and `confidence`.
 *
 * `true` is set on BOTH branches here, including the no-proximity one, because reaching this
 * function at all means real levels were in hand and the comparison was made. "Checked, not near"
 * is a known state and must not be encoded as absence.
 */
export function enrichFlowWithGex<T extends { ticker: string; strike: number }>(
  flow: T,
  gex: GexLevelSnapshot
): T & { gex_proximity?: GexProximityLabel; gex_evaluated: true } {
  const proximity = computeGexProximity(flow.strike, gex.flip, gex.call_wall, gex.put_wall);
  if (!proximity) return { ...flow, gex_evaluated: true };
  return { ...flow, gex_proximity: proximity, gex_evaluated: true };
}


/**
 * Which tickers on a page will actually be looked up, and which are past the cap.
 *
 * PURE, and split out here rather than left inline in `flow-gex-enrichment.ts`, because that
 * module reaches `server-only` and therefore nothing in it can be unit-tested — the same reason
 * `helix-tape-analytics.ts` was extracted from `product-reads.ts`. The cap is the load-bearing
 * part of §9.3: it is what decides whether a print gets a GEX reading at all, and until now no
 * test could see it.
 *
 * Order follows first-appearance on the page, so the tickers that survive the cap are the ones the
 * tape shows first — not an arbitrary Set ordering.
 *
 * MEASURED live 2026-08-22: a 5000-row page spanned 273 distinct tickers against a cap of 100, so
 * 173 were never evaluated. `skipped` exists so a caller can say how many rather than discovering
 * the shortfall as silent absence.
 */
export function tickersToEvaluate(
  flows: ReadonlyArray<{ ticker: string }>,
  maxTickers: number
): { evaluated: string[]; skipped: string[] } {
  const seen: string[] = [];
  for (const f of flows) {
    const t = String(f?.ticker ?? "");
    if (t && !seen.includes(t)) seen.push(t);
  }
  const cap = Number.isFinite(maxTickers) && maxTickers > 0 ? Math.floor(maxTickers) : 0;
  return { evaluated: seen.slice(0, cap), skipped: seen.slice(cap) };
}
