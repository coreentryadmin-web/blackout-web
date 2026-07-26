import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSpxPulseSnapshot,
  detectSpxPulseSignals,
  detectSpxPlaySignals,
  advanceWallBreakTracker,
  emptyWallBreakTracker,
  resolveMacroPhase,
  gammaCenterOfMass,
  etMinuteOfDay,
  sweepToPulseSignal,
  SPX_REGIME_HYSTERESIS_PTS,
  SPX_MAGNET_SHIFT_MIN_PTS,
  SPX_PIN_SHIFT_MIN_PTS,
  SPX_WALL_BREAK_HOLD_BARS,
  SPX_SWEEP_MIN_PREMIUM,
  type SpxPulseSnapshot,
  type SpxWall,
} from "./spx-pulse";
import { signalTier } from "@/features/vector/lib/vector-pulse";
import type { SpxVoiceSnapshot } from "@/lib/bie/spx-live-voice";
import type { MacroEvent } from "@/lib/providers/macro-events";
import type { SpxFlowBrief } from "./spx-desk";

// ── Snapshot builder for tests ──
function snap(overrides: Partial<SpxPulseSnapshot> = {}): SpxPulseSnapshot {
  return {
    at: 1_000,
    price: 6000,
    gammaFlip: 5990,
    aboveFlip: true,
    kingCall: { strike: 6050, netGex: 800_000_000 },
    kingPut: { strike: 5950, netGex: -600_000_000 },
    walls: [
      { strike: 6050, netGex: 800_000_000, kind: "resistance" },
      { strike: 5950, netGex: -600_000_000, kind: "support" },
    ],
    magnetStrike: 6010,
    vix: 15,
    vixTermStructure: "contango",
    pin: { pin: 6000, pinPct: 0.6, pinBand: [5990, 6010] },
    macroPhase: null,
    etMinute: 12 * 60,
    gexStale: false,
    feedStalled: false,
    ...overrides,
  };
}

// ═══════════════════════════ REGIME FLIP (Tier 1 + hysteresis) ═══════════════
test("regime flip fires when spot confirms beyond the hysteresis band", () => {
  const prev = snap({ price: 6000, aboveFlip: true, gammaFlip: 5990 });
  const next = snap({ at: 2000, price: 5985, aboveFlip: false, gammaFlip: 5990 }); // 5 pts below flip
  const sigs = detectSpxPulseSignals(prev, next);
  const flip = sigs.find((s) => s.kind === "regime-flip");
  assert.ok(flip, "expected a regime-flip signal");
  assert.equal(flip!.tier, 1);
  assert.equal(flip!.tone, "bear");
  assert.match(flip!.line, /SHORT GAMMA/);
  assert.ok(flip!.implication && /amplify/.test(flip!.implication));
  assert.ok(flip!.magnitude && flip!.magnitude[0].unit === "points");
});

test("regime flip is SUPPRESSED inside the hysteresis band (anti flip-flop)", () => {
  const prev = snap({ price: 5991, aboveFlip: true, gammaFlip: 5990 });
  // aboveFlip changed but spot only 1pt below flip → inside band, must not fire.
  const next = snap({ at: 2000, price: 5989, aboveFlip: false, gammaFlip: 5990 });
  assert.ok(Math.abs(next.price! - next.gammaFlip!) < SPX_REGIME_HYSTERESIS_PTS);
  const sigs = detectSpxPulseSignals(prev, next);
  assert.equal(sigs.find((s) => s.kind === "regime-flip"), undefined);
});

// ═══════════════════════════ WALL BREAK (Tier 1, held N bars) ════════════════
test("wall break fires only after spot holds N consecutive bars beyond the king wall", () => {
  let tracker = emptyWallBreakTracker();
  const broken = snap({ price: 6060, kingCall: { strike: 6050, netGex: 800_000_000 } }); // above call wall

  const fires: number[] = [];
  for (let i = 1; i <= SPX_WALL_BREAK_HOLD_BARS + 1; i++) {
    const r = advanceWallBreakTracker(tracker, { ...broken, at: i * 1000 });
    tracker = r.tracker;
    if (r.breaks.length) fires.push(i);
  }
  // Fires exactly once, on the Nth held bar — not before, not again after.
  assert.deepEqual(fires, [SPX_WALL_BREAK_HOLD_BARS]);
});

