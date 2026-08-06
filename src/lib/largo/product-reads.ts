// Largo product-read helpers — cache-reader surfaces for Night Hawk lanes, HELIX
// signal grading, SPX pin/pulse, Cortex decisions, and cross-lane outcomes.
// Each function fail-opens (returns { available: false } on error) so tool loops
// never crash on a cold lane.

import { roundFloats } from "@/lib/round-floats";
import { fetchBangerBoardRows } from "@/lib/banger/positions-db";
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
      open_count: open.length,
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
