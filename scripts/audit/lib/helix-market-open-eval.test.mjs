import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateChecks, rollup } from "./helix-market-open-eval.mjs";

// The live shape, 2026-08-23 — every number here was measured against production today.
const liveTape = (over = {}) => ({
  response: { rows: 5000 },
  field_presence_pct: {
    event_at: { all: 100, A: 100, B: 100 },
    alert_rule: { all: 30, A: 100, B: 0 },
    ask_pct: { all: 29.1, A: 96.9, B: 0 },
  },
  signal_eligibility: { total: 5000, eligible: 5000, ineligible: 0, ineligibleTickers: [] },
  writers: { A: { rows: 1500 }, B: { rows: 3500 }, mixed: 0, unknown: 0, B_premium_share_pct: 92.1 },
  iv_units: { verdict: "fractional", median: 0.17, shipped_renderer_ok: true },
  ...over,
});
const liveDarkpool = (over = {}) => ({
  returned: 20,
  coverage: { status: "NO_DIRECTION_REPORTED", sidedPrints: 0, totalPrints: 20, sidedPremiumPct: 0 },
  ...over,
});
const find = (rows, id) => rows.find((r) => r.id === id);
const run = (o = {}) =>
  evaluateChecks({ tape: liveTape(), darkpool: liveDarkpool(), expiryMinus1: "0DTE", ...o });

test("today's production state passes every binary claim", () => {
  const rows = run();
  for (const id of ["§9.5", "§5k", "§9.0", "§4A", "§5c", "§9.4"]) {
    assert.equal(find(rows, id).verdict, "GREEN", `${id} should be GREEN on the live shape`);
  }
  // §5l is AMBER by design — 0% sided is the CORRECT off-hours state, not a pass and not a fault.
  assert.equal(find(rows, "§5l").verdict, "AMBER");
  assert.equal(rollup(rows), "AMBER");
});