test("wall break resets if spot returns to the defended side (no first-touch fire)", () => {
  let tracker = emptyWallBreakTracker();
  const above = snap({ price: 6060, kingCall: { strike: 6050, netGex: 8e8 } });
  const below = snap({ price: 6040, kingCall: { strike: 6050, netGex: 8e8 } });
  // Break, break, return — counter resets, never reaches hold threshold.
  for (const s of [above, above, below, above]) {
    const r = advanceWallBreakTracker(tracker, s);
    tracker = r.tracker;
    assert.equal(r.breaks.length, 0);
  }
});

test("wall break does not count while GEX is stale", () => {
  let tracker = emptyWallBreakTracker();
  const stale = snap({ price: 6060, gexStale: true });
  for (let i = 0; i < SPX_WALL_BREAK_HOLD_BARS + 2; i++) {
    const r = advanceWallBreakTracker(tracker, stale);
    tracker = r.tracker;
    assert.equal(r.breaks.length, 0);
  }
});

// ═══════════════════════════ GAMMA MAGNET SHIFT (Tier 2) ═════════════════════
test("magnet shift fires on a ≥X pt move with a points magnitude", () => {
  const prev = snap({ magnetStrike: 6000 });
  const next = snap({ at: 2000, magnetStrike: 6000 + SPX_MAGNET_SHIFT_MIN_PTS });
  const m = detectSpxPulseSignals(prev, next).find((s) => s.kind === "magnet-shift");
  assert.ok(m);
  assert.equal(m!.tier, 2);
  assert.equal(m!.magnitude![0].unit, "points");
  assert.equal(m!.magnitude![0].value, SPX_MAGNET_SHIFT_MIN_PTS);
});

test("magnet shift is suppressed below threshold", () => {
  const prev = snap({ magnetStrike: 6000 });
  const next = snap({ at: 2000, magnetStrike: 6003, price: 5000 }); // small move, far from spot
  assert.equal(detectSpxPulseSignals(prev, next).find((s) => s.kind === "magnet-shift"), undefined);
});

test("magnet shift fires when the centre of mass crosses spot even if small", () => {
  const prev = snap({ magnetStrike: 5998, price: 6000 });
  const next = snap({ at: 2000, magnetStrike: 6002, price: 6000 }); // 4pt move but crosses spot
  const m = detectSpxPulseSignals(prev, next).find((s) => s.kind === "magnet-shift");
  assert.ok(m, "cross-spot should fire even under the point threshold");
  assert.match(m!.line, /crossed spot/);
});

// ═══════════════════════════ PIN SHIFT (Tier 2) ══════════════════════════════
test("pin shift fires on a ≥X pt step and carries old→new + confidence", () => {
  const prev = snap({ pin: { pin: 6000, pinPct: 0.5, pinBand: [5990, 6010] } });
  const next = snap({ at: 2000, pin: { pin: 6000 + SPX_PIN_SHIFT_MIN_PTS, pinPct: 0.7, pinBand: [5995, 6015] } });
  const p = detectSpxPulseSignals(prev, next).find((s) => s.kind === "pin-shift");
  assert.ok(p);
  assert.equal(p!.tier, 2);
  assert.match(p!.line, /6,000 → 6,005/);
  assert.ok(p!.magnitude!.some((m) => m.unit === "percent" && m.value === 70));
});

test("pin shift is suppressed below the min step", () => {
  const prev = snap({ pin: { pin: 6000, pinPct: 0.5, pinBand: null } });
  const next = snap({ at: 2000, pin: { pin: 6002, pinPct: 0.5, pinBand: null } });
  assert.equal(detectSpxPulseSignals(prev, next).find((s) => s.kind === "pin-shift"), undefined);
});

// ═══════════════════════════ WALL BUILD / DISSOLVE (Tier 2) ══════════════════
test("wall build fires on ≥Y% notional growth with a $ notional magnitude", () => {
  const prev = snap({
    walls: [{ strike: 5950, netGex: -400_000_000, kind: "support" }],
  });
  const next = snap({
    at: 2000,
    walls: [{ strike: 5950, netGex: -600_000_000, kind: "support" }], // +50%
  });
  const w = detectSpxPulseSignals(prev, next).find((s) => s.kind === "wall-build");
  assert.ok(w);
  assert.equal(w!.tier, 2);
  assert.match(w!.line, /building fast/);
  assert.ok(w!.magnitude!.some((m) => m.unit === "notional"));
});

