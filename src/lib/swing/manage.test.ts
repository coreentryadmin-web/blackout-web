import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSwingManagement,
  evaluateDteMigration,
  detectRollCandidate,
  SWING_SUBLANE_MANAGE,
  GATING_RUNGS,
  type SwingManageInput,
} from "./manage.ts";
import { buildSwingDossier, type SwingDossier } from "./dossier.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";

function accum(direction: "bull" | "bear"): ZeroDteFlowAccumulation {
  return {
    direction,
    strength: 80,
    days: 4,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100,
    magnet_side: direction === "bull" ? "call" : "put",
    aligned: true,
  };
}

/** A real dossier via the canonical builder, so `direction` + `subLane` come from the shipped logic. */
function dossier(dir: "bull" | "bear", intendedDte: number): SwingDossier {
  const reads: SwingReads = {
    accumulation: accum(dir),
    flowWindowDays: 5,
    returnPct10d: dir === "bull" ? 8 : -8,
    spyReturnPct10d: 1,
    priceAboveEma20: dir === "bull",
    ema20AboveEma50: dir === "bull",
    ema50Rising: dir === "bull",
  };
  return buildSwingDossier({
    ticker: "NVDA",
    intendedDte,
    reads,
    structure: { priceAboveEma20: dir === "bull", ema20AboveEma50: dir === "bull", ema50Rising: dir === "bull" },
    relStrength: { nameReturnPct: dir === "bull" ? 8 : -8, spyReturnPct: 1 },
    flow: { accumAlignedDays: 4, accumTotalDays: 5 },
  });
}

const LONG_STD = dossier("bull", 14); // STANDARD, direction LONG
const SHORT_STD = dossier("bear", 14); // STANDARD, direction SHORT

test("LONG breakout profit-ladder: keeps the runner above its trail, takes the partial at 2× (advisory)", () => {
  // Already scaled, mark well above the 50%-of-peak trail → the runner is kept (HOLD).
  const keep = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    peakPremium: 6,
    lastMark: 5, // 5 > 6*0.5=3 → above trail
    scaledAlready: true,
    underlyingPrice: 110,
    structuralStopLevel: 95, // well above stop → thesis intact
  });
  assert.equal(keep.action, "HOLD", "runner above its trailing stop is kept");

  // Not yet scaled, mark at 2× entry → advisory profit ladder TAKE_PARTIAL, evidence-only.
  const partial = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    peakPremium: 4,
    lastMark: 4, // 2× entry
    scaledAlready: false,
    underlyingPrice: 110,
    structuralStopLevel: 95,
  });
  assert.equal(partial.action, "TAKE_PARTIAL");
  assert.equal(partial.rung, "profit_ladder");
  assert.equal(partial.enforced, false, "profit ladder is edge/advisory — evidence-only until graduated");

  // Runner retraced to 50% of peak → EXIT_RUNNER (still advisory).
  const trail = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    peakPremium: 6,
    lastMark: 3, // = 6*0.5 → trail hit
    scaledAlready: true,
    underlyingPrice: 110,
    structuralStopLevel: 95,
  });
  assert.equal(trail.action, "EXIT_RUNNER");
  assert.equal(trail.rung, "profit_ladder");
});

test("structural_stop fires at ANY premium P&L — even +30% green — because the UNDERLYING broke", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    peakPremium: 2.6,
    lastMark: 2.6, // +30% on the OPTION (green)
    scaledAlready: false,
    underlyingPrice: 94, // ≤ structural stop
    structuralStopLevel: 95,
  });
  assert.equal(v.action, "EXIT");
  assert.equal(v.rung, "structural_stop");
  assert.equal(v.enforced, true, "structural stop is capital preservation — always enforced");
});

// BUG FIX (2026-09-18, peer-review finding on PR #5190): structuralStopBroken() interpolated
// comparePx/stop into verdict.reason with no rounding. On an ex-dividend session,
// underlyingPriceForStructuralStop() computes `price + cash` via raw floating-point addition, so a
// real (price, cash) pair can produce a visible artifact like 10.790000000000001. Was write-only
// (never displayed) until PR #5190 wired verdict.reason into the member-facing narrative via
// manageReasonDetail — must render as a clean 2dp string, never a raw float.
test("structural_stop reason: ex-div LONG adjustment (price+cash) renders a clean 2dp string, no floating-point artifact", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 10.74,
    structuralStopLevel: 148,
    exDividendSession: true,
    exDividendCash: 0.05, // 10.74 + 0.05 = 10.790000000000001 raw
  });
  assert.equal(v.rung, "structural_stop");
  assert.match(v.reason, /underlying 10\.79 ≤ structural stop 148\.00/);
  assert.doesNotMatch(v.reason, /\d\.\d{3,}/, "no more than 2 decimal digits anywhere in the reason string");
});

