// Largo product-read helpers — cache-reader surfaces for Night Hawk lanes, HELIX
// signal grading, SPX pin/pulse, Cortex decisions, and cross-lane outcomes.
// Each function fail-opens (returns { available: false } on error) so tool loops
// never crash on a cold lane.

import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";
import { fetchBangerBoardRows, fetchBangerOpenCount } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { bangerScaleOutNote } from "@/lib/zerodte/scale-out";
import {
  fetchLatestSwingSnapshotEvents,
  fetchOpenSwingPositions,
  fetchRecentHelixSignalOutcomes,
  fetchZeroDteSetupLogRange,
  dbConfigured,
} from "@/lib/db";
import {
  discoverSwingFromPersisted,
  getSwingServingLane,
  readSwingServingSnapshot,
} from "@/lib/swing/serving-lane";
import { buildZeroDteRecord } from "@/lib/zerodte/record";
import { fitRowsToBudget, sampleNote } from "@/lib/largo/fit-tool-result";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import {
  summarizeHelixSignalOutcomes,
  MIN_GRADED_SAMPLE_FOR_WIN_RATE,
} from "@/features/helix/lib/helix-signal-outcome-summary";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import {
  helixTickerIdentity,
  tapeFreshness,
  tapeDirection,
  unavailable,
  HELIX_TAPE_PROVENANCE,
} from "@/lib/largo/helix-contract";
import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
  HELIX_FLOW_MAX_SINCE_HOURS,
  HELIX_FLOW_MAX_LIMIT,
  HELIX_FLOW_PAGE_SIZE,
  HELIX_MEMBER_PANEL_PREMIUM_FLOOR,
} from "@/features/helix/lib/helix-flow-limits";
import { loadSpxDeskPulse, loadSpxPinForecast } from "@/features/spx/lib/spx-desk-loader";
import { composeCortexRead } from "@/lib/bie/cortex-read";
import { fetchUnifiedHorizonOutcomes } from "@/lib/horizon-outcomes";
import { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";

function compactSwingLane(lane: Awaited<ReturnType<typeof getSwingServingLane>>) {
  const sections = lane.sections ?? {};
  const sectionCounts = Object.fromEntries(
    Object.entries(sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
  );
  const sample = [...lane.committed, ...lane.watch].slice(0, 8).map((p) => ({
    ticker: p.ticker,
    status: p.status,
    direction: p.direction,
    horizon: p.horizon,
    score: p.score ?? null,
    reason: typeof p.reason === "string" ? p.reason.slice(0, 120) : null,
  }));
  return {
    horizon: lane.horizon,
    label: lane.label,
    committed_count: lane.committedCount,
    watch_count: lane.watchCount,
    section_counts: sectionCounts,
    sample_plays: sample,
    score_floor: lane.scoreFloor,
    score_floor_graduated: lane.scoreFloorGraduated,
  };
}

export async function bangerBoardForLargo(limit = 40) {
  if (!isBangerEngineEnabled()) {
    return { available: false, enabled: false, reason: "BANGER_ENGINE_ENABLED=0", open: [], closed: [] };
  }
  if (!dbConfigured()) {
    return { available: false, degraded: true, reason: "database_unavailable", open: [], closed: [] };
  }
  try {
    const rows = await fetchBangerBoardRows(limit);
    // The TRUE count, queried separately. `rows` is the most recent `limit` rows of ALL statuses,
    // so counting the open ones below answers "how many of the last N rows are open" — a different
    // question, and one nobody asked. See fetchBangerOpenCount for the measured symptom.
    const trueOpenCount = await fetchBangerOpenCount().catch(() => null);
    const open = rows.filter((r) => r.status === "OPEN" || r.status === "PARTIAL");
    const closed = rows.filter((r) => r.status === "CLOSED_RUNNER" || r.status === "STOPPED");
    const mapRow = (row: (typeof rows)[number]) => ({
      id: row.id,
      ticker: row.ticker,
      session_date: row.session_date,
      strike: row.contract_strike,
      expiry: row.contract_expiry,
      entry_premium: row.entry_premium,
      last_mark: row.last_mark,
      status: row.status,
      live_pnl_pct:
        row.entry_premium && row.last_mark
          ? ((row.last_mark - row.entry_premium) / row.entry_premium) * 100
          : row.realized_pnl_pct,
      scale_out_action: row.scale_out_action,
      discovery_gain: row.discovery_gain,
    });
    const nowMs = Date.now();
    return roundFloats({
      available: true,
      enabled: true,
      as_of: new Date(nowMs).toISOString(),
      // `as_of` alone is a bare UTC instant, and every row here is keyed by an ET
      // `session_date`. Between ~20:00 ET and midnight the UTC date is already TOMORROW, so
      // a model resolving "today" from `as_of` reads a session ahead of the one these
      // positions belong to.
      as_of_et: etStamp(nowMs),
      session_date: etSessionDate(nowMs),
      exit_rule_note: bangerScaleOutNote(),
      // The real number of open positions, not the number visible in this page. When the count
      // query fails we fall back to the page tally AND say so, rather than passing off a
      // page-limited number as a total.
      open_count: trueOpenCount ?? open.length,
      open_count_exact: trueOpenCount != null,
      /** How many open rows this response actually carries. Below open_count when truncated. */
      open_shown: open.length,
      truncated: trueOpenCount != null && trueOpenCount > open.length,
      closed_count: closed.length,
      open: open.map(mapRow),
      closed: closed.slice(0, 12).map(mapRow),
    });
  } catch (e) {
    return {
      available: false,
      degraded: true,
      error: e instanceof Error ? e.message : "banger_fetch_failed",
      open: [],
      closed: [],
    };
  }
}

export async function swingHorizonForLargo() {
  try {
    const snap = await readSwingServingSnapshot().catch(() => null);
    const lane = await getSwingServingLane({
      discover: discoverSwingFromPersisted,
      fetchOpenPositions: () => fetchOpenSwingPositions().catch(() => []),
      fetchLatestManageEvents: (ids) => fetchLatestSwingSnapshotEvents(ids).catch(() => new Map()),
      spotsByTicker: snap?.spotsByTicker,
    });
    return roundFloats({ available: true, ...compactSwingLane(lane) });
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : "swing_lane_failed",
    };
  }
}

export async function nighthawkHorizonsForLargo() {
  const [zerodte, swing] = await Promise.all([
    zeroDtePlaysForLargo().catch(() => ({ available: false, plays: [] })),
    swingHorizonForLargo(),
  ]);
  const zPlays = Array.isArray((zerodte as { plays?: unknown[] }).plays)
    ? ((zerodte as { plays: Array<{ ticker: string; status: string; direction: string }> }).plays ?? [])
    : [];
  const open0 = zPlays.filter((p) => !/closed|graded/i.test(p.status));
  const nowMs = Date.now();
  return roundFloats({
    available: true,
    as_of: new Date(nowMs).toISOString(),
    // The 0DTE counts below are SESSION-scoped — "how many plays are open today" is
    // meaningless without saying which ET session "today" is. A bare UTC `as_of` reads a
    // day ahead after 20:00 ET.
    as_of_et: etStamp(nowMs),
    session_date: etSessionDate(nowMs),
    zero_dte: {
      play_count: zPlays.length,
      open_count: open0.length,
      sample: open0.slice(0, 6).map((p) => `${p.ticker} ${p.direction} (${p.status})`),
    },
    swing: swing.available ? swing : { available: false },
  });
}

/** Per-play rows the model gets on the record.
 *
 *  `entry_context` is deliberately NOT among them. It is the frozen commit-forensics
 *  blob (cortex snapshot, origin maps, exit-policy snapshot, tier factors) and it was
 *  **94% of this tool's bytes** — 984,898 of 1,052,064 chars at the default 30-day
 *  window. The model never actually received it: the transport's tail cut landed
 *  inside play #2, so the blob bought nothing and cost every aggregate behind it.
 *  A member question that genuinely needs one play's evidence has dedicated tools
 *  (`get_cortex_decision` for the commit evidence, `get_grader_agreement` for the
 *  grading lanes) which return it scoped to ONE ticker and comfortably in budget. */
const ZERODTE_RECORD_MAX_SAMPLE_PLAYS = 40;

/** Aggregate-only base is ~2.8k chars; each lean play is ~330. 40 is a reading
 *  ceiling, not a size one — the budget in `fitRowsToBudget` is the real bound and
 *  will cut below 40 on a wide window rather than let the aggregates be at risk. */
export async function zerodteRecordForLargo(days = 30) {
  if (!dbConfigured()) {
    return { available: false, degraded: true, reason: "database_unavailable" };
  }
  const capped = Math.min(90, Math.max(1, days));
  const through = todayEt();
  const since = formatEtDate(new Date(Date.now() - capped * 24 * 60 * 60 * 1000));
  try {
    const rows = await fetchZeroDteSetupLogRange(since, Math.min(2000, capped * 20));
    const record = buildZeroDteRecord(rows, { since, through, days: capped });
    // Split the record the way the transport reads it: AGGREGATES FIRST, sample last.
    // `buildZeroDteRecord` is untouched — the member route (/api/market/zerodte/record)
    // and the desk UI still get the complete record with every play and its
    // entry_context. This reshaping is for the MODEL's copy only, which is the one
    // that has a 16k tail-truncating transport in front of it.
    const { plays, ...aggregates } = record;
    const leanPlays = plays.map(({ entry_context: _entryContext, ...play }) => play);
    const base = roundFloats(aggregates) as Record<string, unknown>;
    const fitted = fitRowsToBudget(base, "plays", roundFloats(leanPlays) as typeof leanPlays, {
      maxRows: ZERODTE_RECORD_MAX_SAMPLE_PLAYS,
    });
    return {
      ...base,
      plays_total: fitted.total,
      plays_included: fitted.kept.length,
      plays_note: sampleNote(
        fitted.kept.length,
        fitted.total,
        "committed 0DTE plays",
        "Per-play commit forensics (entry_context) are omitted here — use get_cortex_decision for one ticker's evidence."
      ),
      // LAST on purpose. If anything downstream ever pushes this result back over the
      // transport cap, the tail cut must eat the sample rows, never the track record.
      plays: fitted.kept,
    };
  } catch (e) {
    return {
      available: false,
      degraded: true,
      error: e instanceof Error ? e.message : "zerodte_record_failed",
    };
  }
}

export async function helixSignalOutcomesForLargo(limit = 50) {
  if (!dbConfigured()) {
    // C3. NOT retryable: a missing DATABASE_URL will not resolve on a retry, and telling the
    // model to try again would burn a turn on a certainty.
    return {
      ...unavailable("database_unavailable", "HELIX signal-outcome ledger", false),
      rows: [],
      summary: null,
    };
  }
  try {
    const rows = await fetchRecentHelixSignalOutcomes(limit);
    const summary = summarizeHelixSignalOutcomes(rows);
    const ROWS_SHOWN = 20;
    const compact = rows.slice(0, ROWS_SHOWN).map((r) => ({
      ticker: r.ticker,
      signal_type: r.signal_type,
      /** The signal's OWN directional read at fire time — `outcome` is relative to this, so
       *  "continued" is meaningless without it (a continued BEARISH firing means price FELL). */
      direction: r.direction,
      outcome: r.outcome,
      fired_at: r.fired_at,
      price_at_fire: r.price_at_fire,
      price_1h: r.price_1h,
    }));
    return roundFloats({
      available: true,
      /** No silent caps: the summary is computed over every fetched row, the list is the newest
       *  ROWS_SHOWN of them. Without this the model reads a 40-sample rate beside 20 rows and
       *  has no way to know the two describe different populations. */
      rows: compact,
      rows_shown: compact.length,
      rows_summarized: rows.length,
      /** `outcome` vocabulary, stated so the model never has to infer it: `continued` (moved in
       *  the firing's direction), `reversed` (moved against it), `flat` (moved less than the
       *  grader's threshold either way), `pending` (not yet checkpointed at 1h). */
      outcome_values: ["continued", "reversed", "flat", "pending"],
      summary: {
        ...summary,
        /** The honest name for winRatePct. `continued` is a DIRECTIONAL follow-through, not a
         *  closed trade, and `flat` is counted outside it — calling it a "win rate" invites the
         *  model to report the complement as losses when most of it never moved at all. */
        continuation_rate_pct: summary.winRatePct,
        min_graded_for_rate: MIN_GRADED_SAMPLE_FOR_WIN_RATE,
      },
    });
  } catch (e) {
    return {
      ...unavailable(
        e instanceof Error ? e.message : "helix_signal_outcomes_failed",
        "HELIX signal-outcome ledger (velocity-spike / split-flow follow-through)",
        true
      ),
      rows: [],
      summary: null,
    };
  }
}

/**
 * PIN FORECAST for Largo.
 *
 * `VECTOR_FRACTION_DP` is NOT optional here, for the reason `/api/market/vector/pin-forecast`
 * already documents in its own header: the pin core deliberately emits `pinPct` and
 * `magnet.strengthPct` at `toFixed(3)`, and "a blanket 2dp at the boundary silently threw that
 * third digit away and floored a sub-1% `scenarios[].p` to zero."
 *
 * That is exactly what this reader was doing. Measured on a realistic forecast — the HTTP route
 * (which passes the map) versus this reader (which did not):
 *
 *   pinPct                0.412  ->  0.41   (route 0.412)
 *   magnet.strengthPct    0.084  ->  0.08   (route 0.084)
 *   scenarios[].p         0.009  ->  0.01   (route 0.009)
 *   scenarios[].p         0.004  ->  0      (route 0.004)   <-- ZEROED
 *   drivers[].weight      0.128  ->  0.13   (route 0.128)
 *   atmIv                0.1344 ->  0.13    (route 0.1344)
 *
 * A scenario probability of exactly `0` does not read as "unlikely" to a model — it reads as
 * IMPOSSIBLE, and it was the tail scenarios that got zeroed. Same shape as #2423: the route was
 * fixed, the model-facing boundary kept the default.
 */
export async function spxPinForLargo() {
  try {
    const pin = await loadSpxPinForecast();
    return roundFloats({ available: true, pin }, 2, VECTOR_FRACTION_DP);
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : "spx_pin_failed" };
  }
}

