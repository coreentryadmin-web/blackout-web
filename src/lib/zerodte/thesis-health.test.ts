import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildThesisWeightProfile,
  computeThesisHealth,
  thesisManagementOverlay,
} from "./thesis-health";
import type { EnrichedZeroDteSetup } from "./board";

const baseCtx = {
  spy_bias: "down" as const,
  committed_at_et: "2026-07-29 11:21 ET",
  score: 94,
  confluence: {
    confirmations: 2,
    vwap_ok: true,
    market_ok: true,
    score: 2,
    tier: "double" as const,
    timing_ok: true,
    early_window: false,
    label: "VWAP+market confirmed",
  },
  flow_accumulation: {
    direction: "bear" as const,
    strength: 72,
    days: 2,
    net_signed_premium: -4_200_000,
    magnet_strike: 165,
    magnet_side: "put" as const,
    aligned: true,
  },
  why_now: { reason: "accumulation" as const, label: "2-day bear flow build" },
  discovery_origin: ["FLOW"],
  factor_breakdown: { flow: 30, tech: 12, positioning: 8, news: 4, smart_money: 10 },
  cortex: {
    abstained: false,
    decision: "PASS",
    score: 0.5,
    conviction: "C",
    vetoes: [],
    supports: [],
    opposes: [],
    absent: [],
    narrative: [],
    as_of: "2026-07-29T15:21:00Z",
  },
  gamma_regime: "short_gamma",
};

function minimalSetup(overrides: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "AMD",
    direction: "short",
    score: 94,
    market_aligned: true,
    intraday: {
      vwap: 165,
      last: 163,
      vwap_dist_pct: -1.2,
      or_high: 166,
      or_low: 164,
      or_break: "below",
      trend_5m: "down",
      day_high: 167,
      day_low: 162,
      last_bar_ms: Date.now(),
    },
    flow_accumulation: baseCtx.flow_accumulation,
    gamma_regime: "short_gamma",
    confluence: baseCtx.confluence,
    ...overrides,
  } as EnrichedZeroDteSetup;
}

test("buildThesisWeightProfile: flow-heavy when accumulation is the trigger", () => {
  const w = buildThesisWeightProfile(baseCtx, {});
  assert.ok(w.flow! > w.vwap!, "flow should outweigh vwap for accumulation entry");
});

test("computeThesisHealth: intact when live matches commit", () => {
  const h = computeThesisHealth(baseCtx, { fq_score: 70 }, {
    direction: "short",
    setup: minimalSetup(),
    spyBias: "down",
    nowEtMinutes: 11 * 60 + 30,
    computedAtEt: "11:30 ET",
  }, { status: "OPEN" });
  assert.ok(h);
  assert.ok(h!.health >= 75, `expected high health, got ${h!.health}`);
  assert.equal(h!.rung, "INTACT");
  assert.ok(h!.pillars.length >= 4);
});

test("computeThesisHealth: VWAP cross drops health materially", () => {
  const h = computeThesisHealth(baseCtx, {}, {
    direction: "short",
    setup: minimalSetup({
      intraday: {
        vwap: 162,
        last: 165,
        vwap_dist_pct: 1.5,
        or_high: 166,
        or_low: 164,
        or_break: "above",
        trend_5m: "up",
        day_high: 167,
        day_low: 162,
        last_bar_ms: Date.now(),
      },
      market_aligned: false,
      confluence: {
        ...baseCtx.confluence,
        vwap_ok: false,
        market_ok: false,
        confirmations: 0,
        tier: "weak",
        label: "unconfirmed",
      },
    }),
    spyBias: "up",
    nowEtMinutes: 12 * 60,
    computedAtEt: "12:00 ET",
  }, { status: "OPEN" });
  assert.ok(h);
  assert.ok(h!.health < 60, `expected degraded health, got ${h!.health}`);
  assert.ok(h!.moves.some((m) => m.includes("VWAP") || m.includes("Market")));
});

test("computeThesisHealth: null for WATCH rows", () => {
  const h = computeThesisHealth(baseCtx, {}, {
    direction: "short",
    setup: minimalSetup(),
    spyBias: "down",
    nowEtMinutes: 11 * 60,
    computedAtEt: "11:00 ET",
  }, { status: "WATCH" });
  assert.equal(h, null);
});

test("thesisManagementOverlay: broken thesis + profit → TRIM", () => {
  const h = computeThesisHealth(baseCtx, {}, {
    direction: "short",
    setup: minimalSetup({ market_aligned: false }),
    spyBias: "up",
    nowEtMinutes: 12 * 60,
    computedAtEt: "12:00 ET",
  }, { status: "OPEN" });
  assert.ok(h);
  const low = { ...h!, health: 20, rung: "BROKEN" as const, rungLabel: "broken", moves: ["VWAP lost"] };
  const out = thesisManagementOverlay("HOLD", "hold", low, 18);
  assert.equal(out.recommendation, "TRIM");
  assert.match(out.recNote, /Thesis health/);
});
