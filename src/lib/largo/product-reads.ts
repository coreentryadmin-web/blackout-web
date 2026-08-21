// Largo product-read helpers — cache-reader surfaces for Night Hawk lanes, HELIX
// signal grading, SPX pin/pulse, Cortex decisions, and cross-lane outcomes.
// Each function fail-opens (returns { available: false } on error) so tool loops
// never crash on a cold lane.

import { roundFloats } from "@/lib/round-floats";
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
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import { summarizeHelixSignalOutcomes } from "@/features/helix/lib/helix-signal-outcome-summary";
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
    return roundFloats({
      available: true,
      enabled: true,
      as_of: new Date().toISOString(),
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
  return roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    zero_dte: {
      play_count: zPlays.length,
      open_count: open0.length,
      sample: open0.slice(0, 6).map((p) => `${p.ticker} ${p.direction} (${p.status})`),
    },
    swing: swing.available ? swing : { available: false },
  });
}

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
    return roundFloats(record);
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
    return { available: false, rows: [], summary: null, error: "database_unavailable" };
  }
  try {
    const rows = await fetchRecentHelixSignalOutcomes(limit);
    const summary = summarizeHelixSignalOutcomes(rows);
    const compact = rows.slice(0, 20).map((r) => ({
      ticker: r.ticker,
      signal_type: r.signal_type,
      outcome: r.outcome,
      fired_at: r.fired_at,
      price_at_fire: r.price_at_fire,
      price_1h: r.price_1h,
    }));
    return roundFloats({ available: true, rows: compact, summary });
  } catch (e) {
    return {
      available: false,
      rows: [],
      summary: null,
      error: e instanceof Error ? e.message : "helix_signal_outcomes_failed",
    };
  }
}

export async function spxPinForLargo() {
  try {
    const pin = await loadSpxPinForecast();
    return roundFloats({ available: true, pin });
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : "spx_pin_failed" };
  }
}

export async function spxPulseForLargo() {
  try {
    const pulse = await loadSpxDeskPulse();
    return roundFloats({ available: true, pulse });
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
export async function helixDerivedForLargo(ticker?: string | null, limit = 400) {
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

    // The SAME tape the /flows page renders. A bigger limit than a normal tape read because every
    // derivation below is a WINDOW over history — a 50-print slice would silently under-report
    // every stack and every spike.
    const summary = await marketPlatform.flows.getFlowTapeSummary({
      limit: Math.min(1000, Math.max(50, limit)),
      ticker: ticker ? ticker.toUpperCase() : undefined,
    });
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
    return {
      available: false,
      stacked_hits: [],
      top_prints: [],
      velocity_spikes: [],
      split_flow: [],
      error: e instanceof Error ? e.message : "helix_derived_failed",
    };
  }
}

/** Deterministic FlowBrief memo — same composeFlowBrief the HELIX UI uses (no LLM). */
export async function flowBriefForLargo() {
  try {
    const [{ getFlowTapeSummary }, { fetchUwDarkPoolRecent }, { composeFlowBrief }] = await Promise.all([
      import("@/lib/platform").then((m) => ({ getFlowTapeSummary: m.marketPlatform.flows.getFlowTapeSummary })),
      import("@/lib/providers/unusual-whales"),
      import("@/lib/bie/flow-brief"),
    ]);
    const summary = await getFlowTapeSummary({ limit: 200 });
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
    });
  } catch (e) {
    return {
      available: false,
      brief: null,
      error: e instanceof Error ? e.message : "flow_brief_failed",
    };
  }
}

/** HELIX tape panel aggregates — Net Premium, Route, Expiry, session skew. */
export async function helixTapeAnalyticsForLargo(ticker: string | null, limit = 200) {
  try {
    const { marketPlatform } = await import("@/lib/platform");
    const {
      netPremiumLeaders,
      routeBreakdown,
      expiryConcentration,
      sessionFlowSkew,
    } = await import("@/lib/largo/helix-tape-analytics");
    const summary = await marketPlatform.flows.getFlowTapeSummary({
      limit,
      ticker: ticker ? ticker.toUpperCase() : undefined,
    });
    const alerts = summary.recent ?? [];
    return roundFloats({
      available: alerts.length > 0,
      ticker: ticker?.toUpperCase() ?? null,
      session: sessionFlowSkew(alerts),
      net_premium_leaders: netPremiumLeaders(alerts),
      route_breakdown: routeBreakdown(alerts),
      expiry_concentration: expiryConcentration(alerts),
      count: summary.count ?? alerts.length,
      total_premium: summary.total_premium ?? null,
    });
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : "helix_tape_analytics_failed",
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
