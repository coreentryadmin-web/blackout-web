import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastPin, pinFlip, pinLadderAtSpot, type PinContract, type PinForecastInput } from "./spx-pin-forecast-core";

// Synthetic 0DTE SPX chain: net-long book, heavy call OI above → gamma flip just over spot (short
// gamma below it), a dominant call wall ~7585, lighter puts below. Mirrors the mockup structure.
function chain(): PinContract[] {
  const out: PinContract[] = [];
  const bump = (k: number, c: number, s: number, a: number) => Math.round(a * Math.exp(-((k - c) ** 2) / (2 * s * s)));
  for (let k = 7300; k <= 7700; k += 5) {
    const callOi = 500 + bump(k, 7560, 60, 2600) + bump(k, 7600, 35, 1600);
    const putOi = 450 + bump(k, 7455, 48, 1800) + bump(k, 7400, 55, 1200);
    out.push({ strike: k, expiry: "2026-07-21", openInterest: callOi, iv: 0.12, type: "call" });
    out.push({ strike: k, expiry: "2026-07-21", openInterest: putOi, iv: 0.12, type: "put" });
  }
  return out;
}
const SESSION = "2026-07-21";
const CLOSE = Date.parse("2026-07-21T20:00:00Z"); // 16:00 ET
const base = (nowIso: string, extra: Partial<PinForecastInput> = {}): PinForecastInput => ({
  spot: 7507.6, priorClose: 7443.28, contracts: chain(), sessionYmd: SESSION,
  nowMs: Date.parse(nowIso), closeMs: CLOSE, atmIv: 0.12, seed: 42, ...extra,
});
const coneWidth = (s: { p10: number; p90: number }) => s.p90 - s.p10;

test("flip sits near the call-wall crossover; spot below → short gamma", () => {
  const tYears = 390 / (365 * 24 * 60); // structural (session-length) tenor, as the core uses
  const flip = pinFlip(pinLadderAtSpot(chain(), 7507.6, tYears), 7507.6);
  assert.ok(flip != null && flip > 7508 && flip < 7620, `flip ${flip} — should sit just above spot (short γ below)`);
});

test("flip ladder is OI-ONLY: unsigned intraday volume must NOT move the gamma flip", () => {
  // The signed net-GEX ladder that drives the flip must ignore dayVolume — volume is unsigned, so
  // folding it into a signed cumulative crossing poisons the sign (the documented ~7,522→~7,000
  // regression). Adding lopsided put-side volume must leave the flip exactly where OI puts it.
  const tYears = 390 / (365 * 24 * 60);
  const oiOnlyFlip = pinFlip(pinLadderAtSpot(chain(), 7507.6, tYears), 7507.6);
  const withVolume = chain().map((c) =>
    c.type === "put" ? { ...c, dayVolume: 50_000 } : { ...c, dayVolume: 100 }
  );
  const withVolumeFlip = pinFlip(pinLadderAtSpot(withVolume, 7507.6, tYears), 7507.6);
  assert.equal(withVolumeFlip, oiOnlyFlip, "flip must be identical with/without volume (OI-only ladder)");
});

test("analytic: available, short-gamma, magnet UP toward the call wall, pin above spot", () => {
  const f = forecastPin(base("2026-07-21T17:04:00Z")); // 13:04 ET
  assert.equal(f.available, true);
  assert.equal(f.regime, "short_gamma");
  assert.equal(f.magnet?.direction, "up");
  assert.equal(f.magnet?.kind, "call_wall");
  assert.ok(f.pin! > f.spot, `pin ${f.pin} should be above spot ${f.spot}`);
  assert.ok(f.pin! <= f.magnet!.strike + 1, "pin must not overshoot the magnet");
  assert.ok(f.pinPct! > 0 && f.pinPct! < 1);
  assert.ok(f.drivers.length >= 3 && f.drivers[0]!.weight >= f.drivers[1]!.weight); // ranked
});

