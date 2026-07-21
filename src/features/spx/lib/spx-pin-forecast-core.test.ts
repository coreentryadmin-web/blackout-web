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

test("cone PINCHES into the close (width at the bell << width now)", () => {
  const f = forecastPin(base("2026-07-21T17:04:00Z"));
  const first = coneWidth(f.cone[0]!); // now
  const last = coneWidth(f.cone[f.cone.length - 1]!); // 16:00
  assert.ok(last < first * 0.35, `cone should pinch: now ${first.toFixed(1)} → close ${last.toFixed(1)}`);
  assert.ok(Math.abs(f.cone[f.cone.length - 1]!.tMin) < 0.5, "last cone step lands at the close");
});

test("confidence RISES as the session matures (less time → tighter pin)", () => {
  const morning = forecastPin(base("2026-07-21T14:00:00Z")); // 10:00 ET
  const powerHour = forecastPin(base("2026-07-21T19:20:00Z")); // 15:20 ET
  assert.ok(powerHour.pinPct! > morning.pinPct!, `power-hour ${powerHour.pinPct} > morning ${morning.pinPct}`);
  assert.equal(morning.charmState, "early");
  assert.equal(powerHour.charmState, "accelerating");
});

test("Monte Carlo: deterministic; sane distribution in the structural band; cone pinches at close", () => {
  const a = forecastPin(base("2026-07-21T17:04:00Z", { method: "montecarlo", mcPaths: 300 }));
  const b = forecastPin(base("2026-07-21T17:04:00Z", { method: "montecarlo", mcPaths: 300 }));
  assert.equal(a.method, "montecarlo");
  assert.equal(a.pin, b.pin); // same seed → identical draw
  // MC finds the pin equilibrium in the structural band (between put wall and call wall). Unlike the
  // analytic single-regime pull, it re-evaluates regime each step, so it captures the flip pin too.
  assert.ok(a.pin! > a.spot - 60 && a.pin! < a.magnet!.strike + 15, `MC pin ${a.pin} outside the band`);
  assert.ok(a.scenarios.length >= 1 && a.scenarios[0]!.p > 0);
  const widths = a.cone.map(coneWidth);
  const maxW = Math.max(...widths); // MC starts at 0 width (all paths at spot), bulges, then pins
  assert.ok(widths[widths.length - 1]! < maxW * 0.8, "MC cone pinches into the close (not widest there)");
});

test("degrade: a macro event downgrades confidence and adds a driver", () => {
  const normal = forecastPin(base("2026-07-21T17:04:00Z"));
  const macro = forecastPin(base("2026-07-21T17:04:00Z", { macroEvent: true }));
  assert.equal(macro.degraded, true);
  assert.equal(macro.degradeReason, "macro_event");
  assert.ok(macro.pinPct! <= normal.pinPct!, "macro day should not read MORE confident");
  assert.ok(macro.drivers.some((d) => /downgrad/i.test(d.label)));
});

test("empty / closed guards never throw and report honestly", () => {
  const cold = forecastPin(base("2026-07-21T17:04:00Z", { contracts: [] }));
  assert.equal(cold.available, false);
  assert.equal(cold.pin, null);
  const closed = forecastPin(base("2026-07-21T20:30:00Z")); // after close
  assert.equal(closed.available, false);
  assert.match(closed.drivers[0]!.label, /closed/i);
});
