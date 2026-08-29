// Pure table tests for the 0DTE exit engine (B-8). No mocks, no IO, no clock:
// exit-engine.ts is a dependency-free leaf (marks-math + cortex types only), so
// every rule fires — and, just as important, DOESN'T fire — against literal inputs.
// Fixtures use entry 4.00 so P&L percentages read directly (5.00 = +25%, 6.00 =
// +50%, 2.00 = the −50% plan stop, 8.00 = the +100% target).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import {
  buildExitContext,
  categorizeExitReason,
  detectThesisBreak,
  evaluateExitState,
  ratchetFloorPct,
  resolveExitMark,
  protectiveFloorMark,
  trimTranchesArmed,
  DEFAULT_EXIT_MODE,
  TRIM_SCALE_RULES,
  EXIT_RULES,
  type ExitEngineInput,
} from "./exit-engine";

const ENTRY = 4.0;

function input(overrides: Partial<ExitEngineInput> = {}): ExitEngineInput {
  return {
    entryPremium: ENTRY,
    currentMark: 4.0,
    peakPremium: 4.0,
    ageMinutes: 10,
    cortexEvidence: null,
    planStop: 2.0, // −50%
    planTarget: 8.0, // +100%
    status: "HOLD",
    trimmed: false,
    entryCortexScore: null,
    ...overrides,
  };
}

function evidence(items: Array<Partial<EvidenceItem>>): EvidenceItem[] {
  return items.map((it, i) => ({
    source: "gex-walls",
    stance: "opposes",
    weight: 1,
    halfLifeSec: 600,
    asOf: "2026-07-14T14:30:00.000Z",
    detail: `fixture evidence ${i}`,
    ...it,
  })) as EvidenceItem[];
}

// ── 1. Profit ratchet — never let green turn red ──────────────────────────────────

test("ratchet: below +15% peak nothing is armed — the trade keeps its room", () => {
  const d = evaluateExitState(input({ peakPremium: 4.56, currentMark: 3.92 })); // peak +14%, now −2%
  assert.equal(d.action, "HOLD");
  assert.equal(d.floorPnlPct, null);
  assert.equal(d.reason, "hold");
});

test("ratchet: +15% peak arms the early +5% floor", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.6, currentMark: 4.3 })); // peak +15%, now +7.5%
  assert.equal(d.action, "RAISE_FLOOR");
  assert.equal(d.floorPnlPct, 5);
  assert.equal(d.reason, "ratchet_early_profit_floor_set");
});

test("ratchet: +20% peak arms the breakeven floor (no exit while above it)", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 4.4 })); // peak +20%, now +10%
  assert.equal(d.action, "RAISE_FLOOR");
  assert.equal(d.floorPnlPct, 0);
  assert.equal(d.reason, "ratchet_breakeven_floor_set");
});

test("ratchet: a mark AT the breakeven floor after a +20% peak exits — green never finishes red", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 4.0 })); // back to 0%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
  assert.equal(d.floorPnlPct, 0);
});

test("ratchet: a mark BELOW the floor exits too (breach, not just touch)", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 3.9 })); // −2.5%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

test("ratchet: +50% peak raises the floor to +20%", () => {
  const hold = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 6.0, currentMark: 5.0 })); // peak +50%, now +25%
  assert.equal(hold.action, "RAISE_FLOOR");
  assert.equal(hold.floorPnlPct, 20);
  assert.equal(hold.reason, "ratchet_profit_floor_set");

  const exit = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 6.0, currentMark: 4.8 })); // exactly +20%
  assert.equal(exit.action, "EXIT");
  assert.equal(exit.reason, "ratchet_profit_floor");
  assert.equal(exit.floorPnlPct, 20);
});

test("ratchet: the floor is MONOTONIC — a deep retrace never lowers +20% back to breakeven", () => {
  // Peak +50% earlier; the mark has now retraced to +10%. If the floor re-derived
  // from the current mark it would read 0 (or null) — it must stay 20 and exit.
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 6.0, currentMark: 4.4 })); // +10%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_profit_floor");
  assert.equal(d.floorPnlPct, 20, "floor derives from the latched peak, never the retraced mark");
});

test("ratchetFloorPct: pure floor table (early 15→5, arm 20→0, lock 50→20, trim→50)", () => {
  assert.equal(ratchetFloorPct(null, false), null);
  assert.equal(ratchetFloorPct(14.99, false), null);
  assert.equal(ratchetFloorPct(15, false), 5);
  assert.equal(ratchetFloorPct(19.99, false), 5);
  assert.equal(ratchetFloorPct(20, false), 0);
  assert.equal(ratchetFloorPct(49.99, false), 0);
  assert.equal(ratchetFloorPct(50, false), 20);
  assert.equal(ratchetFloorPct(400, false), 20);
  assert.equal(ratchetFloorPct(10, true), EXIT_RULES.runner_floor_pct, "trim latch alone sets the runner floor");
});

test("runner floor: after a TRIM the remaining position never gives back below +50%", () => {
  const hold = evaluateExitState(input({ exitMode: "ratchet", trimmed: true, status: "TRIM", peakPremium: 9.0, currentMark: 6.2 })); // +55%
  assert.equal(hold.action, "RAISE_FLOOR");
  assert.equal(hold.floorPnlPct, 50);
  assert.equal(hold.reason, "runner_floor_set");

  const exit = evaluateExitState(input({ exitMode: "ratchet", trimmed: true, status: "TRIM", peakPremium: 9.0, currentMark: 6.0 })); // +50%
  assert.equal(exit.action, "EXIT");
  assert.equal(exit.reason, "runner_floor");
  assert.equal(exit.floorPnlPct, 50);
});