/**
 * The desk pulse carries the SAME pin block (`pin.pinPct`, see spx-pulse.ts), so it needs the same
 * map for the same reason — a 0.412 pin probability served as 0.41 to the model while the desk
 * renders 41.2%.
 */
export async function spxPulseForLargo() {
  try {
    const pulse = await loadSpxDeskPulse();
    return roundFloats({ available: true, pulse }, 2, VECTOR_FRACTION_DP);
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : "spx_pulse_failed" };
  }
}

export async function cortexDecisionForLargo(ticker: string | null, question: string) {
  try {
    const composed = await composeCortexRead(ticker, question);
    const env = composed.envelope;
    return roundFloats({
      available: true,
      ticker: ticker?.toUpperCase() ?? null,
      answer: composed.answer,
      headline: env?.headline ?? null,
      bias: env?.bias ?? null,
      confidence: env?.confidence?.level ?? null,
      evidence_count: env?.evidence?.length ?? 0,
      sections: (env?.sections ?? []).map((s) => ({ title: s.title, body: s.body.slice(0, 280) })),
      context: composed.context ?? null,
    });
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : "cortex_read_failed",
    };
  }
}

export async function horizonOutcomesForLargo(days = 30) {
  if (!dbConfigured()) {
    return { available: false, outcomes: [], reason: "database_unavailable" };
  }
  try {
    const outcomes = await fetchUnifiedHorizonOutcomes({ days });
    const byLane = {
      ZERO_DTE: outcomes.filter((o) => o.lane === "ZERO_DTE").length,
      SWING: outcomes.filter((o) => o.lane === "SWING").length,
    };
    return roundFloats({
      available: true,
      days,
      lane_counts: byLane,
      sample: outcomes.slice(0, 25),
    });
  } catch (e) {
    return {
      available: false,
      outcomes: [],
      error: e instanceof Error ? e.message : "horizon_outcomes_failed",
    };
  }
}

