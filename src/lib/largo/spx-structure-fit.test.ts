import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitSpxStructureForModel,
  SPX_STRUCTURE_LIST_CAPS,
  SPX_STRUCTURE_SHED_ORDER,
} from "./spx-structure-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "./fit-tool-result";

const rows = (n: number, chars = 120) =>
  Array.from({ length: n }, (_, i) => ({ i, blob: "x".repeat(chars) }));

/** A desk summary shaped like the real one: scalars first, fat lists after. */
function oversizedSummary() {
  return {
    as_of: "2026-08-23T12:00:00.000Z",
    market_open: false,
    price: 7674.37,
    vix: 14.2,
    gamma_flip: 7640,
    gex_net: 1.2e9,
    max_pain: 7700,
    gex_walls: rows(40),
    spx_flows: rows(120),
    unified_tape: rows(200),
    news_headlines: rows(30),
    macro_events: rows(20),
    sector_heat: rows(20),
    leader_stocks: rows(20),
    oi_changes: rows(30),
    net_prem_ticks: rows(300, 40),
    strike_stacks: rows(25),
  } as Record<string, unknown>;
}

const size = (o: unknown) => JSON.stringify(o).length;

test("the fixture really is over budget — otherwise every assertion below is vacuous", () => {
  // The trap this avoids: a fixture that quietly shrinks below the cap turns the whole suite into
  // a test that fitting a small object leaves it small.
  assert.ok(
    size(oversizedSummary()) > LARGO_RESULT_CHAR_BUDGET,
    `fixture is ${size(oversizedSummary())} chars, at or under the ${LARGO_RESULT_CHAR_BUDGET} budget`
  );
});

test("fits under the budget", () => {
  const { fitted, chars } = fitSpxStructureForModel(oversizedSummary());
  assert.ok(chars <= LARGO_RESULT_CHAR_BUDGET, `${chars} chars, over budget`);
  assert.equal(chars, size(fitted));
});

test("every scalar survives untouched — the desk's core numbers are the answer", () => {
  const { fitted } = fitSpxStructureForModel(oversizedSummary());
  assert.equal(fitted.price, 7674.37);
  assert.equal(fitted.vix, 14.2);
  assert.equal(fitted.gamma_flip, 7640);
  assert.equal(fitted.gex_net, 1.2e9);
  assert.equal(fitted.max_pain, 7700);
  assert.equal(fitted.market_open, false);
  assert.equal(fitted.as_of, "2026-08-23T12:00:00.000Z");
});

test("every shortened list names itself — a sample must never read as the universe", () => {
  const { fitted, trimmed } = fitSpxStructureForModel(oversizedSummary());
  assert.ok(trimmed.length > 0);
  const notes = fitted.sample_notes as Record<string, string>;
  assert.ok(notes, "sample_notes must be present when anything was trimmed");
  for (const key of trimmed) {
    assert.ok(notes[key], `${key} was trimmed with no note`);
    assert.match(notes[key], /SAMPLE|omitted to fit/);
  }
});

test("a note states the ORIGINAL length, not just the kept count", () => {
  // Without the total, "12 rows" is indistinguishable from "there were 12".
  const { fitted } = fitSpxStructureForModel(oversizedSummary());
  const notes = fitted.sample_notes as Record<string, string>;
  assert.match(notes.spx_flows ?? "", /of 120/);
  assert.match(notes.unified_tape ?? "", /of 200/);
});

test("caps are applied exactly as declared", () => {
  const { fitted } = fitSpxStructureForModel(oversizedSummary());
  for (const { key, cap } of SPX_STRUCTURE_LIST_CAPS) {
    const v = fitted[key];
    if (v === undefined) continue; // shed by the backstop, covered by its own test
    assert.ok(Array.isArray(v), `${key} should still be an array`);
    assert.ok((v as unknown[]).length <= cap, `${key} kept ${(v as unknown[]).length}, cap ${cap}`);
  }
});