test("structural_stop reason: plain (non-ex-div) LONG/SHORT breach also renders a clean 2dp string", () => {
  const longV = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94,
    structuralStopLevel: 95,
  });
  assert.match(longV.reason, /underlying 94\.00 ≤ structural stop 95\.00/);

  const shortV = evaluateSwingManagement({
    dossier: SHORT_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 101,
    structuralStopLevel: 100,
  });
  assert.match(shortV.reason, /underlying 101\.00 ≥ structural stop 100\.00/);
});

// BUG FIX (2026-09-21, Ask Largo standing mandate — 7th instance of the toFixed-vs-roundFloats
// price-level bug class this session already fixed across #5380/#5383/#5384/#5385/#5387). PR
// #5190's own fix above collapsed structuralStopBroken()'s reason to exactly 2 decimal digits
// (`n.toFixed(2)`) to kill many-digit floating-point artifacts — correct for THAT problem, but
// `.toFixed(2)` and roundFloats' own `Math.round(n*100)/100` can disagree by a full cent on a
// value sitting exactly on a half-cent boundary (e.g. `(95.175).toFixed(2) === "95.17"` while
// `Math.round(95.175*100)/100 === 95.18`). This reason string is PERSISTED verbatim every tick
// (manage-sync.ts's event_json.reason) and rendered member-facing via manageReasonDetail
// (play-brief-narrative.ts's sellReasonClause, "**Exit now** — underlying X <= structural stop
// Y ...") — while the SAME underlying spot / structural-stop level (a call/put wall or gamma
// flip) is ALSO shown as a raw, roundFloats()'d number in envelope.levels for the same brief, so
// the two can silently disagree for a real EXIT/structural_stop verdict, the same shape as this
// session's other 6 fixes just in a persisted decision-trail string rather than a live-request
// narration function.
test("structural_stop reason matches roundFloats' rounding, not plain toFixed(2), at a half-cent boundary", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94, // <= stop 95.175 -> broken
    structuralStopLevel: 95.175,
  });
  assert.equal(v.rung, "structural_stop");
  assert.match(v.reason, /structural stop 95\.18/, "must round like roundFloats (95.18), not plain toFixed(2) (95.17)");
  assert.doesNotMatch(v.reason, /95\.17\b/);
});

test("structural_stop: ex-div LONG adjustment prevents false breach on mechanical gap (Q39)", () => {
  const breached = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94,
    structuralStopLevel: 95,
    exDividendSession: true,
    exDividendCash: 1,
  });
  assert.equal(breached.rung, "structural_stop");

  const held = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94,
    structuralStopLevel: 95,
    exDividendSession: true,
    exDividendCash: 2,
  });
  assert.notEqual(held.rung, "structural_stop", "adjusted 94+2=96 holds above stop 95");
});

test("structural_stop: ex-div data-unavailable fails SAFE — a LONG breach is skipped, not enforced (Q39 fail-open regression)", () => {
  // Without exDividendDataUnavailable, this input breaches (same shape as the "fires at ANY
  // premium P&L" test above) — proves this test's baseline actually would have EXIT'd.
  const noFlag = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94,
    structuralStopLevel: 95,
  });
  assert.equal(noFlag.rung, "structural_stop");
  assert.equal(noFlag.action, "EXIT");

  // Same inputs, but this cycle's ex-dividend read failed (Polygon error/timeout) — we cannot
  // tell whether the drop to 94 is a real thesis break or an unadjusted ex-div mechanical gap.
  // Fail SAFE: do not enforce the stop this cycle rather than fail-open trusting exDividendSession
  // defaulting to false.
  const unavailable = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 94,
    structuralStopLevel: 95,
    exDividendDataUnavailable: true,
  });
  assert.notEqual(unavailable.rung, "structural_stop", "unknown ex-div data must not enforce a stop it can't verify");
  assert.notEqual(unavailable.action, "EXIT", "fail-safe: skip enforcement this cycle, don't fail-open EXIT");
});

test("structural_stop: ex-div data-unavailable does NOT mask a genuine SHORT breach (adjustment is LONG-only)", () => {
  // The ex-div adjustment only ever applies to LONG (underlyingPriceForStructuralStop is a no-op
  // for SHORT), so a data-unavailable flag must not suppress a real SHORT structural-stop breach —
  // there is no ex-div gap risk on that side to guard against.
  const v = evaluateSwingManagement({
    dossier: SHORT_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.6,
    underlyingPrice: 106,
    structuralStopLevel: 105,
    exDividendDataUnavailable: true,
  });
  assert.equal(v.action, "EXIT");
  assert.equal(v.rung, "structural_stop", "SHORT breach must still enforce even when ex-div data is unavailable");
});