test("§5k GOES RED if event_at and alert_rule co-vary again — the pre-#2723 signature", () => {
  // The single highest-impact claim. If this cannot fail, the gate is decoration.
  const rows = run({ tape: liveTape({ field_presence_pct: {
    event_at: { all: 30 }, alert_rule: { all: 30 }, ask_pct: { A: 96.9, B: 0 },
  } }) });
  const r = find(rows, "§5k");
  assert.equal(r.verdict, "RED");
  assert.match(r.note, /deploy may not carry #2723|wire format moved/);
});

test("§5k TOLERATES a live tape that is not exactly 100% — the false alarm it must not raise", () => {
  // Off-hours the tape is settled and reads exactly 100%. Under a MOVING tape one print whose time
  // cannot be resolved drops it to 99.8%. Demanding equality would fire RED on the highest-impact
  // row of a WORKING deploy — the exact false-alarm shape this gate exists to prevent.
  const rows = run({ tape: liveTape({ field_presence_pct: {
    event_at: { all: 99.8 }, alert_rule: { all: 30 }, ask_pct: { A: 96.9, B: 0 },
  } }) });
  const r = find(rows, "§5k");
  assert.equal(r.verdict, "GREEN");
  assert.match(r.note, /within tolerance, not a fault/);
});

test("§5k still goes RED once event_at coverage genuinely collapses", () => {
  // The floor has to bite somewhere, or the tolerance above swallows a real regression.
  for (const ev of [94, 60, 31]) {
    const rows = run({ tape: liveTape({ field_presence_pct: {
      event_at: { all: ev }, alert_rule: { all: 30 }, ask_pct: { A: 96.9, B: 0 },
    } }) });
    assert.equal(find(rows, "§5k").verdict, "RED", `event_at ${ev}% must be RED`);
  }
});

test("§5k goes RED on a NARROW margin even when event_at is high", () => {
  // Both fields drifting up together is still re-coupling. The margin carries the meaning, not the
  // absolute level — this is the case a floor-only check would miss.
  const rows = run({ tape: liveTape({ field_presence_pct: {
    event_at: { all: 99 }, alert_rule: { all: 90 }, ask_pct: { A: 96.9, B: 0 },
  } }) });
  const r = find(rows, "§5k");
  assert.equal(r.verdict, "RED");
  assert.match(r.note, /re-coupled/);
});

test("§9.0 goes RED when prints cannot be placed in time, and NAMES them", () => {
  const rows = run({ tape: liveTape({
    signal_eligibility: { total: 5000, eligible: 1500, ineligible: 3500, ineligibleTickers: ["SPX", "SPY"] },
  }) });
  const r = find(rows, "§9.0");
  assert.equal(r.verdict, "RED");
  assert.match(r.note, /SPX, SPY/);
});

test("§4A goes RED the first time a row breaks the clean writer split", () => {
  // The inventory's own rule: a row carrying both markers or neither IS the finding.
  const rows = run({ tape: liveTape({ writers: { A: { rows: 1499 }, B: { rows: 3500 }, mixed: 1, unknown: 0 } }) });
  assert.equal(find(rows, "§4A").verdict, "RED");
});

test("§5c goes RED on GROUP A coverage, and never on Group B being zero", () => {
  // Group B at 0% is expected — that feed sends no aggressor side. Gating on it would fire every
  // single run, which is exactly the inverted criterion this gate exists to prevent.
  assert.equal(find(run(), "§5c").verdict, "GREEN");
  const rows = run({ tape: liveTape({ field_presence_pct: {
    event_at: { all: 100 }, alert_rule: { all: 30 }, ask_pct: { A: 40, B: 0 },
  } }) });
  assert.equal(find(rows, "§5c").verdict, "RED");
});

test("§9.4 goes RED if the feed stops being fractional, and AMBER below the sample floor", () => {
  assert.equal(find(run({ tape: liveTape({ iv_units: { verdict: "percent", shipped_renderer_ok: false } }) }), "§9.4").verdict, "RED");
  assert.equal(find(run({ tape: liveTape({ iv_units: { verdict: null } }) }), "§9.4").verdict, "AMBER");
});

test("§9.5 goes RED if an expired print is filed under a future horizon", () => {
  assert.equal(find(run({ expiryMinus1: "This week" }), "§9.5").verdict, "RED");
});

test("a harness that could not run is HARNESS, never RED", () => {
  // Rule 2. A missing sub-report says nothing about the product.
  const rows = evaluateChecks({ tape: null, darkpool: null, expiryMinus1: "0DTE" });
  for (const id of ["§5k", "§9.0", "§4A", "§5c", "§9.4", "§5l"]) {
    assert.equal(find(rows, id).verdict, "HARNESS", id);
  }
  // ...and the pure check still runs, because it needs no live data.
  assert.equal(find(rows, "§9.5").verdict, "GREEN");
  assert.equal(rollup(rows), "HARNESS");
});

test("an empty population is HARNESS, not a clean sweep", () => {
  // Rule 4. Zero rows measured nothing; reporting GREEN would assert coverage nobody has.
  const rows = run({ tape: liveTape({ response: { rows: 0 } }) });
  assert.equal(find(rows, "§5k").verdict, "HARNESS");
  assert.match(find(rows, "§5k").note, /nothing was measured/);
  assert.equal(find(run({ darkpool: { returned: 0 } }), "§5l").verdict, "HARNESS");
});

test("rollup never lets HARNESS hide behind AMBER, or RED behind anything", () => {
  const r = (verdict) => ({ verdict });
  assert.equal(rollup([r("GREEN"), r("AMBER"), r("HARNESS")]), "HARNESS");
  assert.equal(rollup([r("GREEN"), r("AMBER"), r("HARNESS"), r("RED")]), "RED");
  assert.equal(rollup([r("GREEN"), r("GREEN")]), "GREEN");
  assert.equal(rollup([]), "HARNESS", "no checks is not a pass");
});

test("every row states its expectation — the thing that let §5k read backwards", () => {
  for (const row of run()) {
    assert.ok(row.expect && row.expect.length > 3, `${row.id} must state what it expects`);
    assert.ok(row.measured != null, `${row.id} must state what it measured`);
  }
});