/**
 * VECTOR PULSE for Largo — the desk's live signal rail for one ticker.
 *
 * WHY THIS EXISTS. Vector Pulse is a real, shipped surface: `buildPulseSnapshot` /
 * `detectPulseSignals` (features/vector/lib/vector-pulse.ts) turn successive Vector states into
 * discrete signals — regime flips, magnet shifts, wall-integrity changes, proximity events, wall
 * structure, flow prints. It renders in `VectorPulse.tsx` and it had a server-side reader in
 * `vector-pulse-brief.ts`.
 *
 * That reader was reachable from ONE place: `bie/composers.ts`, the BIE answer-router. Largo no
 * longer routes through it (see largo-terminal.ts on the router's removal), so from Largo's side
 * Pulse has been DARK — asked "what's the Vector pulse on NVDA", it answered from walls and regime
 * and never said the pulse rail existed. The same shape as the helix-signal-outcomes cron: a fully
 * built feature with no path to the thing that answers questions about it.
 *
 * NOTHING IS REIMPLEMENTED. This calls the REAL `buildPulseSignalsForState` against the REAL
 * `fetchVectorFullState`, and reads/writes the REAL snapshot cache, so the signals Largo reports
 * are the same objects the panel renders. A parallel implementation would drift the moment the
 * detector is tuned, and then Largo would confidently describe a rail nobody sees.
 *
 * WHY THE CACHE WRITE IS KEPT. Pulse is inherently DIFFERENTIAL — a signal exists because this
 * state differs from the previous one. Reading without writing would leave every turn comparing
 * against an ever-older snapshot and inflate the signal count. Writing keeps Largo's view aligned
 * with the panel's rather than forking it.
 */
