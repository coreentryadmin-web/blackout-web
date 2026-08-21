import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportVectorAbsences, type VectorAbsenceInput } from "./vector-absent-sections";

/**
 * ABSENCE LABELLING for the Vector full state.
 *
 * THE DEFECT THIS PINS. `computeVectorFullState` fails open per field — every read resolves to
 * `null` rather than throwing. That is correct for the chart (an overlay that cannot be read is
 * simply not drawn, and the member sees an absence and reads it as one) and wrong at a tool
 * boundary, where a model turns `expectedMove: null` into "NVDA has no expected move".
 *
 * The reads cannot tell the two apart either: `vector-expected-move-server.ts` returns `null` from
 * `if (!contracts.length)` (genuinely nothing) AND from `catch { return null }` (an upstream we
 * could not reach). So this module deliberately does NOT claim to distinguish them — it names the
 * absences, and attaches the one reason that IS cheaply knowable (the bead rail's RTH gate).
 *
 * `get_vector_analytics` already had `unavailable_sections` for exactly this reason;
 * `get_vector_full_state` never did.
 */

const FULL: VectorAbsenceInput = {
  gexWalls: { callWalls: [], putWalls: [] },
  gammaFlip: 7520,
  maxPain: 7550,
  expectedMove: { movePct: 0.004 },
  ladder: { rows: [] },
  heatmap: { available: true },
  technicals: { vwap: 1 },
  flowMarkers: { prints: [] },
  vexWalls: { callWalls: [], putWalls: [] },
  darkPoolLevels: [{ strike: 1 }],
  wallHistory: [{ t: 1 }],
  play: { grade: "B" },
  isRth: true,
};

test("a complete read names nothing and carries no disclaimer", () => {
  const r = reportVectorAbsences(FULL);
  assert.deepEqual(r.unavailable_sections, []);
  assert.equal(r.wall_history_empty_reason, null);
  // The note exists to caveat absences; with none, it must not appear at all.
  assert.equal(r.absence_note, null);
});

test("every absent section is named", () => {
  const empty: VectorAbsenceInput = {
    gexWalls: null, gammaFlip: null, maxPain: null, expectedMove: null, ladder: null,
    heatmap: null, technicals: null, flowMarkers: null, vexWalls: null,
    darkPoolLevels: [], wallHistory: [], play: null, isRth: true,
  };
  const r = reportVectorAbsences(empty);
  assert.deepEqual(r.unavailable_sections, [
    "gex_walls", "gamma_flip", "max_pain", "expected_move", "ladder", "heatmap",
    "technicals", "flow_markers", "vex_walls", "dark_pool_levels", "wall_history", "play",
  ]);
});

test("one absent section is named without dragging the others in", () => {
  const r = reportVectorAbsences({ ...FULL, expectedMove: null });
  assert.deepEqual(r.unavailable_sections, ["expected_move"]);
  assert.ok(r.absence_note, "an absence must always carry the not-emptiness caveat");
});

test("the disclaimer refuses to claim the distinction it cannot make", () => {
  const r = reportVectorAbsences({ ...FULL, gexWalls: null });
  // The whole point: naming an absence must not license asserting non-existence.
  assert.match(r.absence_note!, /NOT evidence the underlying data does not exist/);
  assert.match(r.absence_note!, /indistinguishable/);
});

test("an empty bead rail outside RTH is labelled expected, not missing", () => {
  const r = reportVectorAbsences({ ...FULL, wallHistory: [], isRth: false });
  assert.equal(r.wall_history_empty_reason, "outside_rth_no_recording_yet");
  // Reporting this as missing data already sent one investigation down the wrong path
  // (VECTOR-BEAD-CADENCE-INVESTIGATION-2026-08-19: 0 samples at 00:53 ET, "expected pre-RTH").
  assert.ok(r.unavailable_sections.includes("wall_history"));
});

test("an empty bead rail DURING RTH is a genuine gap", () => {
  const r = reportVectorAbsences({ ...FULL, wallHistory: [], isRth: true });
  assert.equal(r.wall_history_empty_reason, "no_samples_during_rth");
});

test("a populated rail has no empty-reason in either session phase", () => {
  for (const isRth of [true, false]) {
    assert.equal(reportVectorAbsences({ ...FULL, isRth }).wall_history_empty_reason, null);
  }
});

test("the RTH question is asked of the snapshot's own asOf, not of 'now'", () => {
  // A pre-open snapshot read after the bell must still say "not recorded yet" — the reason
  // explains why THAT measurement has no rail, so it has to be evaluated at measurement time.
  const src = readFileSync("src/lib/bie/vector-full-state.ts", "utf8");
  assert.match(src, /isEtCashRth\(Number\.isFinite\(observedAt\) \? new Date\(observedAt\) : new Date\(\)\)/);
});

test("the absence report is attached on READ, so old cache entries still get one", () => {
  const src = readFileSync("src/lib/bie/vector-full-state.ts", "utf8");
  // Both the cache-hit and the live-compute path must go through the wrapper, or a cached read
  // silently loses the labelling that the live path has.
  assert.match(src, /if \(cached\) return withAbsenceReport\(cached\);/);
  assert.match(src, /return live \? withAbsenceReport\(live\) : null;/);
});

test("the tool description teaches that absence is not emptiness", () => {
  const src = readFileSync("src/lib/largo/tool-defs.ts", "utf8");
  assert.match(src, /ABSENCE IS NOT EMPTINESS/);
  assert.match(src, /does NOT establish that the ticker has no such level/);
  assert.match(src, /outside_rth_no_recording_yet/);
  assert.match(src, /must never be reported as missing data/);
});