test("a shed field becomes a NOTE, never a silent deletion", () => {
  // Force the backstop with lists that are already inside their caps but individually enormous.
  const huge = {
    price: 7674,
    gex_walls: rows(5, 4000),
    unified_tape: rows(5, 4000),
    net_prem_ticks: rows(5, 4000),
    oi_changes: rows(5, 4000),
  } as Record<string, unknown>;
  assert.ok(size(huge) > LARGO_RESULT_CHAR_BUDGET, "backstop fixture must start over budget");
  const { fitted, chars } = fitSpxStructureForModel(huge);
  assert.ok(chars <= LARGO_RESULT_CHAR_BUDGET, `${chars} chars, over budget`);
  const notes = fitted.sample_notes as Record<string, string>;
  const shed = SPX_STRUCTURE_SHED_ORDER.filter((k) => k in huge && fitted[k] === undefined);
  assert.ok(shed.length > 0, "the backstop should have shed something");
  for (const k of shed) {
    assert.match(notes[k] ?? "", /NOT absent from the desk/);
  }
  assert.equal(fitted.price, 7674, "the backstop must not eat scalars");
});

test("an already-small payload comes back byte-identical, with no sample_notes", () => {
  // An empty notes object is itself a claim, and it costs bytes on every call to make it.
  const small = { price: 7674, vix: 14, gex_walls: rows(3), spx_flows: rows(2) };
  const { fitted, trimmed } = fitSpxStructureForModel(small as Record<string, unknown>);
  assert.deepEqual(fitted, small);
  assert.equal(trimmed.length, 0);
  assert.equal("sample_notes" in fitted, false);
});

test("a non-array field with a capped key's name is left alone", () => {
  // Defensive: the payload's shape is `unknown` for most of these fields, so a future change that
  // makes one an object must not have it silently sliced into nothing.
  const odd = { price: 1, unified_tape: { rows: 5 }, gex_walls: null };
  const { fitted, trimmed } = fitSpxStructureForModel(odd as Record<string, unknown>);
  assert.deepEqual(fitted.unified_tape, { rows: 5 });
  assert.equal(fitted.gex_walls, null);
  assert.equal(trimmed.length, 0);
});

test("null and non-object inputs pass straight through", () => {
  assert.equal(fitSpxStructureForModel(null as never).fitted, null);
  assert.equal(fitSpxStructureForModel(undefined as never).fitted, undefined);
});

test("a single enormous PROTECTED list is bounded rather than allowed to overflow", () => {
  // `gex_walls` is deliberately absent from the shed order — it is the point of half the questions
  // this tool serves. Before the hard-bound pass existed, that protection meant a 20KB `gex_walls`
  // left the whole payload over budget and the TRANSPORT took an unnamed slice: the exact defect
  // this module exists to prevent, arriving after two passes that looked like they had handled it.
  // Found by a test, not in production.
  const one = { price: 7674, gex_walls: rows(400, 200) } as Record<string, unknown>;
  assert.ok(size(one) > LARGO_RESULT_CHAR_BUDGET, "fixture must start over budget");
  const { fitted, chars } = fitSpxStructureForModel(one);
  assert.ok(chars <= LARGO_RESULT_CHAR_BUDGET, `${chars} chars, over budget`);
  assert.ok(Array.isArray(fitted.gex_walls) && (fitted.gex_walls as unknown[]).length > 0,
    "bounded, not shed — a protected list keeps a sample");
  assert.equal(fitted.price, 7674);
  const note = (fitted.sample_notes as Record<string, string>).gex_walls ?? "";
  assert.match(note, /of 400/, "the note must still state the ORIGINAL length after a hard cut");
});

test("the hard bound terminates instead of looping on an unfittable base", () => {
  // A base object that cannot fit even with every array emptied must return, not spin.
  const impossible = { blob: "x".repeat(LARGO_RESULT_CHAR_BUDGET * 2), rowsList: rows(10) };
  const { fitted, chars } = fitSpxStructureForModel(impossible as Record<string, unknown>);
  assert.ok(chars > LARGO_RESULT_CHAR_BUDGET, "an unfittable scalar base cannot be fixed by trimming lists");
  assert.equal(typeof fitted.blob, "string", "and the scalar is never destroyed to chase the budget");
});