// ── 2. Thesis break — unconditional, evidence-driven ──────────────────────────────

test("thesis break: a single VETO-class item exits even at a −20% loss", () => {
  const d = evaluateExitState(
    input({
      currentMark: 3.2, // −20%: no floor armed (peak never reached +25%), above the plan stop
      peakPremium: 4.1,
      cortexEvidence: evidence([{ stance: "veto", source: "wall-trend", detail: "opposing wall building at 180" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:wall-trend");
  assert.match(d.detail, /opposing wall building/);
});

test("thesis break: ≥2 opposing items whose combined weight beats the entry margin exit", () => {
  const d = evaluateExitState(
    input({
      currentMark: 4.2,
      peakPremium: 4.3,
      entryCortexScore: 1.2,
      cortexEvidence: evidence([
        { stance: "opposes", source: "flow-quality", weight: 0.9 },
        { stance: "opposes", source: "gex-walls", weight: 0.8 }, // combined 1.7 > 1.2
      ]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:flow-quality", "reason carries the heaviest opposing source");
});

test("thesis break does NOT fire: one oppose (however heavy) is a data point, not a cluster", () => {
  const d = evaluateExitState(
    input({ cortexEvidence: evidence([{ stance: "opposes", weight: 3.0 }]) })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break does NOT fire: two opposes inside the entry's committed score margin", () => {
  const d = evaluateExitState(
    input({
      entryCortexScore: 2.0,
      cortexEvidence: evidence([
        { stance: "opposes", weight: 0.9 },
        { stance: "opposes", weight: 0.8 }, // combined 1.7 ≤ margin 2.0 — cushion holds
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break does NOT fire: two microscopic opposes stay under the noise floor when no entry score exists", () => {
  const d = evaluateExitState(
    input({
      entryCortexScore: null,
      cortexEvidence: evidence([
        { stance: "opposes", weight: 0.2 },
        { stance: "opposes", weight: 0.2 }, // 0.4 ≤ noise floor 0.5
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("thesis break: supports/absent stances never count toward a break", () => {
  const d = evaluateExitState(
    input({
      cortexEvidence: evidence([
        { stance: "supports", weight: 2 },
        { stance: "supports", weight: 2 },
        { stance: "absent", weight: 0 },
      ]),
    })
  );
  assert.equal(d.action, "HOLD");
});

test("missing evidence NEVER exits: null cortexEvidence skips the thesis check only", () => {
  assert.equal(detectThesisBreak(null, 1), null);
  const d = evaluateExitState(input({ cortexEvidence: null, currentMark: 3.2, peakPremium: 4.1 }));
  assert.equal(d.action, "HOLD", "a −20% play with no evidence holds — the stop owns the downside");
});

// ── 3. Flat timeout — theta bleed ─────────────────────────────────────────────────

test("flat timeout: 25min inside the ±10% band exits as a scratch", () => {
  const d = evaluateExitState(input({ ageMinutes: 25, peakPremium: 4.3, currentMark: 3.8 })); // peak +7.5%, now −5%
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "flat_theta_bleed");
});

test("flat timeout does NOT fire at 24 minutes", () => {
  const d = evaluateExitState(input({ ageMinutes: 24, peakPremium: 4.3, currentMark: 3.8 }));
  assert.equal(d.action, "HOLD");
});

test("flat timeout does NOT fire when the peak escaped the band (+12% had a pulse)", () => {
  const d = evaluateExitState(input({ ageMinutes: 90, peakPremium: 4.48, currentMark: 4.0 })); // peak +12%
  assert.equal(d.action, "HOLD");
});

test("flat timeout does NOT fire below the band — the stop rules own the losing tail", () => {
  const d = evaluateExitState(input({ ageMinutes: 90, peakPremium: 4.2, currentMark: 3.5 })); // −12.5%
  assert.equal(d.action, "HOLD");
});

// ── 4. Plan stop/target stay authoritative ────────────────────────────────────────

test("plan stop: mark at/below the printed stop exits with plan_stop when no floor is armed", () => {
  const d = evaluateExitState(input({ currentMark: 2.0, peakPremium: 4.2 }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_stop");
});

test("plan target: first touch TRIMs (bank half) and hands the runner a +50% floor", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", currentMark: 8.0, peakPremium: 8.0 }));
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "plan_target_trim");
  assert.equal(d.floorPnlPct, EXIT_RULES.runner_floor_pct);
});

test("plan target: at/above target when already trimmed banks the runner in full", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", currentMark: 8.2, peakPremium: 8.5, trimmed: true, status: "TRIM" }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_target_final");
});

// ── 5. Precedence collisions ──────────────────────────────────────────────────────

test("precedence: ratchet floor breach + thesis veto on the same tick → the floor reason wins", () => {
  const d = evaluateExitState(
    input({
      exitMode: "ratchet",
      peakPremium: 5.0, // +25% → breakeven floor armed
      currentMark: 3.95, // below the floor
      cortexEvidence: evidence([{ stance: "veto", source: "flow-quality" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

test("precedence: stop AND floor breached together → the HIGHER protective mark labels the exit", () => {
  // Peak +50% → floor +20% (mark 4.8) vs plan stop 2.0: a crash through both in one
  // tick is labeled by the floor — the level that actually protected more.
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 6.0, currentMark: 1.9 }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_profit_floor");
});

test("precedence: thesis break outranks the plan target — evidence the play is wrong beats 'let it run'", () => {
  const d = evaluateExitState(
    input({
      currentMark: 8.4, // above target
      peakPremium: 8.4,
      cortexEvidence: evidence([{ stance: "veto", source: "catalyst-news" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:catalyst-news");
});

test("precedence: thesis break outranks the flat timeout", () => {
  const d = evaluateExitState(
    input({
      ageMinutes: 60,
      peakPremium: 4.2,
      currentMark: 4.0,
      cortexEvidence: evidence([{ stance: "veto", source: "sector-heat" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:sector-heat");
});

test("precedence: target TRIM outranks flat timeout (a doubled play is not 'flat')", () => {
  const d = evaluateExitState(input({ ageMinutes: 60, currentMark: 8.0, peakPremium: 8.0 }));
  assert.equal(d.action, "TRIM");
});

// ── 6. Guards — missing data never exits ──────────────────────────────────────────

test("guard: a CLOSED row is terminal — the engine never re-decides it", () => {
  const d = evaluateExitState(input({ status: "CLOSED", currentMark: 1.0 }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "already_closed");
});

test("guard: no live mark → HOLD, but the armed floor is still reported", () => {
  const d = evaluateExitState(input({ exitMode: "ratchet", currentMark: null, peakPremium: 6.0 }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "no_live_mark");
  assert.equal(d.floorPnlPct, 20, "the floor stands even when this tick has no quote");
});

test("guard: no entry premium → HOLD (P&L underivable)", () => {
  const d = evaluateExitState(input({ entryPremium: null }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "no_entry_premium");
});

// ── 7. The counterfactual exit record ─────────────────────────────────────────────

test("buildExitContext: floor breach honors the floor mark — never persists a red finish", () => {
  const decision = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 3.48 })); // −13% observed
  assert.equal(decision.reason, "ratchet_breakeven_floor");
  const ctx = buildExitContext(decision, ENTRY, 3.48, 4.8, Date.UTC(2026, 6, 14, 15, 0, 0));
  assert.equal(ctx.mark, 4.0, "breakeven floor honored even when mark gapped through");
  assert.equal(ctx.pnl_pct, 0);
  assert.equal(ctx.peak_pnl_pct, 20);
  // Provenance: the persisted mark (4.0) is a floor-HONORED inference, not the observed 3.48 print.
  assert.equal(ctx.mark_observed, 3.48, "the raw observed mark is kept, not discarded");
  assert.equal(ctx.mark_honored, true, "a floor-honored fill is flagged as inferred, not observed");
});

test("buildExitContext: a thesis exit uses the observed mark verbatim — mark_honored is false", () => {
  const decision = evaluateExitState(
    input({
      currentMark: 3.2,
      peakPremium: 4.1,
      cortexEvidence: evidence([{ stance: "veto", source: "wall-trend" }]),
    })
  );
  const ctx = buildExitContext(decision, ENTRY, 3.2, 4.1, Date.UTC(2026, 6, 14, 15, 0, 0));
  assert.equal(ctx.mark, 3.2, "thesis exit takes the observed mark, no floor honoring");
  assert.equal(ctx.mark_observed, 3.2);
  assert.equal(ctx.mark_honored, false, "an observed fill is NOT flagged as inferred");
});

test("resolveExitMark: ratchet floor caps at floor premium; thesis uses observed", () => {
  const floorDecision = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 3.5 }));
  assert.equal(resolveExitMark(floorDecision, ENTRY, 3.5), 4.0);
  const thesisDecision = evaluateExitState(
    input({
      currentMark: 3.2,
      peakPremium: 4.1,
      cortexEvidence: evidence([{ stance: "veto", source: "wall-trend" }]),
    })
  );
  assert.equal(resolveExitMark(thesisDecision, ENTRY, 3.2), 3.2);
});

test("protectiveFloorMark: entry-scaled floor premium", () => {
  assert.equal(protectiveFloorMark(ENTRY, 0), 4.0);
  assert.equal(protectiveFloorMark(ENTRY, 5), 4.2);
});

// ── 8. Exit MODE: ratchet is the default; trim_scale is the E5 ⅓/⅓/run replacement ──
// The trim_scale schedule is DEFAULT-OFF — it graduates on the live-ledger grader, not
// an offline flip. These tables prove the mechanism fires the measured schedule and
// regime-conditions it; the existing suites (unchanged) prove ratchet mode is untouched.

test("mode: DEFAULT_EXIT_MODE is trim_scale — partial trims fire by default", () => {
  assert.equal(DEFAULT_EXIT_MODE, "trim_scale");
  // A +20% peak with NO exitMode fires the FIRST trim tranche (neutral regime).
  const d = evaluateExitState(input({ peakPremium: 4.8, currentMark: 4.8 })); // peak +20%, at peak
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_first");
});

test("trimTranchesArmed: monotonic tranche count off the latched peak, per regime", () => {
  assert.equal(trimTranchesArmed(null, "neutral"), 0);
  assert.equal(trimTranchesArmed(19.99, "neutral"), 0);
  assert.equal(trimTranchesArmed(20, "neutral"), 1);
  assert.equal(trimTranchesArmed(49.99, "neutral"), 1);
  assert.equal(trimTranchesArmed(50, "neutral"), 2);
  assert.equal(trimTranchesArmed(400, "neutral"), 2, "capped at the two tranches");
  // range banks sooner (+15/+40); trend lets it run (+40/+80).
  assert.equal(trimTranchesArmed(15, "range"), 1);
  assert.equal(trimTranchesArmed(40, "range"), 2);
  assert.equal(trimTranchesArmed(20, "trend"), 0, "trend does not trim at +20% — it runs");
  assert.equal(trimTranchesArmed(40, "trend"), 1);
  assert.equal(trimTranchesArmed(80, "trend"), 2);
});

test("TRIM_SCALE_RULES: neutral base is +20/+50 (early arm aligned with breakeven floor)", () => {
  assert.deepEqual(TRIM_SCALE_RULES.tranches_by_regime.neutral, [20, 50]);
  assert.ok(Math.abs(TRIM_SCALE_RULES.tranche_fraction - 1 / 3) < 1e-12);
});

test("trim_scale: +20% peak banks the FIRST third (neutral)", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.8, currentMark: 4.8, trimsTaken: 0 })
  );
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_first");
  assert.equal(d.floorPnlPct, null, "trim_scale has no ratchet floor — it rides the plan stop");
  assert.match(d.detail, /trim 1\/2/);
});

test("trim_scale: +50% peak with the first third already banked banks the SECOND", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 6.0, currentMark: 6.0, trimsTaken: 1 })
  );
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_second");
  assert.match(d.detail, /trim 2\/2/);
});

test("trim_scale: banks ONE third per tick — a peak that armed BOTH still trims the first only", () => {
  // Peak +100% (both tranches armed) but nothing banked yet → the ladder takes ONE step.
  const first = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 8.0, currentMark: 7.0, trimsTaken: 0 })
  );
  assert.equal(first.reason, "trim_scale_first", "one tranche per tick, same as the ratchet trim latch");
  const second = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 8.0, currentMark: 7.0, trimsTaken: 1 })
  );
  assert.equal(second.reason, "trim_scale_second");
});

test("trim_scale: the tranche arms off the LATCHED PEAK — a retraced mark still banks it", () => {
  // Peak +50% earlier; mark now +25% (above the +20% profit floor). Second third still arms.
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 6.0, currentMark: 5.0, trimsTaken: 1 })
  );
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_second");
});

test("trim_scale: both thirds banked → the last third RUNS (RAISE_FLOOR report, no exit)", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 6.0, currentMark: 5.6, trimsTaken: 2 })
  );
  assert.equal(d.action, "RAISE_FLOOR");
  assert.equal(d.reason, "trim_scale_running");
  assert.match(d.detail, /2\/2 thirds banked/);
});

test("trim_scale: the last third banks in full when it tags the +100% target", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 8.0, currentMark: 8.0, trimsTaken: 2 })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "trim_scale_runner_target");
});

test("trim_scale: below the first tranche, nothing fires (holds — room to work)", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.76, currentMark: 4.7, trimsTaken: 0 }) // peak +19%
  );
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "hold");
  assert.match(d.detail, /next trim at \+20%/);
});

test("trim_scale: +15% peak with retrace exits on shared early floor before first trim", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.6, currentMark: 4.1, trimsTaken: 0 }) // peak +15%, now +2.5%
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_early_profit_floor");
  assert.equal(d.floorPnlPct, 5);
});

test("trim_scale regime: RANGE banks tighter (+15% arms the first third)", () => {
  const armed = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "range", peakPremium: 4.6, currentMark: 4.6, trimsTaken: 0 }) // +15%
  );
  assert.equal(armed.action, "TRIM");
  assert.equal(armed.reason, "trim_scale_first");
  const notYet = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "range", peakPremium: 4.56, currentMark: 4.56, trimsTaken: 0 }) // +14%
  );
  assert.equal(notYet.action, "HOLD");
});