test("wall dissolve fires on ≥Y% notional shrink", () => {
  const prev = snap({ walls: [{ strike: 6050, netGex: 800_000_000, kind: "resistance" }] });
  const next = snap({ at: 2000, walls: [{ strike: 6050, netGex: 400_000_000, kind: "resistance" }] }); // -50%
  const w = detectSpxPulseSignals(prev, next).find((s) => s.kind === "wall-build");
  assert.ok(w);
  assert.match(w!.line, /dissolving/);
});

test("wall lifecycle ignores sub-noise-floor nodes", () => {
  const prev = snap({ walls: [{ strike: 6050, netGex: 100_000, kind: "resistance" }] });
  const next = snap({ at: 2000, walls: [{ strike: 6050, netGex: 200_000, kind: "resistance" }] }); // +100% but tiny
  assert.equal(detectSpxPulseSignals(prev, next).find((s) => s.kind === "wall-build"), undefined);
});

// ═══════════════════════════ VOL REGIME (Tier 2) ═════════════════════════════
test("vol regime fires on VIX crossing the level", () => {
  const prev = snap({ vix: 18 });
  const next = snap({ at: 2000, vix: 21 });
  const v = detectSpxPulseSignals(prev, next).find((s) => s.kind === "vol-regime");
  assert.ok(v);
  assert.match(v!.line, /through 20/);
});

test("vol regime fires on a term-structure flip to backwardation", () => {
  const prev = snap({ vixTermStructure: "contango" });
  const next = snap({ at: 2000, vixTermStructure: "backwardation" });
  const v = detectSpxPulseSignals(prev, next).find((s) => s.kind === "vol-regime" && /backwardation/.test(s.line));
  assert.ok(v);
});

// ═══════════════════════════ MACRO WINDOW (Tier 1) ═══════════════════════════
test("resolveMacroPhase maps ET minutes to pre/release/reaction, skips date-only rows", () => {
  const events: MacroEvent[] = [
    { time: "08:30", event: "CPI", country: "US", impact: "High" },
    { time: "2026-07-26", event: "Fed Speak", country: "US", impact: "High" }, // date-only → skipped
  ];
  assert.equal(resolveMacroPhase(events, 8 * 60 + 20, "2026-07-26")?.phase, "pre");
  assert.equal(resolveMacroPhase(events, 8 * 60 + 31, "2026-07-26")?.phase, "release");
  assert.equal(resolveMacroPhase(events, 8 * 60 + 45, "2026-07-26")?.phase, "reaction");
  assert.equal(resolveMacroPhase(events, 12 * 60, "2026-07-26"), null); // outside all windows
});

test("macro window emits a Tier-1 event on phase entry", () => {
  const prev = snap({ macroPhase: null });
  const next = snap({ at: 2000, macroPhase: { event: "CPI", phase: "pre" } });
  const m = detectSpxPulseSignals(prev, next).find((s) => s.kind === "macro-window");
  assert.ok(m);
  assert.equal(m!.tier, 1);
  assert.match(m!.line, /CPI/);
});

// ═══════════════════════════ SESSION PHASE (Tier 3) ══════════════════════════
test("session phase fires when the ET clock crosses a boundary", () => {
  const prev = snap({ etMinute: 9 * 60 + 59 });
  const next = snap({ at: 2000, etMinute: 10 * 60 });
  const s = detectSpxPulseSignals(prev, next).find((x) => x.kind === "session-phase");
  assert.ok(s);
  assert.equal(s!.tier, 3);
  assert.match(s!.line, /Opening drive/);
});

// ═══════════════════════════ SWEEP / FLOW ANOMALY (Tier 3) ═══════════════════
function brief(overrides: Partial<SpxFlowBrief> = {}): SpxFlowBrief {
  return {
    ticker: "SPX",
    premium: SPX_SWEEP_MIN_PREMIUM + 500_000,
    option_type: "call",
    strike: 6050,
    expiry: "2026-07-26",
    direction: "buy",
    alerted_at: "2026-07-26T15:00:00Z",
    alert_rule: null,
    trade_count: 12,
    has_sweep: true,
    ...overrides,
  };
}

