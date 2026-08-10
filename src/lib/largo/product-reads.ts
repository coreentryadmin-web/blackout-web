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