test("trim_scale regime: TREND lets it run (+20% does NOT trim; +40% arms the first third)", () => {
  const runs = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "trend", peakPremium: 4.8, currentMark: 4.8, trimsTaken: 0 }) // +20%
  );
  assert.equal(runs.action, "HOLD", "trend day — a +20% momentum leg is let run, not trimmed");
  const arms = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "trend", peakPremium: 5.6, currentMark: 5.6, trimsTaken: 0 }) // +40%
  );
  assert.equal(arms.action, "TRIM");
  assert.equal(arms.reason, "trim_scale_first");
});

test("trim_scale: the plan stop still exits when no protective floor is armed", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", currentMark: 2.0, peakPremium: 4.2, trimsTaken: 0 })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_stop");
});

test("trim_scale: a thesis break dumps the WHOLE remaining position, outranking the trim", () => {
  // Mark at +25% would arm the first trim, but a veto says the play is wrong → exit it all.
  const d = evaluateExitState(
    input({
      exitMode: "trim_scale",
      currentMark: 5.0,
      peakPremium: 5.0,
      trimsTaken: 0,
      cortexEvidence: evidence([{ stance: "veto", source: "wall-trend", detail: "wall building against it" }]),
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "thesis_break:wall-trend");
});

test("trim_scale: a play that never armed a tranche still scratches on the flat timeout", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", ageMinutes: 25, peakPremium: 4.3, currentMark: 3.8, trimsTaken: 0 })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "flat_theta_bleed");
});

test("trim_scale: missing mark holds with a null floor (no ratchet floor in this mode)", () => {
  const d = evaluateExitState(input({ exitMode: "trim_scale", currentMark: null, peakPremium: 6.0 }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.reason, "no_live_mark");
  assert.equal(d.floorPnlPct, null);
});

// ── 8b. Dead-zone guard: an armed-but-untaken tranche now BANKS instead of losing
// to the shared ratchet floor (2026-08-27, live SLS/TSM — see exit-engine.ts's
// decideTrimScale comment for the full root-cause writeup). ─────────────────────────

test("trim_scale DEAD ZONE (neutral, live SLS/TSM shape): peak +22% round-trips to breakeven — banks the first third instead of dumping everything", () => {
  // Neutral tranche 1 triggers at peak >= +20%, and the ratchet's shared breakeven
  // floor ALSO arms at peak >= +20% — an exact coincidence between two independent
  // tables. Before the fix, the floor check ran first and exited the WHOLE position
  // at "ratchet_breakeven_floor" the instant the peak-armed tranche was never banked
  // on an earlier tick (a real gap-through between polls, not a bug in the poll loop).
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.8836, currentMark: 4.0, trimsTaken: 0 }) // peak +22.09%, now 0%
  );
  assert.equal(d.action, "TRIM", "banks the tranche the peak already earned, does not dump to flat");
  assert.equal(d.reason, "trim_scale_first");
  assert.notEqual(d.reason, "ratchet_breakeven_floor", "the old failure mode must not return");
});