test("cone PINCHES into the close (width at the bell << width now) but keeps HONEST residual width", () => {
  const f = forecastPin(base("2026-07-21T17:04:00Z"));
  const first = coneWidth(f.cone[0]!); // now
  const last = coneWidth(f.cone[f.cone.length - 1]!); // 16:00
  assert.ok(last < first * 0.35, `cone should pinch: now ${first.toFixed(1)} → close ${last.toFixed(1)}`);
  assert.ok(Math.abs(f.cone[f.cone.length - 1]!.tMin) < 0.5, "last cone step lands at the close");
  // Honesty floor: the bell cone must NOT collapse to a zero-width point (p10=p50=p90) — settlement
  // still carries real close risk. It must retain a small but non-zero band.
  const lastStep = f.cone[f.cone.length - 1]!;
  assert.ok(last > 0, `cone must keep residual width at the bell, got ${last}`);
  assert.ok(
    lastStep.p10 < lastStep.p50 && lastStep.p50 < lastStep.p90,
    `bell cone must stay ordered p10<p50<p90, got ${lastStep.p10}/${lastStep.p50}/${lastStep.p90}`
  );
});

test("projectedClose is the UNSNAPPED live close; pin snaps it to the magnet strike", () => {
  const f = forecastPin(base("2026-07-21T17:04:00Z"));
  // projectedClose is finite and equals the cone's terminal median (the drift path's close).
  assert.ok(f.projectedClose != null && Number.isFinite(f.projectedClose), "projectedClose must be a live number");
  assert.ok(
    Math.abs(f.projectedClose! - f.cone[f.cone.length - 1]!.p50) < 0.02,
    `projectedClose ${f.projectedClose} should match the cone's terminal median ${f.cone[f.cone.length - 1]!.p50}`
  );
  // pin is either projectedClose itself (no snap — magnet too far) or the magnet strike it snaps to
  // when the projection lands within a strike of it; either way pin sits within one strike of the
  // live projectedClose. That invariant is what lets the panel headline projectedClose and label pin.
  assert.ok(
    Math.abs(f.pin! - f.projectedClose!) <= 5,
    `pin ${f.pin} must be within a strike of projectedClose ${f.projectedClose}`
  );
  assert.ok(
    f.pin === f.magnet!.strike || Math.abs(f.pin! - f.projectedClose!) < 0.02,
    `pin is either the snapped magnet strike or equals projectedClose (got pin ${f.pin}, magnet ${f.magnet!.strike}, proj ${f.projectedClose})`
  );
});

test("confidence RISES as the session matures (less time → tighter pin)", () => {
  const morning = forecastPin(base("2026-07-21T14:00:00Z")); // 10:00 ET
  const powerHour = forecastPin(base("2026-07-21T19:20:00Z")); // 15:20 ET
  assert.ok(powerHour.pinPct! > morning.pinPct!, `power-hour ${powerHour.pinPct} > morning ${morning.pinPct}`);
  assert.equal(morning.charmState, "early");
  assert.equal(powerHour.charmState, "accelerating");
});

test("Monte Carlo: deterministic; sane distribution in the structural band; cone narrows but keeps honest residual width", () => {
  const a = forecastPin(base("2026-07-21T17:04:00Z", { method: "montecarlo", mcPaths: 300 }));
  const b = forecastPin(base("2026-07-21T17:04:00Z", { method: "montecarlo", mcPaths: 300 }));
  assert.equal(a.method, "montecarlo");
  assert.equal(a.pin, b.pin); // same seed → identical draw
  // MC finds the pin equilibrium in the structural band (between put wall and call wall). Unlike the
  // analytic single-regime pull, it re-evaluates regime each step, so it captures the flip pin too.
  assert.ok(a.pin! > a.spot - 60 && a.pin! < a.magnet!.strike + 15, `MC pin ${a.pin} outside the band`);
  assert.ok(a.scenarios.length >= 1 && a.scenarios[0]!.p > 0);
  const widths = a.cone.map(coneWidth);
  const maxW = Math.max(...widths); // MC starts at 0 width (all paths at spot), bulges, then narrows
  const last = widths[widths.length - 1]!;
  // The close is NOT the widest point (drift pulls paths onto the pin) …
  assert.ok(last < maxW, `MC cone should narrow from its mid-session bulge (last ${last.toFixed(1)} vs max ${maxW.toFixed(1)})`);
  // … but with the MC_BRIDGE_NOISE_FLOOR it must NOT collapse to a thread — honest settlement noise
  // keeps a real band into the bell (was over-tight before, manufacturing false MC confidence).
  assert.ok(last > maxW * 0.5, `MC cone must keep honest residual width at the close (last/max ${(last / maxW).toFixed(2)})`);
});