/**
 * VECTOR FULL STATE for Largo — `fetchVectorFullState` with an honest UNAVAILABLE envelope.
 *
 * WHY THIS EXISTS. The tool used to return `fetchVectorFullState(...)` directly, which is `null`
 * when there is no live spot. A bare `null` reaching the model carries no ticker, no reason, and
 * no way to tell apart the three very different situations that produce it: the market is closed,
 * the symbol is not optionable/typo'd, or the shared GEX matrix is cold for a name that is fine.
 * The BIE composer path has answered this honestly for months — `noLiveVectorStateMessage` plus a
 * `context.reason` discriminator and a recorded gap — so the SAME question got a good answer
 * through one door and an uninterpretable `null` through the other.
 *
 * Deliberately mirrors `vectorPulseForLargo`'s existing `{ available:false, reason }` shape rather
 * than inventing a second convention for the same idea.
 *
 * THE SUCCESS PATH IS UNCHANGED — the state is returned exactly as `fetchVectorFullState` produces
 * it, freshness/absence blocks included. That matters: `get_ecosystem_context.vector_full_state`
 * is documented as "the exact same object get_vector_full_state returns", and wrapping the
 * populated case would have made that promise false. Only the `null` is replaced.
 */
export async function vectorFullStateForLargo(ticker: string, horizon = "all") {
  try {
    const [{ fetchVectorFullState }, { normalizeDteHorizon }] = await Promise.all([
      import("@/lib/bie/vector-full-state"),
      import("@/features/vector/lib/vector-dte-horizon"),
    ]);
    const h = normalizeDteHorizon(horizon);
    const state = await fetchVectorFullState(ticker, h);
    if (state) return state;

    return {
      available: false,
      reason: "no_live_vector_state",
      ticker: String(ticker ?? "").toUpperCase().trim() || null,
      horizon: h,
      /** Spelled out because the three causes need different answers from the model. */
      detail:
        "No live spot for this ticker right now, so there is no Vector state to read. That can mean " +
        "the market is closed, the symbol is not optionable, or the shared GEX matrix is cold for it — " +
        "this read cannot tell those apart. Say the desk cannot read it, not that the ticker has no levels.",
    };
  } catch (e) {
    // A throw is a THIRD state, distinct from "no live spot": something broke rather than being absent.
    return {
      available: false,
      reason: "vector_full_state_failed",
      ticker: String(ticker ?? "").toUpperCase().trim() || null,
      error: e instanceof Error ? e.message : "vector_full_state_failed",
    };
  }
}

