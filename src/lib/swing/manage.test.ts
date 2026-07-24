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

test("precedence: expiry_risk (GATE) outranks a green profit ladder", () => {
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