test("trim_scale DEAD ZONE (neutral, live TSM shape): peak +20.59% round-trips to breakeven — same fix applies just past the exact threshold", () => {
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.8236, currentMark: 4.0, trimsTaken: 0 }) // peak +20.59%, now 0%
  );
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_first");
});

test("trim_scale DEAD ZONE: once the pending tranche is already taken, the floor exit fires normally (no infinite bypass)", () => {
  // Same peak/mark as the SLS shape, but the caller has ALREADY banked tranche 1
  // (trimsTaken: 1) — nothing new to bank, so the shared floor is free to protect the
  // remainder. `input.trimmed: true` mirrors what the caller sets after a TRIM, which
  // also raises the floor to the +50% runner floor rather than breakeven — so this
  // 0% mark (well below +50%) correctly EXITS the remainder via the runner floor
  // instead of holding. The point of this test is that `trimAvailable` is false once
  // `taken` has caught up with `armed` (armed=1, taken=1), so the floor is NOT
  // suppressed forever — the guard only bypasses the floor for the ONE tick a
  // tranche is newly armable, exactly as intended.
  const d = evaluateExitState(
    input({
      exitMode: "trim_scale",
      peakPremium: 4.8836,
      currentMark: 4.0,
      trimsTaken: 1,
      trimmed: true,
    })
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "runner_floor", "the POST-TRIM +50% runner floor protects the remainder, not breakeven");
});