test("structural_stop is direction-aware: SHORT breaks when the underlying rises through the stop", () => {
  const v = evaluateSwingManagement({
    dossier: SHORT_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.6, // green option
    underlyingPrice: 106, // ≥ stop → SHORT thesis broken
    structuralStopLevel: 105,
  });
  assert.equal(v.action, "EXIT");
  assert.equal(v.rung, "structural_stop");
});

test("premium_stop: the −60% capital backstop fires (pre-scale) at 0.4× entry", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 0.8, // 0.4× entry = −60%
    scaledAlready: false,
    underlyingPrice: 108, // underlying still above stop (structural intact) → premium backstop owns it
    structuralStopLevel: 95,
  });
  assert.equal(v.action, "STOP_OUT");
  assert.equal(v.rung, "premium_stop");
  assert.equal(v.enforced, true);
});

test("precedence: structural_stop outranks expiry_risk — broken thesis never rolls at the cliff", () => {
  const v = evaluateSwingManagement({
    dossier: dossier("bull", 5),
    dte: 1,
    entryPremium: 2,
    lastMark: 1.4,
    underlyingPrice: 94,
    structuralStopLevel: 95,
  });
  assert.equal(v.rung, "structural_stop");
  assert.equal(v.rollIntent.roll, false);
});

test("precedence: expiry_risk (GATE) outranks a green profit ladder when thesis intact", () => {
  const v = evaluateSwingManagement({
    dossier: dossier("bull", 5), // TACTICAL
    dte: 1, // ≤ TACTICAL.expiryRiskDte (1) → theta cliff
    entryPremium: 2,
    lastMark: 4, // would be a 2× TAKE_PARTIAL if not gated
    scaledAlready: false,
    underlyingPrice: 110,
    structuralStopLevel: 95,
  });
  assert.equal(v.rung, "expiry_risk");
  assert.equal(v.action, "EXIT");
  assert.equal(v.enforced, true);
});

test("DTE migration + roll intent: 3 DTE Tactical with theta disproportion signals a roll (still-valid thesis)", () => {
  const input: SwingManageInput = {
    dossier: dossier("bull", 5), // TACTICAL, migrationDte 3
    dte: 3,
    entryPremium: 2,
    lastMark: 1.4, // 0.70× — decaying
    thesisProgress01: 0.1, // barely progressed → 0.30 lost > 0.10 progress
    underlyingPrice: 110,
    structuralStopLevel: 95, // thesis intact
  };
  const mig = evaluateDteMigration(input);
  assert.equal(mig.migrate, true);

  const roll = detectRollCandidate(input);
  assert.equal(roll.roll, true);

  const v = evaluateSwingManagement(input);
  assert.equal(v.dteMigration.migrate, true, "migration surfaces on the verdict regardless of primary rung");
  assert.equal(v.rollIntent.roll, true);
});

// BUG FOUND (Ask Largo standing mandate, 2026-09-20): detectRollCandidate's own reason string used
// to end "(INTENT ONLY; execution deferred to PR-15)" -- accurate when this function predated the
// roll executor, false now that roll.ts (PR-15) is shipped and live (it reads rollIntent.roll on
// every management tick to decide ROLL vs CLOSE). No member ever saw the stale text directly
// (live-plays.ts/horizon-plays.ts both route member-facing prose through dteMigration.reason
// instead), but the string itself -- and roll.ts's own decideRollAction, which still embeds it
// verbatim in its ROLL action's internal reason -- both asserted something false. Fixed at the
// source.
test("detectRollCandidate: reason string no longer claims execution is deferred (PR-15 shipped)", () => {
  const input: SwingManageInput = {
    dossier: dossier("bull", 5),
    dte: 3,
    entryPremium: 2,
    lastMark: 1.4,
    thesisProgress01: 0.1,
    underlyingPrice: 110,
    structuralStopLevel: 95,
  };
  const roll = detectRollCandidate(input);
  assert.equal(roll.roll, true);
  assert.doesNotMatch(
    roll.reason,
    /INTENT ONLY|deferred to PR-15/,
    `roll.ts (PR-15) is shipped and live -- this reason string must not claim execution is still deferred, got: ${roll.reason}`,
  );
});

