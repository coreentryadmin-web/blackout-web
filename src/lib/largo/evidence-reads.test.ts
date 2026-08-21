import test, { mock } from "node:test";
import assert from "node:assert/strict";

// `evidence-reads` pulls `server-only`, which throws outside a Server Component. Stubbing it is
// what makes the UNAVAILABLE branches reachable from a unit test at all — and those are the
// branches that were fabricating zeros.
mock.module("server-only", { namedExports: {} });

// Deterministic UNAVAILABLE. Without this the tests below depend on whether a DATABASE_URL happens
// to resolve in the runner — which both makes them environment-dependent and, when it points at an
// unreachable host, spends ten seconds per test waiting for a connection timeout.
mock.module("../db", {
  namedExports: {
    dbConfigured: () => false,
    fetchZeroDteSetupLogRange: async () => {
      throw new Error("db unreachable");
    },
    fetchNighthawkPublishGateRejections: async () => {
      throw new Error("db unreachable");
    },
  },
});
import { readFileSync } from "node:fs";
import { compareGraderLanes } from "./evidence-eval";
import { LARGO_TOOL_DEFS } from "./tool-defs";
import { LARGO_CAPABILITIES } from "./registry/capability-registry";

/**
 * THE SERVING PATH for the two evidence cards.
 *
 * Both measurements existed and neither could reach a member. The counterfactual is the starker
 * case: the nightly cron has been grading gate-blocked plays and persisting the verdicts for
 * weeks, and `gateBlockedValue` — the aggregator over those rows — had one caller, inside an
 * admin-only report. Sixth instance of the same class.
 */

test("both evidence tools are declared, implemented AND catalogued", () => {
  // The three places a capability has to exist to be reachable. Missing any one of them is the
  // bug class this whole campaign has been closing.
  const defs = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  const runTool = readFileSync("src/lib/largo/run-tool.ts", "utf8");
  for (const tool of ["get_gate_blocked_value", "get_grader_agreement"]) {
    assert.ok(defs.has(tool), `${tool} missing from tool-defs`);
    assert.ok(runTool.includes(`case "${tool}"`), `${tool} has no case in run-tool.ts`);
    assert.ok(
      LARGO_CAPABILITIES.some((c) => c.tool === tool),
      `${tool} missing from the capability registry`,
    );
  }
});

test("the reads never reimplement the real aggregator or the real grader", () => {
  // A parallel implementation drifts the moment a threshold moves, and Largo would then publish a
  // number that disagrees with the desk's own report while both were individually "correct".
  const src = readFileSync("src/lib/largo/evidence-reads.ts", "utf8") + readFileSync("src/lib/largo/evidence-eval.ts", "utf8");
  assert.ok(src.includes("gateBlockedValue"), "must call the real gate aggregator");
  assert.ok(src.includes("gateCodesFromSnapshot"), "must use the real gate-code parser");
  assert.ok(src.includes("isZeroDteWin"), "must call the real official-lane predicate");
  assert.ok(src.includes("fetchZeroDteSetupLogRange"), "must read the same ledger the record is built from");
});

// ── Grader lane comparison ──────────────────────────────────────────────────────────────────

const row = (over: Record<string, unknown> = {}) => ({
  ticker: "MU",
  plan_outcome: "stopped",
  plan_pnl_pct: -50,
  entry_context: null,
  session_date: "2026-07-29",
  ...over,
});

/** A WS-10 executable stamp — what makes a row comparable on the official lane. */
const executable = (pnl: number, outcome: string) => ({ executable: { plan_pnl_pct: pnl, plan_outcome: outcome } });

test("a row with no executable stamp agrees with itself — both lanes read the mid column", () => {
  const r = compareGraderLanes([row(), row({ plan_pnl_pct: 80, plan_outcome: "doubled" })]);
  assert.equal(r.comparable, 2);
  assert.equal(r.agreed, 2);
  assert.deepEqual(r.disagreements, []);
  assert.equal(r.agreement_pct, 100);
});

test("a partially-banked row is a REAL disagreement and is reported with both verdicts", () => {
  // The WS-11 case the audit script found: mid says stopped −50%, the official lane banked a
  // partial and came out positive. Not a defect — the official lane is what the member was guided
  // to — but it must be visible.
  const r = compareGraderLanes([row({ entry_context: executable(18.4, "trim_scale") })]);
  assert.equal(r.comparable, 1);
  assert.equal(r.agreed, 0);
  assert.equal(r.disagreements.length, 1);
  assert.equal(r.disagreements[0]!.ticker, "MU");
  assert.match(r.disagreements[0]!.mid, /stopped/);
  assert.match(r.disagreements[0]!.mid, /−50\.0%/, "the mid side must carry a true minus sign");
  assert.match(r.disagreements[0]!.official, /trim_scale/);
  assert.match(r.disagreements[0]!.official, /\+18\.4%/);
});

