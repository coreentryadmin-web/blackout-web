/**
 * Pure verdict helpers for legacy-e2e-healthcheck.mjs — no I/O, unit-tested.
 * Kept separate from the runner so the judging logic itself is testable without live auth/network.
 */

/** @typedef {"GREEN"|"AMBER"|"RED"|"SKIPPED"} Verdict */

const ORDER = { RED: 0, AMBER: 1, GREEN: 2 };

/** Worst-of rollup across stage verdicts. SKIPPED stages are excluded entirely — they never
 *  count as a failure, and never mask a real RED/AMBER among the rest either. All-SKIPPED
 *  rolls up to SKIPPED, not a fabricated GREEN over stages that never actually ran. */
export function rollupVerdict(stageVerdicts) {
  const judged = stageVerdicts.filter((v) => v !== "SKIPPED");
  if (judged.length === 0) return "SKIPPED";
  let worst = "GREEN";
  for (const v of judged) {
    if (ORDER[v] < ORDER[worst]) worst = v;
  }
  return worst;
}

/**
 * Stage A: edition correctness. `fetchOk` false means the request itself failed (auth/network) —
 * that is RED regardless of payload, an auth failure must never read as "nothing to show."
 */
export function verdictForEdition({ fetchOk, available, stale, degraded, playsCount, noPlays }) {
  if (!fetchOk) return { verdict: "RED", evidence: "edition fetch failed (auth or network)" };
  if (available === false) return { verdict: "AMBER", evidence: "no edition published yet (honest empty state)" };
  if (degraded) return { verdict: "AMBER", evidence: "edition served from degraded fallback source" };
  if (stale) return { verdict: "AMBER", evidence: "edition is stale (served an older date than requested)" };
  if (noPlays) return { verdict: "GREEN", evidence: "published edition, honestly zero plays this session" };
  if (!playsCount || playsCount <= 0) return { verdict: "RED", evidence: "available edition carries zero plays and no_plays flag not set" };
  return { verdict: "GREEN", evidence: `${playsCount} play(s), fresh, not degraded` };
}

/**
 * Stage B: one option mark row. A mark must be positive, and when both a bid and ask are present
 * the mark must sit within [bid, ask] — outside that band is a sign/data error, not noise.
 *
 * ask<=0 means there is no live two-sided quote at all — NOT a real [bid,ask] band to check the
 * mark against. Matches options-snapshot.ts's own midOf() convention ("bid may be 0 for deep-OTM;
 * require ask>0 so it is a REAL quote"): when the NBBO genuinely has no live quote, bid/ask come
 * back as 0/0 while mark still falls back to last trade/day close — a real, non-stale value, just
 * not one that ever lived inside a [0,0] "band". Reproduced live 2026-09-11 pre-market on AAPL/SWKS
 * (mark ~5.01/~2.51 from the prior session's close, bid=ask=0 with no pre-market NBBO yet) — the
 * unconditional band check read that as a sign/data error when it is an honest no-live-quote state.
 */
export function verdictForMarkRow(row) {
  if (!row) return { verdict: "RED", evidence: "no mark row returned for this OCC" };
  const { mark, bid, ask, stale } = row;
  if (mark == null) return { verdict: "AMBER", evidence: "mark unavailable (no live quote yet)" };
  if (!Number.isFinite(mark) || mark <= 0) return { verdict: "RED", evidence: `mark is not a positive finite number: ${mark}` };
  if (bid != null && !Number.isFinite(bid)) return { verdict: "RED", evidence: `bid is not finite: ${bid}` };
  if (ask != null && !Number.isFinite(ask)) return { verdict: "RED", evidence: `ask is not finite: ${ask}` };
  if (bid != null && ask != null) {
    if (ask <= 0) {
      return { verdict: "AMBER", evidence: `no live two-sided quote (bid=${bid}, ask=${ask}) — mark sourced from last trade/close` };
    }
    if (bid > ask) return { verdict: "RED", evidence: `bid (${bid}) > ask (${ask}) — crossed book` };
    if (mark < bid - 1e-9 || mark > ask + 1e-9) {
      return { verdict: "RED", evidence: `mark (${mark}) outside [bid=${bid}, ask=${ask}]` };
    }
  }
  if (stale) return { verdict: "AMBER", evidence: "mark flagged stale by the API" };
  return { verdict: "GREEN", evidence: `mark=${mark} within [${bid ?? "?"}, ${ask ?? "?"}]` };
}

/** Stage B rollup across all requested OCCs for today's edition. */
export function verdictForMarks({ fetchOk, requestedOccs, rows }) {
  if (!fetchOk) return { verdict: "RED", evidence: "legacy-marks fetch failed (auth or network)" };
  if (requestedOccs.length === 0) return { verdict: "GREEN", evidence: "no open plays with a resolvable OCC — nothing to check" };
  const byOcc = new Map((rows ?? []).map((r) => [String(r.occ ?? "").toUpperCase(), r]));
  const perOcc = requestedOccs.map((occ) => ({ occ, ...verdictForMarkRow(byOcc.get(occ.toUpperCase())) }));
  return { verdict: rollupVerdict(perOcc.map((p) => p.verdict)), evidence: perOcc };
}

/**
 * Stage C: record internal consistency. The record's own reported buckets must sum to its own
 * reported total — a malformed/truncated payload would fail this even though HTTP itself was 200.
 */
export function verdictForRecord({ fetchOk, segment }) {
  if (!fetchOk) return { verdict: "RED", evidence: "record fetch failed (auth or network)" };
  if (!segment) return { verdict: "AMBER", evidence: "record reachable but no segment data (too early / no window)" };
  const {
    resolved = 0, wins = 0, losses = 0, opens = 0, ambiguous = 0,
    unfilled = 0, pulled = 0, stop_data_unavailable: stopUnavail = 0,
  } = segment;
  const sum = wins + losses + opens + ambiguous + unfilled + pulled + stopUnavail;
  if (sum !== resolved) {
    return {
      verdict: "RED",
      evidence: `bucket sum (${sum}) != resolved (${resolved}) — wins=${wins} losses=${losses} opens=${opens} ambiguous=${ambiguous} unfilled=${unfilled} pulled=${pulled} stop_data_unavailable=${stopUnavail}`,
    };
  }
  return { verdict: "GREEN", evidence: `resolved=${resolved}, buckets sum consistently` };
}
