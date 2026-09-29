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
 *
 * BUG (found 2026-09-16, live audit): `degraded` must be checked BEFORE `available === false`.
 * The route's own `timeoutFallbackEdition` (edition/route.ts) — served when the real computation
 * blew past its time budget, a transient read failure, NOT a confirmed "nothing published"
 * result — returns `{ ...emptyEdition(editionFor), degraded: true }`, which carries BOTH
 * `available: false` AND `degraded: true` at once (`emptyEdition()` always sets `available:
 * false`). With `available === false` checked first, that exact payload always matched the FIRST
 * branch and reported "no edition published yet (honest empty state)" — silently swallowing the
 * `degraded` flag every single time, so a transient read failure was permanently indistinguishable
 * from a genuinely quiet day. This is precisely the confusion the route's own header comment says
 * `degraded` exists to prevent (citing a real 2026-09-08 production incident where a mid-session
 * timeout read exactly like nothing-published). Live-reproduced 2026-09-16: a healthcheck run
 * reported "no edition published yet" for a day whose edition was independently confirmed
 * `available: true` with 3 real plays moments before and after via a direct re-fetch — the
 * classic transient-timeout signature this eval was supposed to catch and label correctly.
 */
export function verdictForEdition({ fetchOk, available, stale, degraded, playsCount, noPlays }) {
  if (!fetchOk) return { verdict: "RED", evidence: "edition fetch failed (auth or network)" };
  if (degraded) return { verdict: "AMBER", evidence: "edition served from degraded fallback source" };
  if (available === false) return { verdict: "AMBER", evidence: "no edition published yet (honest empty state)" };
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
 *
 * A MISSING bid/ask (null, not 0) is the SAME "no live two-sided quote" state, just produced by a
 * different upstream path — legacy-option-mark-row.ts's WS branch carries `bid: null, ask: null`
 * forward whenever a trade print (options-socket.ts's handleTrade) updates the mark with no prior
 * quote on file for that OCC, and options-snapshot.ts's REST parse (`finiteOrNull(r.last_quote?.bid)`)
 * does the same when the provider returns no last_quote object at all — both are at least as common
 * as the explicit 0/0 case above, arguably more so (0/0 requires the provider to affirmatively report
 * a quote object with zero values; null/null just means no quote object was present). Before this fix
 * the `bid != null && ask != null` guard skipped the whole band check for null/null and fell through
 * to a bare GREEN "within [?, ?]" — reporting the exact same unvalidated-mark situation the 0/0 branch
 * exists to catch as if it had been checked and passed. Folded into one guard so both representations
 * of "no live two-sided quote" get the same honest AMBER instead of one being silently GREEN.
 */
export function verdictForMarkRow(row) {
  if (!row) return { verdict: "RED", evidence: "no mark row returned for this OCC" };
  const { mark, bid, ask, stale } = row;
  if (mark == null) return { verdict: "AMBER", evidence: "mark unavailable (no live quote yet)" };
  if (!Number.isFinite(mark) || mark <= 0) return { verdict: "RED", evidence: `mark is not a positive finite number: ${mark}` };
  if (bid != null && !Number.isFinite(bid)) return { verdict: "RED", evidence: `bid is not finite: ${bid}` };
  if (ask != null && !Number.isFinite(ask)) return { verdict: "RED", evidence: `ask is not finite: ${ask}` };
  if (bid == null || ask == null || ask <= 0) {
    return { verdict: "AMBER", evidence: `no live two-sided quote (bid=${bid ?? "null"}, ask=${ask ?? "null"}) — mark sourced from last trade/close` };
  }
  if (bid > ask) return { verdict: "RED", evidence: `bid (${bid}) > ask (${ask}) — crossed book` };
  if (mark < bid - 1e-9 || mark > ask + 1e-9) {
    return { verdict: "RED", evidence: `mark (${mark}) outside [bid=${bid}, ask=${ask}]` };
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
 * Stage D: cross-consistency between the morning-confirm verdict (GET /api/nighthawk/play-status —
 * the CONFIRMED/DEGRADED/INVALIDATED/UNVERIFIED per-play verdict the 9:15am ET cron writes, served
 * from a Redis cache with a DB fallback) and the edition's own read-time pulled/pulled_reason overlay
 * (GET /api/market/nighthawk/edition — pull-overlay.ts, merged from the SAME morning-confirm DB row
 * at read time). Both ultimately trace back to one recordNighthawkMorningVerdict() write, but they
 * are two independently-read surfaces (one cached, one live-merged) describing the same event — if
 * they ever disagree (INVALIDATED without pulled:true, or pulled:true without an INVALIDATED
 * verdict), a member could see a genuine split-brain (e.g. a play struck through as pulled with no
 * verdict badge, or a verdict badge with no pulled styling), not a mere staleness blip.
 *
 * `available: false` is the expected, non-error state before the cron has fired for this date
 * (overnight / pre-9:15am ET) — SKIPPED, not AMBER/RED, matching rollupVerdict's own "never fabricate
 * a verdict for a stage that hasn't run yet" discipline used elsewhere in this file.
 */
export function verdictForPullConsistency({ fetchOk, available, editionPlays, statusPlays }) {
  if (!fetchOk) return { verdict: "RED", evidence: "play-status fetch failed (auth or network)" };
  if (available === false) {
    return { verdict: "SKIPPED", evidence: "morning confirmation not yet run for this date" };
  }
  const statusByTicker = new Map((statusPlays ?? []).map((p) => [String(p.ticker ?? "").toUpperCase(), p]));
  const perTicker = (editionPlays ?? []).map((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const status = statusByTicker.get(ticker);
    if (!status) {
      return { ticker, verdict: "AMBER", evidence: "no morning-confirm verdict recorded for this ticker" };
    }
    const expectedPulled = status.status === "INVALIDATED";
    const actualPulled = Boolean(play.pulled);
    if (expectedPulled !== actualPulled) {
      return {
        ticker,
        verdict: "RED",
        evidence: `split-brain: play-status says ${status.status} (expects pulled=${expectedPulled}) but edition pulled=${actualPulled}`,
      };
    }
    return { ticker, verdict: "GREEN", evidence: `${status.status} <-> pulled=${actualPulled} agree` };
  });
  if (perTicker.length === 0) return { verdict: "GREEN", evidence: "no plays to cross-check" };
  return { verdict: rollupVerdict(perTicker.map((p) => p.verdict)), evidence: perTicker };
}

/**
 * Stage C: record internal consistency. The record's own reported buckets must sum to its own
 * reported total — a malformed/truncated payload would fail this even though HTTP itself was 200.
 *
 * `unfilled` and `pulled` OVERLAP by design (analytics.ts's `NighthawkRecordSegment` doc comment:
 * "Rows whose outcome is 'unfilled'. OVERLAPS `pulled` — see `excluded_total`.") — a play can be
 * both pulled AND never filled. Naively summing every bucket flat (as this function used to)
 * double-counts that overlap and overshoots `resolved`, exactly the scenario analytics.ts's own
 * doc comment worked through as an example ("scoreable 27 + unfilled 13 + pulled 12 = 52" against
 * "resolved 50"). Live-caught 2026-09-14: a real payload with `unfilled=4, pulled=8` where 1 row
 * was in both buckets reported `unfilled_not_pulled=3` (the disjoint slice), and this check's flat
 * sum (wins+losses+opens+ambiguous+unfilled+pulled+stopUnavail = 29) overshot the honestly-correct
 * `resolved=28` by exactly that 1-row overlap — a false RED on genuinely self-consistent production
 * data. Use `unfilled_not_pulled` (the disjoint slice analytics.ts already computes) instead of the
 * overlapping `unfilled` when the payload carries it; fall back to `unfilled` for an older/partial
 * payload shape so this stays a strict widening, never a behavior change for a non-overlapping read.
 */
export function verdictForRecord({ fetchOk, segment }) {
  if (!fetchOk) return { verdict: "RED", evidence: "record fetch failed (auth or network)" };
  if (!segment) return { verdict: "AMBER", evidence: "record reachable but no segment data (too early / no window)" };
  const {
    resolved = 0, wins = 0, losses = 0, opens = 0, ambiguous = 0,
    unfilled = 0, unfilled_not_pulled: unfilledNotPulled = unfilled,
    pulled = 0, stop_data_unavailable: stopUnavail = 0,
  } = segment;
  const sum = wins + losses + opens + ambiguous + unfilledNotPulled + pulled + stopUnavail;
  if (sum !== resolved) {
    return {
      verdict: "RED",
      evidence: `bucket sum (${sum}) != resolved (${resolved}) — wins=${wins} losses=${losses} opens=${opens} ambiguous=${ambiguous} unfilled_not_pulled=${unfilledNotPulled} pulled=${pulled} stop_data_unavailable=${stopUnavail}`,
    };
  }
  return { verdict: "GREEN", evidence: `resolved=${resolved}, buckets sum consistently` };
}