// ── KNOWN GAP (2026-08-29 audit finding): the dead-zone guard above is proven correct in
// isolation (trimsTaken passed as an independent, LOWER value than what the peak has armed),
// but exit-sync.ts — the only production caller in trim_scale mode — cannot actually produce
// that input shape. It derives `trimsTaken` with the IDENTICAL formula the engine itself uses
// for `armed` (both are `trimTranchesArmed(peakPnlPct, regime)` off the same entry/peak), so in
// every real invocation `taken === armed` and `trimAvailable` (`armed > taken`) is always false.
// This test drives the engine through that REAL derivation (not an independently-chosen
// trimsTaken) to pin what live rows actually see today: the guard does not engage, and a
// peak-then-retrace to the shared floor still dumps the whole position at breakeven — the exact
// SLS/TSM shape the 2026-08-27 fix intended to close. See
// docs/audit/findings-staging/2026-08-29-trim-scale-dead-zone-reopened.md for the full
// root-cause and why a real fix needs a persisted trim-tranche counter (not shipped here).
test("trim_scale DEAD ZONE — KNOWN GAP: via exit-sync.ts's REAL trimsTaken derivation (taken := armed), the SLS shape still dumps to breakeven instead of banking", () => {
  const entry = ENTRY;
  const peakPremium = 4.8836; // peak +22.09%, the live SLS shape
  const peakPnlPct = ((peakPremium - entry) / entry) * 100;
  const regime = "neutral" as const;
  // This is EXACTLY exit-sync.ts's derivation: `trimTranchesArmed(pinnedLivePnlPct(entry, peak), regime)`.
  const trimsTakenAsRealCallerDerivesIt = trimTranchesArmed(peakPnlPct, regime);
  assert.equal(trimsTakenAsRealCallerDerivesIt, 1, "sanity: this peak arms exactly tranche 1");

  const d = evaluateExitState(
    input({
      exitMode: "trim_scale",
      regime,
      peakPremium,
      currentMark: 4.0, // round-tripped to 0%
      trimsTaken: trimsTakenAsRealCallerDerivesIt,
    })
  );
  // KNOWN GAP: this is "ratchet_breakeven_floor" (the pre-2026-08-27 behavior), not "trim_scale_first"
  // — because trimAvailable = armed > taken = 1 > 1 = false through the real derivation, the guard
  // added 2026-08-27 never engages via the only path that reaches it in production.
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

test("trim_scale DEAD ZONE: an unarmed peak still uses the shared floor untouched (no tranche to bank yet)", () => {
  // Peak +15% in neutral regime arms the EARLY floor (+5%) but no tranche (neutral's
  // first trigger is +20%) — the dead-zone guard must not suppress a legitimate floor
  // exit when there is genuinely nothing to bank. This is the existing test above
  // ("+15% peak with retrace exits on shared early floor before first trim"),
  // reasserted here explicitly as the negative case for the guard.
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", peakPremium: 4.6, currentMark: 4.1, trimsTaken: 0 }) // peak +15%, now +2.5%
  );
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "ratchet_early_profit_floor");
});