export async function vectorPulseForLargo(ticker: string, horizon = "all") {
  try {
    const [{ fetchVectorFullState }, { normalizeDteHorizon }, { buildPulseSignalsForState }, cache] =
      await Promise.all([
        import("@/lib/bie/vector-full-state"),
        import("@/features/vector/lib/vector-dte-horizon"),
        import("@/lib/bie/vector-pulse-brief"),
        import("@/lib/bie/vector-pulse-snapshot-cache"),
      ]);

    const h = normalizeDteHorizon(horizon);
    const state = await fetchVectorFullState(ticker, h);
    if (!state) {
      // No live spot is not an empty pulse — it is no read at all. Saying so stops "no signals"
      // from being reported as a quiet tape.
      return { available: false, reason: "no_live_vector_state", ticker: ticker.toUpperCase(), signals: [] };
    }

    const nowMs = Date.parse(state.asOf) || Date.now();
    const cached = await cache.readVectorPulseCache(state.ticker, state.horizon).catch(() => null);
    const { fresh, cacheEntry, current } = await buildPulseSignalsForState(state, cached, nowMs);
    await cache.writeVectorPulseCache(state.ticker, state.horizon, cacheEntry).catch(() => {});

    return roundFloats({
      available: true,
      ticker: state.ticker,
      horizon: state.horizon,
      as_of: state.asOf,
      /** False on the FIRST read of a session: there is no previous snapshot to diff against, so
       *  an empty signal list means "no baseline yet", not "nothing is happening". */
      has_baseline: Boolean(cached?.snapshot),
      signal_count: fresh.length,
      // Field names mirror the real PulseSignal so a reader can line this up against
      // vector-pulse.ts without a translation table.
      signals: fresh.slice(0, 25).map((s) => ({
        key: s.key,
        kind: s.kind,
        tone: s.tone,
        tier: s.tier ?? null,
        line: s.line,
        at: s.at,
        level: s.level ?? null,
        magnitude: s.magnitude ?? null,
        // The trade implication and the WHY are the two fields that make a signal actionable
        // rather than decorative; the panel shows them, so Largo gets them too.
        implication: s.implication ?? null,
        why: s.why ?? null,
      })),
      snapshot: current,
      /** The bead rail and its dynamics, alongside the signals derived from them, so a "what is
       *  the pulse telling me" answer can cite the underlying wall behaviour in the same breath. */
      wall_events: state.wallEvents.slice(-12),
      bead_samples: state.wallHistory.length,
    });
  } catch (e) {
    return {
      available: false,
      signals: [],
      error: e instanceof Error ? e.message : "vector_pulse_failed",
    };
  }
}

/**
 * HELIX DERIVED PANELS for Largo — Stacked Hits, Top Prints, Velocity Radar, Split Flow.
 *
 * WHY THIS EXISTS. Four of Helix's headline panels are DERIVED, not fetched: the page pulls one
 * raw `FlowAlert[]` tape and computes them in the browser. Largo had the tape (get_flow_tape,
 * get_options_flow) and none of the derivations, so "what's stacking on NVDA", "what are the top
 * prints", "anything spiking on the velocity radar" were structurally unanswerable — and Largo
 * did not know that. It answered from raw prints, in the same confident voice, which is worse than
 * declining: a member has no way to tell the difference.
 *
 * Same root cause as Vector Pulse and the helix-signal-outcomes cron: real capability with no path
 * to the answering layer. That pattern, not any one panel, is the bug.
 *
 * EVERY DERIVATION IS THE REAL PRODUCTION FUNCTION:
 *   - `computeFlowStrikeStacks`  (lib/largo/flow-strike-stacks.ts)      — Stacked Hits
 *   - `selectTopPrints`          (features/helix/lib/helix-top-prints)  — Top Prints
 *   - `detectVelocitySpikes`     (features/helix/lib/helix-signal-detection) — Velocity Radar
 *   - `detectSplitFlow`          (same module)                          — Split Flow Radar
 *
 * Reimplementing any of them would drift the moment a threshold is tuned, and Largo would then
 * describe a panel that does not match the one on screen — a disagreement no test would catch and
 * every member would see.
 *
 * `nowMs` is passed explicitly rather than read inside: the velocity and hit windows are rolling,
 * and a shared clock keeps all four derivations describing the SAME instant.
 */
