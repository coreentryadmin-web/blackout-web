import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  forecastPin,
  pinMaxPain,
  pinFlip,
  pinLadderAtSpot,
  remainingSigma,
  boundMagnetTarget,
  impliedBandProbability,
  type PinContract,
  type PinForecastInput,
} from "./spx-pin-forecast-core";

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

test("weak far wall must NOT yank projected close 100pts (live 2026-07-29 regression)", () => {
  // Fragmented book: one thin put strike 120pts below spot carries the most put OI on that side,
  // but only a few % of total OI — the live bug glued projectedClose ~110pts below spot all afternoon.
  const contracts: PinContract[] = [];
  for (let k = 7200; k <= 7600; k += 5) {
    const near = Math.abs(k - 7420) <= 40;
    contracts.push({
      strike: k, expiry: SESSION, type: "call", iv: 0.12,
      openInterest: near ? 800 : 200,
    });
    contracts.push({
      strike: k, expiry: SESSION, type: "put", iv: 0.12,
      // Far thin "winner" on raw max-OI ≤ spot, plus a denser nearer put cluster.
      openInterest: k === 7300 ? 2_200 : near && k <= 7420 ? 1_400 : 180,
    });
  }
  const spot = 7422;
  const f = forecastPin({
    spot, priorClose: 7395, contracts, sessionYmd: SESSION,
    nowMs: Date.parse("2026-07-21T18:45:00Z"), // ~14:45 ET → charm accelerating
    closeMs: CLOSE, atmIv: 0.12, seed: 7,
  });
  assert.equal(f.available, true);
  // Must stay within a tradeable band of spot — not locked onto a −120pt thin wall.
  assert.ok(
    Math.abs((f.projectedClose ?? spot) - spot) < 55,
    `projectedClose ${f.projectedClose} yanked too far from spot ${spot} (magnet ${JSON.stringify(f.magnet)})`
  );
  // Spot tick must move the live projection (was frozen when already glued to the far wall).
  const f2 = forecastPin({
    spot: spot + 8, priorClose: 7395, contracts, sessionYmd: SESSION,
    nowMs: Date.parse("2026-07-21T18:45:00Z"), closeMs: CLOSE, atmIv: 0.12, seed: 7,
  });
  assert.ok(
    Math.abs((f2.projectedClose ?? 0) - (f.projectedClose ?? 0)) >= 1.5,
    `projectedClose must track spot: ${f.projectedClose} → ${f2.projectedClose} on +8pt spot`
  );
});

test("magnetPullScale: thin walls soft-pull; heavy walls full-pull", async () => {
  const { magnetPullScale } = await import("./spx-pin-forecast-core");
  assert.ok(magnetPullScale(0.03) < 0.4, "3% OI wall stays soft");
  assert.ok(magnetPullScale(0.2) >= 0.99, "20% OI wall gets full pull");
});

test("oiWalls prefers nearer denser put over far raw-max OI", async () => {
  const { oiWalls } = await import("./spx-pin-forecast-core");
  const contracts: PinContract[] = [
    { strike: 7300, expiry: SESSION, type: "put", iv: 0.12, openInterest: 3000 }, // far, raw max
    { strike: 7400, expiry: SESSION, type: "put", iv: 0.12, openInterest: 2200 }, // nearer, denser score
    { strike: 7450, expiry: SESSION, type: "call", iv: 0.12, openInterest: 2000 },
    { strike: 7500, expiry: SESSION, type: "call", iv: 0.12, openInterest: 1800 },
  ];
  const w = oiWalls(contracts, 7420, 5);
  assert.equal(w.putWall?.strike, 7400, `put wall should be nearer 7400, got ${w.putWall?.strike}`);
});

// ── HORIZON PARAMETERIZATION ─────────────────────────────────────────────────────────────────
// The model used to hardcode a 390-minute RTH session as BOTH the charm clock (tFrac) and the
// gamma ladder's tenor (structYears). That is correct only when the target is today's close.
// These cover the two inputs that let the same engine target a further-out expiry — and, first,
// that an SPX caller who passes neither still gets exactly the old numbers.