test("a row that cannot be graded on BOTH lanes is not counted as agreement", () => {
  // Counting an uncomparable row as agreement is exactly how this rate gets inflated: the
  // denominator grows with rows that were never actually compared.
  const r = compareGraderLanes([row({ plan_pnl_pct: null }), row()]);
  assert.equal(r.total_plays, 2, "the window still reports every row");
  assert.equal(r.comparable, 1, "only the row gradeable on both lanes is comparable");
  assert.equal(r.agreed, 1);
});

test("the agreement rate is against comparable, never against the window", () => {
  const rows = [
    ...Array.from({ length: 8 }, () => row()),
    row({ entry_context: executable(12, "trim_scale") }),
    ...Array.from({ length: 5 }, () => row({ plan_pnl_pct: null })),
  ];
  const r = compareGraderLanes(rows);
  assert.equal(r.total_plays, 14);
  assert.equal(r.comparable, 9);
  assert.equal(r.agreed, 8);
  // 8/9, NOT 8/14 — the second would read as 57% and describe nothing.
  assert.equal(r.agreement_pct, 88.9);
});

test("every disagreement produces a row — the card asserts completeness and must be able to", () => {
  // The template prints "N disagreements — every one of them"; the router refuses to render when
  // rows are fewer than the implied count. That contract starts here.
  const rows = [
    row({ ticker: "MU", entry_context: executable(18.4, "trim_scale") }),
    row({ ticker: "SPXW", entry_context: executable(12.1, "trim_scale") }),
    row({ ticker: "META", entry_context: executable(7.7, "trim_scale") }),
    row(),
  ];
  const r = compareGraderLanes(rows);
  assert.equal(r.comparable - r.agreed, r.disagreements.length);
});

test("zero comparable rows yields a null rate, never a fabricated 100%", () => {
  const r = compareGraderLanes([row({ plan_pnl_pct: null })]);
  assert.equal(r.comparable, 0);
  assert.equal(r.agreement_pct, null, "no comparison made means no rate, not a perfect score");
});

/**
 * A COUNT IS A MEASUREMENT. Both evidence tools used to fill every count with 0 on a failed read,
 * while `agreement_pct` in the very same object was correctly `null`. The rate knew it had not
 * been measured; the counts did not.
 *
 * These run without a database, which is the point — the unavailable branches are the ones that
 * were lying, and they are reachable here exactly because there is nothing to read.
 */
test("a failed grader-agreement read reports NO counts, not zero ones", async () => {
  const { graderAgreementForLargo } = await import("./evidence-reads");
  const r = await graderAgreementForLargo(90);
  assert.equal(r.available, false, "the db is mocked unavailable — this branch must be the one under test");
  assert.equal(r.total_plays, null, "0 plays would claim a window was looked at");
  assert.equal(r.comparable, null);
  assert.equal(r.agreed, null);
  assert.equal(r.agreement_pct, null);
  assert.equal("disagreements" in r, false, "an empty list invites '0 disagreements'");
  assert.match(String(r.note), /is a measurement|database_unavailable/);
});

test("a failed gate-value read reports NO totals — 'the gate blocked nothing' is the worst possible lie here", async () => {
  const { gateBlockedValueForLargo } = await import("./evidence-reads");
  const r = await gateBlockedValueForLargo(30);
  assert.equal(r.available, false, "the db is mocked unavailable — this branch must be the one under test");
  assert.equal(r.blocked_total, null, "the gate's whole value proposition is this count");
  assert.equal(r.graded_total, null);
  assert.equal(r.would_have_won_total, null);
  assert.equal(r.would_have_lost_total, null);
  assert.equal(r.unfilled_total, null);
  assert.equal("by_gate" in r, false);
  assert.match(String(r.note), /is a measurement/);
});

test("the window is still stated when nothing could be read — an unknown is still about something", async () => {
  const { gateBlockedValueForLargo, graderAgreementForLargo } = await import("./evidence-reads");
  assert.equal((await gateBlockedValueForLargo(45)).window_days, 45);
  assert.equal((await graderAgreementForLargo(45)).window_days, 45);
});

test("compareGraderLanes still yields real zeros for a genuinely empty comparison", () => {
  // The measured case must keep its numbers — this is the half that is NOT an unknown, and
  // nulling it would trade one lie for another.
  const cmp = compareGraderLanes([]);
  assert.equal(cmp.total_plays, 0, "a measured window of no rows really is 0 plays");
  assert.equal(cmp.comparable, 0);
  assert.equal(cmp.agreement_pct, null, "but the RATE over 0 comparable rows is unknowable");
});