export async function helixDerivedForLargo(
  ticker?: string | null,
  limit = 400,
  sinceHours = HELIX_FLOW_DEFAULT_SINCE_HOURS
) {
  try {
    const [
      { marketPlatform },
      { computeFlowStrikeStacks },
      { selectTopPrints },
      { detectVelocitySpikes, detectSplitFlow },
      { HELIX_STRIKE_HITS_WINDOW_MIN },
    ] = await Promise.all([
      import("@/lib/platform"),
      import("@/lib/largo/flow-strike-stacks"),
      import("@/features/helix/lib/helix-top-prints"),
      import("@/features/helix/lib/helix-signal-detection"),
      import("@/features/helix/lib/helix-strike-leaders"),
    ]);

    // The SAME tape the /flows page renders — which requires ORDER as well as size. This comment
    // asserted that property for months while the call below violated it: with no `order` and no
    // `since_hours`, fetchRecentFlows fell to `ORDER BY total_premium DESC` over 48h, i.e. the
    // BIGGEST prints of two days. Every derivation below is a ROLLING WINDOW anchored to nowMs
    // (repeat hits, prints-per-15min, opposing premium inside 30min), so a population selected by
    // SIZE is the wrong input by construction — it answers "what is stacking right now" with
    // whatever was largest since the day before yesterday.
    //
    // Measured live 2026-08-20, same 400-row limit, premium-ordered vs recent-ordered:
    // stacked_hits overlapped **0 of 10** and top_prints **0 of 12** — the counts matched by
    // coincidence while the contents were entirely disjoint, and the top-print direction inverted
    // (SPY puts vs SPX calls). A bigger limit is still wanted, for the reason originally given: a
    // 50-print slice would under-report every stack and every spike.
    const { helixTapeFetchOptions: derivedFetchOptions } = await import("@/lib/largo/helix-tape-analytics");
    const summary = await marketPlatform.flows.getFlowTapeSummary(
      derivedFetchOptions({
        ticker,
        limit: Math.min(1000, Math.max(50, limit)),
        sinceHours,
        maxLimit: 1000,
        defaultSinceHours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
        maxSinceHours: HELIX_FLOW_MAX_SINCE_HOURS,
      })
    );
    const alerts = Array.isArray(summary?.recent) ? summary.recent : [];
    const nowMs = Date.now();

    if (!alerts.length) {
      // "The pipeline returned nothing" is NOT "the tape is quiet", and the difference decides
      // whether an answer is a finding or a caveat.
      return {
        available: true,
        ticker: ticker?.toUpperCase() ?? null,
        prints_analyzed: 0,
        empty_reason: "no_prints_in_window",
        stacked_hits: [],
        top_prints: [],
        velocity_spikes: [],
        split_flow: [],
      };
    }

    const stacks = computeFlowStrikeStacks(alerts, { minAlerts: 2 });
    const top = selectTopPrints(alerts, { nowMs });
    const velocity = detectVelocitySpikes(alerts, nowMs);
    const split = detectSplitFlow(alerts, nowMs);

    return roundFloats({
      available: true,
      ticker: ticker?.toUpperCase() ?? null,
      as_of: new Date(nowMs).toISOString(),
      prints_analyzed: alerts.length,
      hits_window_min: HELIX_STRIKE_HITS_WINDOW_MIN,

      /** STACKED HITS — repeated prints on the SAME contract (strike + expiry + side). */
      stacked_hits: stacks.slice(0, 20),

      /** TOP PRINTS — the conviction-scored leaders. `mode` says which ranking is in force, and
       *  `session_fallback` flags that every row is OUTSIDE the rolling window, i.e. these are
       *  stale session leaders rather than live conviction. Reporting them as live would be wrong. */
      top_prints: top.rows.slice(0, 12),
      top_prints_mode: top.mode,
      top_prints_session_fallback: top.sessionFallback,

      /** VELOCITY RADAR — prints per 15min vs the prior window, per ticker. */
      velocity_spikes: velocity.slice(0, 12),

      /** SPLIT FLOW — opposing call AND put premium on the same name inside 30 min. */
      split_flow: split.slice(0, 12),
    });
  } catch (e) {
    // C3. Arrays stay present and EMPTY so an existing consumer does not crash, but `available`
    // is false and `unavailable` says why — an empty array alone reads as "nothing is stacking",
    // which is a finding, not a failure.
    return {
      ...unavailable(
        e instanceof Error ? e.message : "helix_derived_failed",
        "HELIX derived panels (stacked hits, top prints, velocity radar, split flow)",
        true
      ),
      ...HELIX_TAPE_PROVENANCE,
      stacked_hits: [],
      top_prints: [],
      velocity_spikes: [],
      split_flow: [],
    };
  }
}