test("trim_scale DEAD ZONE per regime — NEUTRAL: ratchet_arm_pnl_pct (breakeven arm) EQUALS the first tranche trigger", () => {
  // The exact numeric collision that made the ordering bug possible for neutral.
  assert.equal(EXIT_RULES.ratchet_arm_pnl_pct, TRIM_SCALE_RULES.tranches_by_regime.neutral[0]);
  // Regression: a peak sitting exactly on that shared threshold, retraced to
  // breakeven, must bank — not dump.
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "neutral", peakPremium: 4.8, currentMark: 4.0, trimsTaken: 0 })
  );
  assert.equal(d.action, "TRIM");
  assert.equal(d.reason, "trim_scale_first");
});

test("trim_scale DEAD ZONE per regime — RANGE: ratchet_early_arm_pnl_pct EQUALS the first tranche trigger", () => {
  // Range's first tranche (+15%) coincides with the ratchet's EARLY arm (+15%/+5%),
  // not the breakeven arm — a different collision than neutral's, same class of bug.
  assert.equal(EXIT_RULES.ratchet_early_arm_pnl_pct, TRIM_SCALE_RULES.tranches_by_regime.range[0]);
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "range", peakPremium: 4.6, currentMark: 4.2, trimsTaken: 0 }) // peak +15%, now +5%
  );
  assert.equal(d.action, "TRIM", "would have exited on ratchet_early_profit_floor pre-fix (5% <= 5% floor)");
  assert.equal(d.reason, "trim_scale_first");
});

test("trim_scale DEAD ZONE per regime — TREND: the breakeven arm sits WELL BELOW the first tranche trigger (widest, unresolved-by-design gap)", () => {
  // Trend's first tranche (+40%) is reached only long after the ratchet's breakeven
  // arm (+20%) — there is NO peak at which a tranche is armed-but-untaken while the
  // peak is still below +40%, so the guard never engages here and a peak in the
  // 20-39% range that retraces still dumps to breakeven exactly like before. This is
  // intentional (trend deliberately runs longer before its first trim — the floor is
  // the only protection available in that window) and NOT part of what this fix
  // resolves; asserted here so the relationship can't silently invert.
  assert.ok(
    EXIT_RULES.ratchet_arm_pnl_pct < TRIM_SCALE_RULES.tranches_by_regime.trend[0],
    "trend's tranche 1 trigger must stay above the breakeven arm, or this residual gap changes shape"
  );
  const d = evaluateExitState(
    input({ exitMode: "trim_scale", regime: "trend", peakPremium: 4.8, currentMark: 4.0, trimsTaken: 0 }) // peak +20%, now 0%
  );
  assert.equal(d.action, "EXIT", "no tranche armed yet at +20% peak in trend — the shared floor is the only guard");
  assert.equal(d.reason, "ratchet_breakeven_floor");
});

// ════════════════════════════════════════════════════════════════════════════════════
// SECOND-WAVE adversarial coverage — categorizeExitReason, the stop>floor collision
// branch, thesis boundaries, trimsTaken clamping, and peak widening.
// ════════════════════════════════════════════════════════════════════════════════════

// ── categorizeExitReason: the whole raw-reason → coarse-family vocabulary ─────────────
test("categorizeExitReason: every persisted reason maps to its coarse family; non-exits/unknown → null", () => {
  assert.equal(categorizeExitReason("thesis_break:flow-quality"), "thesis");
  assert.equal(categorizeExitReason("plan_stop"), "stop");
  assert.equal(categorizeExitReason("flat_theta_bleed"), "flat");
  assert.equal(categorizeExitReason("plan_target_trim"), "target");
  assert.equal(categorizeExitReason("plan_target_final"), "target");
  assert.equal(categorizeExitReason("trim_scale_first"), "target");
  assert.equal(categorizeExitReason("trim_scale_runner_target"), "target");
  assert.equal(categorizeExitReason("ratchet_breakeven_floor"), "ratchet");
  assert.equal(categorizeExitReason("ratchet_early_profit_floor"), "ratchet");
  assert.equal(categorizeExitReason("ratchet_profit_floor"), "ratchet");
  assert.equal(categorizeExitReason("runner_floor"), "ratchet");
  // Non-exit reasons (holds / floor-arm reports / guards) and unknown tokens are NOT a family.
  assert.equal(categorizeExitReason("hold"), null);
  assert.equal(categorizeExitReason("no_live_mark"), null);
  assert.equal(categorizeExitReason("already_closed"), null);
  assert.equal(categorizeExitReason("bogus_token"), null);
  assert.equal(categorizeExitReason(null), null);
  assert.equal(categorizeExitReason(undefined), null);
  assert.equal(categorizeExitReason(""), null);
});