test("roll intent is vetoed by a broken thesis (a broken thesis is a CLOSE, not a roll)", () => {
  const input: SwingManageInput = {
    dossier: dossier("bull", 5),
    dte: 3,
    entryPremium: 2,
    lastMark: 1.4,
    thesisProgress01: 0.1,
    thesisBroken: true,
    underlyingPrice: 110,
    structuralStopLevel: 95,
  };
  assert.equal(detectRollCandidate(input).roll, false);
  // thesis_stop owns the verdict; migration honestly reports "exit, not roll".
  const v = evaluateSwingManagement(input);
  assert.equal(v.rung, "thesis_stop");
  assert.equal(v.dteMigration.migrate, false);
});

test("HOLD/insufficient_data on a hollow read — never act on missing data", () => {
  const v = evaluateSwingManagement({ dossier: dossier("bull", 14) });
  assert.equal(v.action, "HOLD");
  assert.equal(v.rung, "insufficient_data");
  assert.equal(v.enforced, false);
});

test("genuine HOLD (not insufficient) when data IS present and nothing fires", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2, // green, below 2×, above backstop
    scaledAlready: false,
    underlyingPrice: 108,
    structuralStopLevel: 95,
  });
  assert.equal(v.action, "HOLD");
  assert.equal(v.rung, "hold");
});

test("hold reason is HONEST about what was evaluated — never claims premium/time were checked when they weren't", () => {
  // Only sessionsHeld is known (making anyEvaluable true) -- premium (no entry/mark), structural (no
  // underlyingPrice/structuralStopLevel), and DTE/lane are all unusable/unknown this tick (e.g. a live
  // mark+spot-price fetch outage, a documented recurring pattern in this repo). The verdict must still
  // be a HOLD (nothing indicates an exit), but its reason must not claim "premium above the backstop"
  // or "ample time" -- neither was ever actually checked this tick. This is the same null-honesty
  // discipline the file's header promises for every gate/rung above; the old hardcoded reason string
  // violated it for this one fallback path.
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    sessionsHeld: 2, // STANDARD's own timeStopSessions floor is 8, so this alone doesn't fire time_stop
  });
  assert.equal(v.action, "HOLD");
  assert.equal(v.rung, "hold");
  assert.doesNotMatch(v.reason, /premium above the/, "premium was never evaluated (no entry/mark) -- must not claim it");
  assert.doesNotMatch(v.reason, /ample time/, "DTE/lane was never evaluated -- must not claim ample time");
});

test("hold reason still asserts every dimension when all three ARE evaluable (unchanged from before)", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 108,
    structuralStopLevel: 95,
  });
  assert.equal(v.rung, "hold");
  assert.match(v.reason, /thesis intact/);
  assert.match(v.reason, /premium above the/);
  assert.match(v.reason, /ample time/);
});

test("enforce split: all four capital-preservation rungs enforce; every edge rung is advisory until graduated", () => {
  assert.deepEqual(
    [...GATING_RUNGS].sort(),
    ["expiry_risk", "premium_stop", "structural_stop", "thesis_stop"],
  );

  // An edge rung (catalyst_shift) is advisory by default …
  const advisory = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 108,
    structuralStopLevel: 95,
    catalystShift: true,
  });
  assert.equal(advisory.rung, "catalyst_shift");
  assert.equal(advisory.action, "TAKE_PARTIAL");
  assert.equal(advisory.enforced, false);

  // … and enforces once the caller's graduatedRungs includes it.
  const graduated = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14,
    entryPremium: 2,
    lastMark: 2.2,
    underlyingPrice: 108,
    structuralStopLevel: 95,
    catalystShift: true,
    graduatedRungs: ["catalyst_shift"],
  });
  assert.equal(graduated.enforced, true, "a graduated edge rung flips to enforced");
});

test("advisory time-stop: held past the lane's session budget with a stagnant thesis → EXIT (evidence-only)", () => {
  const v = evaluateSwingManagement({
    dossier: LONG_STD,
    dte: 14, // STANDARD, timeStopSessions 8
    entryPremium: 2,
    lastMark: 1.9, // above backstop, below 2×
    underlyingPrice: 108,
    structuralStopLevel: 95,
    sessionsHeld: 9,
    thesisProgress01: 0.1, // stagnant
  });
  assert.equal(v.rung, "time_stop");
  assert.equal(v.action, "EXIT");
  assert.equal(v.enforced, false, "time-stop is an edge rung — advisory until graduated");
});

test("SWING_SUBLANE_MANAGE covers all three lanes with tightening-by-speed floors", () => {
  assert.ok(SWING_SUBLANE_MANAGE.TACTICAL.expiryRiskDte < SWING_SUBLANE_MANAGE.EXTENDED.expiryRiskDte);
  assert.ok(SWING_SUBLANE_MANAGE.TACTICAL.timeStopSessions < SWING_SUBLANE_MANAGE.EXTENDED.timeStopSessions);
});