test("sweepToPulseSignal headlines a large aggressive sweep with premium magnitude", () => {
  const s = sweepToPulseSignal(brief(), 5000);
  assert.ok(s);
  assert.equal(s!.kind, "flow-print");
  assert.equal(s!.tier, 3);
  assert.equal(s!.tone, "bull"); // bought calls
  assert.ok(s!.magnitude!.some((m) => m.unit === "premium"));
});

test("sweepToPulseSignal drops non-sweeps and sub-floor premium", () => {
  assert.equal(sweepToPulseSignal(brief({ has_sweep: false }), 5000), null);
  assert.equal(sweepToPulseSignal(brief({ premium: 200_000 }), 5000), null);
});

// ═══════════════════════════ PLAY LIFECYCLE (Tier 3) ═════════════════════════
test("play signals fire on arm → fire → close transitions", () => {
  const armed = detectSpxPlaySignals(
    { action: "SCANNING", direction: null, open_play: null },
    { action: "BUY", direction: "long", open_play: null },
    1000
  );
  assert.equal(armed[0]?.kind, "play-state");
  assert.match(armed[0]!.line, /ARMED/);

  const fired = detectSpxPlaySignals(
    { action: "BUY", direction: "long", open_play: null },
    { action: "BUY", direction: "long", open_play: { direction: "long", entry_price: 6000 } },
    2000
  );
  assert.match(fired[0]!.line, /FIRED/);

  const closed = detectSpxPlaySignals(
    { action: "BUY", direction: "long", open_play: { direction: "long", entry_price: 6000 } },
    { action: "SCANNING", direction: null, open_play: null },
    3000
  );
  assert.match(closed[0]!.line, /CLOSED/);
});

// ═══════════════════════════ PURE HELPERS ════════════════════════════════════
test("gammaCenterOfMass is the |net_gex|-weighted strike", () => {
  const walls: SpxWall[] = [
    { strike: 6000, netGex: 100, kind: "resistance" },
    { strike: 6100, netGex: -300, kind: "support" },
  ];
  // (6000*100 + 6100*300) / 400 = 6075
  assert.equal(gammaCenterOfMass(walls), 6075);
  assert.equal(gammaCenterOfMass([]), null);
});

test("etMinuteOfDay returns ET minute-of-day", () => {
  // 2026-07-26 14:30:00Z = 10:30 ET (EDT, UTC-4) = 630.
  assert.equal(etMinuteOfDay(new Date("2026-07-26T14:30:00Z")), 10 * 60 + 30);
});

test("buildSpxPulseSnapshot derives magnet + macro phase from real inputs", () => {
  const voice = {
    at: 1000,
    price: 6000,
    gammaFlip: 5990,
    aboveFlip: true,
    kingCall: { strike: 6050, netGex: 8e8 },
    kingPut: { strike: 5950, netGex: -6e8 },
    walls: [
      { strike: 6050, netGex: 8e8, kind: "resistance" as const },
      { strike: 5950, netGex: -6e8, kind: "support" as const },
    ],
    vix: 15,
    gexStale: false,
    feedStalled: false,
  } as unknown as SpxVoiceSnapshot;
  const built = buildSpxPulseSnapshot({
    voice,
    pin: { pin: 6000, pinPct: 0.6, pinBand: [5990, 6010] },
    macroEvents: [{ time: "08:30", event: "CPI", country: "US", impact: "High" }],
    etMinute: 8 * 60 + 25,
    todayYmd: "2026-07-26",
    vixTermStructure: "contango",
  });
  assert.ok(built.magnetStrike != null);
  assert.equal(built.macroPhase?.event, "CPI");
  assert.equal(built.macroPhase?.phase, "pre");
});

// ═══════════════════════════ TIER ASSIGNMENT ═════════════════════════════════
test("every emitted SPX signal carries its declared tier", () => {
  const prev = snap({ price: 6000, aboveFlip: true, gammaFlip: 5990 });
  const next = snap({ at: 2000, price: 5980, aboveFlip: false, gammaFlip: 5990 });
  for (const s of detectSpxPulseSignals(prev, next)) {
    assert.equal(signalTier(s), s.tier, `${s.kind} tier mismatch`);
  }
});

// ═══════════════════════════ NO-PREV GUARD ═══════════════════════════════════
test("detectSpxPulseSignals returns nothing on the first tick", () => {
  assert.deepEqual(detectSpxPulseSignals(null, snap()), []);
});
