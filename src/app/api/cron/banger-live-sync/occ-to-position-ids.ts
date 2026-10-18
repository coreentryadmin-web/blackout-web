/**
 * Groups open-position ids by their option contract. Two DIFFERENT open banger_positions rows can
 * legitimately reference the IDENTICAL contract_occ (e.g. two separate entries into the same
 * strike/expiry on different days) — a plain `Map<string, number>` keyed by occ silently drops
 * every id but the last one written, so only one of the colliding positions ever gets its live
 * bid/ask/greeks/openInterest refreshed; its siblings are stuck with fabricated null/0 forever
 * (FINDINGS 2026-10-14, live MUZ repro: positionId 1695 showed openInterest:0 and all-null greeks
 * on the exact same contract positionId 1613 was correctly quoting bid 0.75/ask 0.90/OI 557 on).
 *
 * Lives outside route.ts because Next.js's route-type validation rejects any named export from a
 * route handler file other than the recognized route fields (GET, runtime, dynamic, etc.) — a
 * plain exported helper fails `next build`'s type check with "X is not a valid Route export field"
 * even though it passes tsc and the full test suite cleanly.
 */
export function occToPositionIds(
  rows: ReadonlyArray<{ contract_occ: string; id: number }>
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const ids = map.get(r.contract_occ);
    if (ids) ids.push(r.id);
    else map.set(r.contract_occ, [r.id]);
  }
  return map;
}