test("categorizeExitReason: a real EXIT decision's reason round-trips to a family", () => {
  const stop = evaluateExitState(input({ exitMode: "ratchet", currentMark: 2.0, peakPremium: 4.2 }));
  assert.equal(categorizeExitReason(stop.reason), "stop");
  const floor = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 5.0, currentMark: 4.0 }));
  assert.equal(categorizeExitReason(floor.reason), "ratchet");
});

// ── protective collision: when the plan stop sits ABOVE the floor mark, plan_stop labels it ──
test("precedence: stop AND floor breached but the STOP mark is the higher protector → plan_stop labels the exit", () => {
  // Breakeven floor armed by a +20% peak → floor mark = entry = 4.0. A plan stop set ABOVE that
  // (4.2) is the higher protective level, so the exit is labeled plan_stop, not the floor.
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: 4.8, currentMark: 4.0, planStop: 4.2 }));
  assert.equal(d.action, "EXIT");
  assert.equal(d.reason, "plan_stop", "the higher protective mark (the stop) labels the exit");
});

// ── detectThesisBreak: veto short-circuit + exact margin + zero-weight filtering ──────
test("detectThesisBreak: a veto is found even amid opposes and short-circuits the cluster math", () => {
  const b = detectThesisBreak(
    evidence([
      { stance: "opposes", source: "gex-walls", weight: 0.1 },
      { stance: "veto", source: "flow-quality", detail: "opposing $1M cluster" },
    ]),
    5.0 // a huge entry margin the opposes could never beat — the veto wins anyway
  );
  assert.ok(b);
  assert.equal(b!.kind, "veto");
  assert.equal(b!.source, "flow-quality");
});

test("detectThesisBreak: combined oppose weight EXACTLY at the margin does NOT break (`<= margin`)", () => {
  // two opposes 0.6 + 0.6 = 1.2 == margin 1.2 → cushion holds.
  const atMargin = detectThesisBreak(
    evidence([{ stance: "opposes", weight: 0.6 }, { stance: "opposes", weight: 0.6 }]),
    1.2
  );
  assert.equal(atMargin, null);
  // a hair over (1.3 > 1.2) breaks.
  const over = detectThesisBreak(
    evidence([{ stance: "opposes", weight: 0.7 }, { stance: "opposes", weight: 0.6 }]),
    1.2
  );
  assert.ok(over);
});

test("detectThesisBreak: zero-weight opposes don't count toward the 2-cluster (weight > 0 required)", () => {
  // one real oppose + one zero-weight → only 1 counts → below the 2-cluster minimum → no break.
  const b = detectThesisBreak(
    evidence([{ stance: "opposes", weight: 2.0 }, { stance: "opposes", weight: 0 }]),
    null
  );
  assert.equal(b, null);
});

test("detectThesisBreak: skipGexWallsVeto ignores gex-walls veto when GEX quality degraded", () => {
  const b = detectThesisBreak(
    evidence([{ stance: "veto", source: "gex-walls", weight: 0.9, detail: "wall broke" }]),
    1,
    { skipGexWallsVeto: true },
  );
  assert.equal(b, null);
});

// ── trim_scale trimsTaken latch clamping ─────────────────────────────────────────────
test("trim_scale: trimsTaken is clamped/floored to 0..2 — an over-count runs the runner, a negative starts fresh", () => {
  // trimsTaken 5 (> 2) → clamped to 2 → the last third RUNS (not another trim).
  const over = evaluateExitState(input({ exitMode: "trim_scale", peakPremium: 8.0, currentMark: 5.6, trimsTaken: 5 }));
  assert.equal(over.action, "RAISE_FLOOR");
  assert.equal(over.reason, "trim_scale_running");
  // trimsTaken −1 → floored to 0 → a +25% peak banks the FIRST third.
  const neg = evaluateExitState(input({ exitMode: "trim_scale", peakPremium: 5.0, currentMark: 5.0, trimsTaken: -1 }));
  assert.equal(neg.action, "TRIM");
  assert.equal(neg.reason, "trim_scale_first");
  // trimsTaken 1.9 → floored to 1 → banks the SECOND third at a +50% peak.
  const frac = evaluateExitState(input({ exitMode: "trim_scale", peakPremium: 6.0, currentMark: 6.0, trimsTaken: 1.9 }));
  assert.equal(frac.reason, "trim_scale_second");
});

// ── ratchetFloorPct: the trim latch dominates even a null peak ────────────────────────
test("ratchetFloorPct: a trimmed runner floors at +50% even when the peak is unknown (latch dominates)", () => {
  assert.equal(ratchetFloorPct(null, true), EXIT_RULES.runner_floor_pct);
});