test("horizonMin/structYears omitted → byte-identical to the hardcoded session defaults", () => {
  // The regression guard for every existing SPX caller: defaulting must reproduce the constants
  // it replaced, not merely "something close".
  const now = "2026-07-21T15:00:00Z";
  const implicit = forecastPin(base(now));
  const explicit = forecastPin(base(now, { horizonMin: 390, structYears: 390 / (365 * 24 * 60) }));
  assert.deepEqual(implicit, explicit, "omitting the new inputs must equal passing the old constants");
});

test("horizonMin scales the CHARM CLOCK — the bug a multi-day target used to hit", () => {
  // 1,950 minutes to target (five sessions out). Against the old hardcoded 390 the ratio is 5.0,
  // which clamps to 1.0 — so the forecast reports "early, nothing pinning yet" even though the
  // window is half elapsed. Given the real window length it correctly reads as mid-run.
  const nowMs = Date.parse("2026-07-21T15:00:00Z");
  const closeMs = nowMs + 1950 * 60_000;
  const stale = forecastPin(base("2026-07-21T15:00:00Z", { closeMs }));
  const scaled = forecastPin(base("2026-07-21T15:00:00Z", { closeMs, horizonMin: 3900 }));
  assert.equal(stale.charmState, "early", "clamped tFrac pins the old behaviour at 'early'");
  assert.equal(scaled.charmState, "moderate", "half a 3,900-min window elapsed → moderate charm");
});

test("structYears widens the gamma ladder: a further expiry has flatter, less concentrated walls", () => {
  // BSM gamma goes as 1/√T, so pricing a multi-day book at a one-session tenor manufactures walls
  // sharper than the book has. Peak ladder magnitude must fall as the tenor grows.
  const session = 390 / (365 * 24 * 60);
  const peak = (tYears: number) => {
    let max = 0;
    for (const g of pinLadderAtSpot(chain(), 7507.6, tYears).values()) max = Math.max(max, Math.abs(g));
    return max;
  };
  const near = peak(session);
  const far = peak(session * 5);
  assert.ok(far < near, `5x tenor must flatten the ladder (near ${near.toFixed(0)} vs far ${far.toFixed(0)})`);
});