/** Deterministic FlowBrief memo — same composeFlowBrief the HELIX UI uses (no LLM). */
export async function flowBriefForLargo(sinceHours = HELIX_FLOW_DEFAULT_SINCE_HOURS) {
  try {
    const [
      { getFlowTapeSummary },
      { fetchUwDarkPoolRecent },
      { composeFlowBrief },
      { helixTapeFetchOptions, tapeWindowCoverage },
    ] = await Promise.all([
      import("@/lib/platform").then((m) => ({ getFlowTapeSummary: m.marketPlatform.flows.getFlowTapeSummary })),
      import("@/lib/providers/unusual-whales"),
      import("@/lib/bie/flow-brief"),
      import("@/lib/largo/helix-tape-analytics"),
    ]);
    // THIRD tool on the same tape with the same population defect: `{ limit: 200 }` alone left
    // `order` undefined, so fetchRecentFlows served the 200 BIGGEST prints of 48h. FlowBrief is a
    // SESSION memo — call/put skew, whale count, massive-print callouts — so composing it from
    // whatever was largest since the day before yesterday describes a window the member is not
    // looking at. Routed through the SAME builder as the other two so the three cannot drift.
    const fetchOpts = helixTapeFetchOptions({
      limit: HELIX_FLOW_PAGE_SIZE,
      sinceHours,
      maxLimit: HELIX_FLOW_MAX_LIMIT,
      defaultSinceHours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
      maxSinceHours: HELIX_FLOW_MAX_SINCE_HOURS,
    });
    const summary = await getFlowTapeSummary(fetchOpts);
    const alerts = summary.recent ?? [];
    const darkRaw = await fetchUwDarkPoolRecent(40).catch(() => []);
    const darkPrints = (darkRaw ?? [])
      .map((r: unknown) => {
        if (!r || typeof r !== "object") return null;
        const o = r as Record<string, unknown>;
        const ticker = String(o.ticker ?? o.symbol ?? "").toUpperCase();
        const premium = Number(o.premium ?? o.notional ?? 0);
        if (!ticker || premium <= 0) return null;
        const sideRaw = String(o.side ?? o.sentiment ?? "neutral").toLowerCase();
        const side = sideRaw.includes("buy") ? "buy" : sideRaw.includes("sell") ? "sell" : "neutral";
        return { ticker, premium, side };
      })
      .filter(Boolean) as Array<{ ticker: string; premium: number; side: string }>;
    const brief = composeFlowBrief(alerts, darkPrints);
    return roundFloats({
      available: Boolean(brief),
      brief,
      alert_count: alerts.length,
      total_premium: summary.total_premium ?? null,
      top_tickers: summary.top_tickers ?? [],
      /** Same honest-window disclosure the other HELIX tape tools carry: the row limit binds
       *  before the time window does, so a "session" memo can cover far less than a session. */
      window: tapeWindowCoverage(alerts, fetchOpts.since_hours, fetchOpts.limit),
      ordered_by: "recent",
    });
  } catch (e) {
    return {
      ...unavailable(
        e instanceof Error ? e.message : "flow_brief_failed",
        "HELIX FlowBrief session memo",
        true
      ),
      ...HELIX_TAPE_PROVENANCE,
      brief: null,
    };
  }
}