// ── peak widening: a null peak with a live mark uses the mark as the peak ──────────────
test("peak widening: no latched peak + a live mark derives the peak from the mark (never below it)", () => {
  // No peakPremium but a +60% mark → the derived peak is +60%, which arms the +20% profit floor.
  const d = evaluateExitState(input({ exitMode: "ratchet", peakPremium: null, currentMark: 6.4 })); // +60%
  assert.equal(d.action, "RAISE_FLOOR");
  assert.equal(d.floorPnlPct, 20);
});

// ── buildExitContext: null entry premium → P&L fields are honest nulls ────────────────
test("buildExitContext: a null entry premium yields null pnl/peak fields (never a fabricated number)", () => {
  const decision = evaluateExitState(input({ entryPremium: null }));
  const ctx = buildExitContext(decision, null, 3.9, 5.0, Date.UTC(2026, 6, 14, 15, 0, 0));
  assert.equal(ctx.pnl_pct, null);
  assert.equal(ctx.peak_pnl_pct, null);
  assert.equal(ctx.mark, 3.9);
  // With no entry premium there is no floor to honor: the observed mark is used and flagged as such.
  assert.equal(ctx.mark_observed, 3.9);
  assert.equal(ctx.mark_honored, false);
  assert.equal(ctx.reason, "no_entry_premium");
});

// ── INVARIANT: the plan stop is evaluated STRICTLY BEFORE thesis break, BOTH modes ────
//
// WHY THIS EXISTS (2026-08-06). Two live losers (CELH −46%, TE −27%) both persisted a
// `thesis_break:*` exit reason, which read as "the thesis rule is bypassing the stop".
// It is not: `evaluateExitState` checks the plan stop first in BOTH families — ratchet
// path L480 → protective return at L482, thesis only reachable at L505-506; trim_scale
// path L321 → `plan_stop` at L329, thesis at L346-348. That ordering is what makes a
// persisted `thesis_break` reason STRUCTURAL PROOF that `currentMark > planStop` on the
// tick it fired, i.e. that the loss was INSIDE the stop, not beyond it. That inference is
// the whole basis on which those two rows were cleared, so the ordering it rests on must
// be a tested invariant and not a comment. The thesis rule truncated 19-58pp of loss on 7
// rows in the last 90 days — this test protects it from being "fixed" away, and protects
// the audit reasoning that reads its reason string.

const EXIT_MODES = ["ratchet", "trim_scale"] as const;

for (const mode of EXIT_MODES) {
  test(`stop-before-thesis [${mode}]: at/below the plan stop, a screaming thesis veto still exits 'plan_stop'`, () => {
    const veto = evidence([{ stance: "veto", source: "wall-trend", detail: "opposing wall building" }]);
    // Mark AT the stop and BELOW it: both must label the exit with the protective rule.
    for (const mark of [2.0, 1.2]) {
      const d = evaluateExitState(
        input({ exitMode: mode, currentMark: mark, peakPremium: 4.0, cortexEvidence: veto })
      );
      assert.equal(d.action, "EXIT", `${mode} @ ${mark}`);
      assert.equal(d.reason, "plan_stop", `${mode} @ ${mark} — thesis must NOT preempt the stop`);
    }
  });

  test(`stop-before-thesis [${mode}]: a persisted thesis_break reason PROVES mark > planStop`, () => {
    const veto = evidence([{ stance: "veto", source: "wall-trend", detail: "opposing wall building" }]);
    // Sweep the whole loss range under a permanently-broken thesis. Every tick that comes
    // back `thesis_break:*` must sit STRICTLY ABOVE the stop; every tick at/below it must
    // come back protective. There is no mark at which thesis can outrank the stop.
    let thesisTicks = 0;
    let protectiveTicks = 0;
    for (let mark = 4.0; mark >= 0.4; mark -= 0.1) {
      const m = Math.round(mark * 100) / 100;
      const d = evaluateExitState(
        input({ exitMode: mode, currentMark: m, peakPremium: 4.0, cortexEvidence: veto })
      );
      if (typeof d.reason === "string" && d.reason.startsWith("thesis_break")) {
        thesisTicks += 1;
        assert.ok(m > 2.0, `${mode}: thesis_break at mark ${m} — that is at/below the planStop 2.0`);
      } else {
        protectiveTicks += 1;
        assert.equal(d.action, "EXIT", `${mode} @ ${m}`);
        assert.ok(m <= 2.0, `${mode}: non-thesis protective exit at mark ${m} above the stop`);
      }
    }
    // Non-vacuity: the sweep must actually have exercised BOTH branches, or the
    // invariant above would pass on an engine that never reaches either rule.
    assert.ok(thesisTicks > 0, `${mode}: sweep never produced a thesis_break — test is vacuous`);
    assert.ok(protectiveTicks > 0, `${mode}: sweep never produced a protective exit — test is vacuous`);
  });

  test(`stop-before-thesis [${mode}]: with NO plan stop the thesis rule still owns the losing tail`, () => {
    // The ordering must not be an accident of the stop always being present — with
    // planStop null the thesis break is exactly what caps the loss.
    const veto = evidence([{ stance: "veto", source: "wall-trend", detail: "opposing wall building" }]);
    const d = evaluateExitState(
      input({ exitMode: mode, planStop: null, currentMark: 1.2, peakPremium: 4.0, cortexEvidence: veto })
    );
    assert.equal(d.action, "EXIT");
    assert.match(String(d.reason), /^thesis_break:/);
  });
}