test("degenerate horizonMin/structYears fall back to the session defaults rather than dividing by zero", () => {
  // Fail-safe, not fail-weird: a caller passing 0/negative/NaN must land on the documented default,
  // never produce Infinity/NaN in a member-facing cone.
  const now = "2026-07-21T15:00:00Z";
  const expected = forecastPin(base(now));
  for (const bad of [0, -390, Number.NaN]) {
    const got = forecastPin(base(now, { horizonMin: bad, structYears: bad }));
    assert.deepEqual(got, expected, `horizonMin/structYears=${bad} must fall back to the defaults`);
    assert.ok(got.cone.every((s) => Number.isFinite(s.p10) && Number.isFinite(s.p50) && Number.isFinite(s.p90)));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Implied-move bound on the magnet pull, and the confidence ceiling that goes
// with it. Live regression: 2026-08-07, NVDA on the Vector pin-forecast route.
// ─────────────────────────────────────────────────────────────────────────────

/** NVDA as it actually stood at 09:58:30 ET on 2026-08-07. */
const NVDA = { spot: 222.03, atmIv: 0.46, tMin: 362, priorClose: 218.99 };

/**
 * Long-gamma shape with a DISTANT max-pain magnet — the exact configuration that produced the live
 * defect. Call OI concentrated below spot puts the gamma flip under spot (⇒ long gamma), and the low
 * put mass drags max pain ~22 points below spot, far outside the name's own implied move.
 */
function longGammaDistantMagnet(iv = NVDA.atmIv): PinContract[] {
  const out: PinContract[] = [];
  for (let k = 190; k <= 250; k += 2.5) {
    out.push({ strike: k, type: "call", openInterest: k >= 200 && k <= 218 ? 40000 : 1500, dayVolume: 0, iv });
    out.push({ strike: k, type: "put", openInterest: k >= 195 && k <= 207.5 ? 9000 : 400, dayVolume: 0, iv });
  }
  return out;
}

function nvdaInput(method: "analytic" | "montecarlo", contracts = longGammaDistantMagnet()): PinForecastInput {
  const nowMs = Date.UTC(2026, 7, 7, 13, 58, 0);
  return {
    spot: NVDA.spot, priorClose: NVDA.priorClose, contracts, sessionYmd: "2026-08-07",
    nowMs, closeMs: nowMs + NVDA.tMin * 60_000, atmIv: NVDA.atmIv, method, seed: 7,
  };
}

test("remainingSigma reproduces the expected-move route's own 1σ for the live NVDA inputs", () => {
  // The two Vector surfaces must share one definition of "how far can this name travel" or they
  // cannot help contradicting each other. The live /expected-move read served ±2.71 pts.
  const sig = remainingSigma(NVDA.spot, NVDA.atmIv, NVDA.tMin);
  assert.ok(Math.abs(sig - 2.71) < 0.05, `expected ~2.71 pts, got ${sig.toFixed(3)}`);
});

test("impliedBandProbability reproduces the 10.1% the audit computed independently", () => {
  // The headline contradiction: the forecast claimed 98% for this band; the option market prices it
  // at ~10%. Anything materially off this number means the ceiling is anchored to the wrong scale.
  const p = impliedBandProbability(NVDA.spot, [211.43, 218.57], remainingSigma(NVDA.spot, NVDA.atmIv, NVDA.tMin));
  assert.ok(Math.abs(p - 0.101) < 0.02, `expected ~10.1%, got ${(p * 100).toFixed(1)}%`);
});

test("boundMagnetTarget leaves a near magnet ALONE and only bites on a distant one", () => {
  const sig = remainingSigma(NVDA.spot, NVDA.atmIv, NVDA.tMin); // 2.68
  const near = boundMagnetTarget(NVDA.spot, 223.5, sig);
  assert.equal(near.target, 223.5, "a magnet inside the cone must pass through untouched");
  assert.equal(near.clamped, false);

  const far = boundMagnetTarget(NVDA.spot, 207.5, sig); // the real, correctly-located NVDA max pain
  assert.equal(far.clamped, true);
  assert.ok(Math.abs(far.target - (NVDA.spot - 2 * sig)) < 1e-9, "clamped to exactly 2σ below spot");
});

test("no implied distribution (σ=0) leaves the target alone rather than collapsing it to spot", () => {
  // Absent a distribution there is no bound to apply. Snapping to spot would be a FABRICATED
  // forecast dressed as a conservative one.
  const r = boundMagnetTarget(100, 130, 0);
  assert.equal(r.target, 130);
  assert.equal(r.clamped, false);
});

test("LIVE REGRESSION: projectedClose can no longer sit outside the name's own implied move", () => {
  // Before the fix this chain projected 212.55 (analytic) / 209.83 (MC) — 3.54σ and 4.55σ from spot,
  // i.e. outside even the 2σ band /api/market/vector/expected-move served for the same name at the
  // same second. Two surfaces of one product contradicting each other on one chart.
  const sig = remainingSigma(NVDA.spot, NVDA.atmIv, NVDA.tMin);
  for (const method of ["analytic", "montecarlo"] as const) {
    const f = forecastPin(nvdaInput(method));
    assert.equal(f.regime, "long_gamma", `${method}: precondition — this must exercise the long-gamma branch`);
    assert.ok(f.magnet != null && f.magnet.strike < NVDA.spot - 5 * sig, `${method}: precondition — the magnet must be genuinely distant`);
    assert.equal(f.magnetClamped, true, `${method}: a magnet this far out must be reported as clamped`);

    // The audit's own criterion: the projection must lie inside the 2σ band /expected-move serves
    // for the same name. The bound applies to the DRIFT TARGET (asserted exactly, above); the MC's
    // realized median can diffuse a hair past it, which is honest — it is a bundle, not a point.
    const disp = Math.abs(f.projectedClose! - NVDA.spot) / sig;
    assert.ok(disp <= 2.0, `${method}: projectedClose ${f.projectedClose} is ${disp.toFixed(2)}σ from spot — outside the 2σ implied band`);
    assert.ok(disp < 3.5, `${method}: must be materially better than the 3.54σ/4.55σ this chain produced pre-fix`);
  }
});

test("the magnet STRIKE is still reported truthfully — only the pull is bounded", () => {
  // NVDA's max pain at 207.5 was corroborated exactly against independent Polygon data. Bounding the
  // projection must not relocate, hide, or soften the magnet the desk is actually reading.
  const f = forecastPin(nvdaInput("analytic"));
  assert.equal(f.magnet?.kind, "max_pain");
  assert.ok(f.magnet!.strike < NVDA.spot, "the real, distant magnet must still be served");
});

test("pinPct can never exceed 2x the implied probability of its OWN band", () => {
  // The invariant that makes the confidence commensurable with the expected-move surface. Asserted
  // across BOTH methods and BOTH chain shapes so it holds generally, not just on the regression case.
  for (const method of ["analytic", "montecarlo"] as const) {
    for (const [label, input] of [
      ["distant-magnet", nvdaInput(method)],
      ["shipped SPX fixture", base("2026-07-21T15:00:00Z", { method, seed: 7 })],
    ] as const) {
      const f = forecastPin(input);
      if (f.pinPct == null || f.pinBand == null) continue;
      const sig = remainingSigma(f.spot, f.ivFallback ? 0.12 : (input.atmIv ?? 0.12), f.timeToCloseMin);
      const ceiling = 2 * impliedBandProbability(f.spot, f.pinBand, sig);
      // 0.02 is the model's own confidence FLOOR — it may sit above the ceiling on a band the market
      // says is near-impossible, and refusing to report below 2% is deliberate, not a violation.
      assert.ok(
        f.pinPct <= Math.max(ceiling, 0.02) + 1e-3, // toFixed(3) rounding on the served value
        `${method}/${label}: pinPct ${f.pinPct} exceeds 2x implied ${ceiling.toFixed(3)} for band ${JSON.stringify(f.pinBand)}`
      );
    }
  }
});

test("REGRESSION: the MC no longer hard-zeroes magnet strength on long-gamma names", () => {
  // `wallOi` used to be initialised to 0 and assigned ONLY inside the short_gamma branch, so on any
  // long-gamma name `strengthPct` came out 0/totalOi = 0, and the intended fallback to the
  // prep-computed strength was reachable only on a chain with ZERO total OI — i.e. never. Every
  // long-gamma name ran the whole simulation at magnetPullScale's 0.12 floor. Verified live
  // 2026-08-07: NVDA served magnet.strengthPct 0.23 while the MC that moved price used 0.
  //
  // Pinned at SOURCE rather than through a fixture, and that is a DELIBERATE limitation worth
  // stating: `pullFraction` saturates at both ends, so end-to-end the projection is insensitive to
  // strength on exactly the chains where this branch runs — a wide cone converges fully onto the
  // magnet at any strength, and a narrow one is bounded before strength matters. A behavioural test
  // here would pass on the broken code too. The repo already pins non-type-checkable contracts this
  // way (see api/market/vector/pin-forecast/route.test.ts).
  const src = readFileSync("src/features/spx/lib/spx-pin-forecast-core.ts", "utf8");
  assert.doesNotMatch(src, /let wallOi = 0;/, "the 0-initialiser IS the bug — null means 'not a wall', 0 means 'an empty wall'");
  assert.match(src, /let wallOi: number \| null = null;/);
  assert.match(
    src,
    /wallOi != null \? \(w\.totalOi > 0 \? wallOi \/ w\.totalOi : p\.magnetStrengthPct\) : p\.magnetStrengthPct/,
    "a max-pain target must carry the prep-computed max-pain strength, not a wall's absent OI"
  );
});

test("bounding does NOT disturb the names that were behaving — SPX fixture is byte-identical", () => {
  // SPX/SPY/QQQ/AMD/META all pinned within a few points of spot on 2026-08-07 and were correct. The
  // bound must be inert there or it is not a fix, it is a behaviour change.
  for (const method of ["analytic", "montecarlo"] as const) {
    const f = forecastPin(base("2026-07-21T15:00:00Z", { method, seed: 7 }));
    assert.equal(f.magnetClamped, false, `${method}: a near magnet must not be clamped`);
  }
});

// ── Max-pain LABEL disambiguation (P1/P2, 2026-08-07) ───────────────────────
//
// Two correct metrics wore one member-facing label. Live: header MAX PAIN 7630 (OI-only) vs the
// pin panel's "7700 max pain is the dominant magnet" (OI+volume), 70pts apart, same instant.
// Independently verified against the full Polygon SPXW chain — BOTH reproduce exactly.

test("pinMaxPain is OI+VOLUME weighted, which is WHY it differs from the OI-only header tile", () => {
  // Same chain, volume concentrated at a strike away from the OI peak. This is the mechanism that
  // produced the 7630-vs-7700 split; asserting it keeps the two definitions from silently merging.
  const base: PinContract[] = [];
  for (let k = 7600; k <= 7800; k += 50) {
    base.push({ strike: k, type: "call", openInterest: k === 7650 ? 40000 : 1000, dayVolume: 0, iv: 0.12 });
    base.push({ strike: k, type: "put", openInterest: k === 7650 ? 40000 : 1000, dayVolume: 0, iv: 0.12 });
  }
  const oiOnly = pinMaxPain(base);
  // Now add heavy intraday VOLUME at a different strike — OI unchanged.
  const withVolume = base.map((c) =>
    c.strike === 7750 ? { ...c, dayVolume: 80000 } : c
  );
  const oiPlusVolume = pinMaxPain(withVolume);
  assert.notEqual(
    oiPlusVolume, oiOnly,
    "volume must move pinMaxPain — if it does not, the two surfaces would agree and the label split is moot"
  );
});

test("the magnet driver says 'effective max pain', never bare 'max pain'", () => {
  const now = "2026-07-21T15:00:00Z";
  const f = forecastPin(base(now, { method: "analytic", seed: 7 }));
  const maxPainDrivers = f.drivers.filter((d) => /max pain/i.test(d.label));
  for (const d of maxPainDrivers) {
    assert.match(
      d.label, /effective max pain/i,
      `a bare "max pain" label collides with the header's OI-only tile: ${d.label}`
    );
  }
});

test("the secondary driver explains WHY it can differ from the header", () => {
  const src = readFileSync("src/features/spx/lib/spx-pin-forecast-core.ts", "utf8");
  assert.match(src, /open interest PLUS today's traded volume/);
  assert.match(src, /open-interest-only MAX PAIN/);
});

test("the arithmetic is deliberately UNCHANGED — only the label moved", () => {
  // The audit's Polygon cross-check confirmed the forecast's magnet location to the strike, and the
  // volume-weighted figure is the better intraday pin estimator. Removing the dayVolume term would
  // be the wrong fix.
  const src = readFileSync("src/features/spx/lib/spx-pin-forecast-core.ts", "utf8");
  assert.match(src, /const oi = c\.openInterest \+ Math\.max\(0, c\.dayVolume \?\? 0\)/);
});