/** HELIX tape panel aggregates — Net Premium, Route, Expiry, session skew. */
export async function helixTapeAnalyticsForLargo(
  ticker: string | null,
  limit = HELIX_FLOW_PAGE_SIZE,
  sinceHours = HELIX_FLOW_DEFAULT_SINCE_HOURS
) {
  try {
    const { marketPlatform } = await import("@/lib/platform");
    const {
      netPremiumLeaders,
      routeBreakdown,
      expiryConcentration,
      expiryHorizonConcentration,
      sessionFlowSkew,
      tapeWindowCoverage,
      helixTapeFetchOptions,
    } = await import("@/lib/largo/helix-tape-analytics");
    // Read the SAME POPULATION the /flows desk reads. Ordering is not cosmetic here: it decides
    // which prints survive the LIMIT. The previous call passed neither `since_hours` nor `order`,
    // so fetchRecentFlows fell to `ORDER BY total_premium DESC` over 48h — under which the 0DTE
    // horizon was absent from the population ENTIRELY (measured live 2026-08-20: 17 0DTE prints
    // worth $2.7M, none of them in the top 200 by premium against $2.1B of LEAPS blocks), and the
    // Net Premium leaderboard disagreed with the member's own panel by up to 105x on SPXW.
    const fetchOpts = helixTapeFetchOptions({
      ticker,
      limit,
      sinceHours,
      maxLimit: HELIX_FLOW_MAX_LIMIT,
      defaultSinceHours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
      maxSinceHours: HELIX_FLOW_MAX_SINCE_HOURS,
    });
    const windowHours = fetchOpts.since_hours;
    const rowLimit = fetchOpts.limit;
    const summary = await marketPlatform.flows.getFlowTapeSummary(fetchOpts);
    const alerts = summary.recent ?? [];
    const now = new Date();
    const nowMs = now.getTime();
    // Largo product contract C1: an ET stamp and an ET session date, from the SHARED helpers
    // (bar-session-date.ts, #2418) rather than a local Intl call — one definition of "what
    // session is it" across every lane, so two tools can never disagree about today.
    //
    // Both fields are load-bearing here and are NOT redundant: every DTE on this payload is
    // measured against `session_date`, and in the ~8pm-midnight ET window the UTC date is
    // already tomorrow. A model resolving "today" from a UTC `as_of` is a full session ahead
    // and reads the next expiry as 0DTE — the exact defect this payload is being fixed for.
    const byExpiry = expiryConcentration(alerts, 8, now);
    const coverage = tapeWindowCoverage(alerts, windowHours, rowLimit, now);
    const sessionSkew = sessionFlowSkew(alerts);
    const sessionDirection = tapeDirection(sessionSkew.call_pct);
    const distinctExpiries = new Set(
      alerts.map((a) => String(a.expiry ?? "unknown").slice(0, 10))
    ).size;
    return roundFloats({
      // An empty tape is a STATE, not a failure. Reporting available:false for a quiet
      // off-hours read told the model the tool was broken and invited it to fall back to
      // some other source; `empty_reason` says which of the two actually happened. Same
      // convention get_helix_derived already uses.
      available: true,
      empty_reason: alerts.length === 0 ? "no_prints_in_window" : undefined,
      ...helixTickerIdentity(ticker),
      ...HELIX_TAPE_PROVENANCE,
      as_of: etStamp(nowMs),
      session_date: etSessionDate(nowMs),
      /** What the tape ACTUALLY covers. A requested window is an intent, not evidence: the row
       *  LIMIT binds first almost every time, so `requested_hours` alone would let a model
       *  describe 54 minutes of prints as a week of flow. Read `actual_hours` + `limit_reached`. */
      window: coverage,
      ...tapeFreshness(coverage.newest_age_minutes),
      ordered_by: "recent",
      /** `false`, not null: C3 asks that null never stand for a known state, and "no floor was
       *  applied" is a known state — a reader seeing null could reasonably take it as "unknown".
       *  The member's /flows panels hide prints under $200k (FlowFeed.tsx FLOOR_PREMIUM). This
       *  tool deliberately does NOT apply that floor — it is a rendering choice, and 16 of the 17
       *  0DTE prints on the live tape sit below it. Disclosed so a small divergence from the
       *  member's on-screen numbers can be explained rather than looking like a data fault. */
      premium_floor_applied: false,
      member_panel_premium_floor: HELIX_MEMBER_PANEL_PREMIUM_FLOOR,
      session: sessionSkew,
      /** C5. OMITTED, not "neutral", when the skew is unmeasurable — neutral is a measurement. */
      ...(sessionDirection ? { direction: sessionDirection } : {}),
      net_premium_leaders: netPremiumLeaders(alerts),
      route_breakdown: routeBreakdown(alerts),
      /** The aggregation the member's Expiry Concentration panel renders. Complete — at most
       *  four buckets, so no horizon can ever be truncated away. Read THIS for "is there 0DTE
       *  flow"; the per-date list below is a premium-ranked top-N and drops near-dated
       *  horizons on any normal tape. */
      expiry_horizons: expiryHorizonConcentration(alerts, now),
      expiry_concentration: byExpiry,
      /** No silent caps: the per-date list above is the top 8 BY PREMIUM out of this many. */
      expiry_concentration_total_expiries: distinctExpiries,
      expiry_concentration_truncated: distinctExpiries > byExpiry.length,
      count: summary.count ?? alerts.length,
      total_premium: summary.total_premium ?? null,
    });
  } catch (e) {
    // C3: a real absence. NOT the same shape as a quiet tape, which stays available:true with
    // an empty_reason — telling the model a working tool is broken every off-hours evening
    // would destroy the one distinction this surface is careful about.
    return {
      ...unavailable(
        e instanceof Error ? e.message : "helix_tape_analytics_failed",
        "HELIX tape aggregates (net premium, route, expiry horizons, session skew)",
        true
      ),
      ...HELIX_TAPE_PROVENANCE,
    };
  }
}

/** Thermal compare strip — SPY/SPX/QQQ side-by-side positioning summary. */
export async function thermalCompareForLargo(tickers?: string[]) {
  const { THERMAL_COMPARE_TICKERS } = await import("@/features/thermal/lib/thermal-desk-state");
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const list = (tickers?.length ? tickers : [...THERMAL_COMPARE_TICKERS]).map((t) =>
    String(t).trim().toUpperCase()
  );
  // Compare strip only needs summary scalars (flip, walls, net GEX) — NOT the full matrix.
  // gexHeatmapForLargo re-fetches the entire chain per ticker and was timing out Largo turns
  // at ~120s on cold SPX+SPY. getGexPositioning reads the shared warmed cache — same numbers
  // the Thermal compare UI shows.
  const rows = await Promise.all(
    list.map(async (ticker) => {
      const pos = await getGexPositioning(ticker).catch(() => null);
      if (!pos) {
        return {
          ticker,
          available: false,
          spot: null,
          change_pct: null,
          flip: null,
          call_wall: null,
          put_wall: null,
          net_gex: null,
          gamma_regime_read: null,
          cross_validation: null,
        };
      }
      return {
        ticker,
        available: true,
        spot: pos.spot,
        change_pct: pos.change_pct,
        flip: pos.flip,
        call_wall: pos.call_wall,
        put_wall: pos.put_wall,
        net_gex: pos.net_gex,
        gamma_regime_read: pos.gamma_regime_read,
        cross_validation: pos.gex_cross_validation ?? null,
      };
    })
  );
  return roundFloats({
    available: rows.some((r) => r.available),
    as_of: new Date().toISOString(),
    tickers: rows,
  });
}