test("degrade: a macro event downgrades confidence and adds a driver", () => {
  const normal = forecastPin(base("2026-07-21T17:04:00Z"));
  const macro = forecastPin(base("2026-07-21T17:04:00Z", { macroEvent: true }));
  assert.equal(macro.degraded, true);
  assert.equal(macro.degradeReason, "macro_event");
  assert.ok(macro.pinPct! <= normal.pinPct!, "macro day should not read MORE confident");
  assert.ok(macro.drivers.some((d) => /downgrad/i.test(d.label)));
});

test("ivFallback: FALSE when a real ATM IV is supplied or readable from the chain", () => {
  // base() supplies atmIv: 0.12 AND the chain carries iv: 0.12 — either way the vol input is
  // real, so the forecast must NOT be flagged as running on the guessed 12%.
  const real = forecastPin(base("2026-07-21T17:04:00Z"));
  assert.equal(real.available, true);
  assert.equal(real.ivFallback, false);

  // Drop the supplied atmIv but keep chain IVs — the nearest-strike IV is still observed data.
  const fromChain = forecastPin(base("2026-07-21T17:04:00Z", { atmIv: undefined }));
  assert.equal(fromChain.available, true);
  assert.equal(fromChain.ivFallback, false);
});

test("ivFallback: TRUE when no IV is supplied and the chain carries none (hardcoded 12% guess)", () => {
  // No atmIv input AND every contract iv <= 0 → the only vol input the model has is the hardcoded
  // 0.12 guess. (An IV-less chain also can't build a gamma ladder, so the forecast comes back
  // unavailable — but the provenance flag still fires so a guessed-IV state is never mistaken for a
  // real-IV one.) This is the path the line-291 / line-260 `?? 0.12` fallback actually reaches.
  const ivless = chain().map((c) => ({ ...c, iv: 0 }));
  const guessed = forecastPin(base("2026-07-21T17:04:00Z", { atmIv: undefined, contracts: ivless }));
  assert.equal(guessed.ivFallback, true);
  // Provenance only — this is distinct from the regime-degrade flag.
  assert.equal(guessed.degraded, false);
});

test("ivFallback: FALSE on a thin chain when a real atmIv WAS supplied (guess not taken)", () => {
  // Same IV-less chain, but the caller supplied a real atmIv → no 12% guess, so even the
  // unavailable forecast must NOT be badged as vol-fallback.
  const ivless = chain().map((c) => ({ ...c, iv: 0 }));
  const supplied = forecastPin(base("2026-07-21T17:04:00Z", { atmIv: 0.18, contracts: ivless }));
  assert.equal(supplied.ivFallback, false);
});

test("empty / closed guards never throw and report honestly", () => {
  const cold = forecastPin(base("2026-07-21T17:04:00Z", { contracts: [] }));
  assert.equal(cold.available, false);
  assert.equal(cold.pin, null);
  const closed = forecastPin(base("2026-07-21T20:30:00Z")); // after close
  assert.equal(closed.available, false);
  assert.match(closed.drivers[0]!.label, /closed/i);
});
