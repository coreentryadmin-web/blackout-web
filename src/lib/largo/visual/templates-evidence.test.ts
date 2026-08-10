import test from "node:test";
import assert from "node:assert/strict";
import { routeVisual, IMPLEMENTED_TEMPLATES } from "./router";
import { balancedRows } from "./templates/counterfactual";
import type { VisualBundle } from "./types";

/**
 * THE TWO EVIDENCE CARDS — COUNTERFACTUAL and GRADER_AGREEMENT.
 *
 * Both make claims that are only credible because of what they are willing to show against
 * themselves: trades the guard cost us, and outcomes two graders read differently. Every test here
 * is about keeping that property when the data gets awkward, because the failure mode is not a
 * crash — it is a card that quietly becomes a highlight reel.
 */

const base: VisualBundle = { systemsQueried: ["NIGHT HAWK"], asOf: "2026-08-10T20:05:00Z" };

// ── COUNTERFACTUAL ──────────────────────────────────────────────────────────────────────────

const cf = (over: Partial<NonNullable<VisualBundle["counterfactual"]>> = {}): VisualBundle => ({
  ...base,
  counterfactual: {
    source: "NIGHT HAWK",
    sessionLabel: "Fri 8 Aug",
    guardLabel: "Phase-0 fail-closed firewall",
    heldCount: 5,
    gradedCount: 5,
    losersAvoided: { count: 3, pnlValue: 118.4, pnlDisplay: "+118.4%" },
    winnersForgone: { count: 2, pnlValue: -63.5, pnlDisplay: "−63.5%" },
    netValue: 54.9,
    netDisplay: "+54.9%",
    rows: [
      { ticker: "MU", gate: "G-4 vix_unavailable", outcomeValue: -50, outcomeDisplay: "−50.0%", verdict: "avoided" },
      { ticker: "SPXW", gate: "cortex veto_blind", outcomeValue: -50, outcomeDisplay: "−50.0%", verdict: "avoided" },
      { ticker: "COIN", gate: "far-OTM cap", outcomeValue: -18.4, outcomeDisplay: "−18.4%", verdict: "avoided" },
      { ticker: "OKLO", gate: "earnings-all-ranks", outcomeValue: 41.2, outcomeDisplay: "+41.2%", verdict: "forgone" },
      { ticker: "AMD", gate: "G-7 macro_unavailable", outcomeValue: 22.3, outcomeDisplay: "+22.3%", verdict: "forgone" },
    ],
    ...over,
  },
});

test("nothing graded means nothing was measured", () => {
  assert.notEqual(routeVisual("what did the firewall hold", cf({ gradedCount: 0 }))?.template, "COUNTERFACTUAL");
  assert.equal(routeVisual("what did the firewall hold", cf())!.template, "COUNTERFACTUAL");
});

test("more graded than held is an inconsistent counterfactual", () => {
  assert.notEqual(routeVisual("firewall", cf({ gradedCount: 9, heldCount: 5 }))?.template, "COUNTERFACTUAL");
});

test("COUNTERFACTUAL outranks REJECTION — the graded holds are the stronger claim", () => {
  // Both match "held". REJECTION would otherwise win on registry order and drop the grading, which
  // is the entire reason the card exists.
  const both: VisualBundle = {
    ...cf(),
    rejections: {
      total: 5,
      windowLabel: "session",
      rows: [
        { ticker: "MU", gateFailed: "G-4" },
        { ticker: "OKLO", gateFailed: "earnings" },
      ],
    },
  };
  assert.equal(routeVisual("what did the gates hold", both)!.template, "COUNTERFACTUAL");
  const ids = IMPLEMENTED_TEMPLATES.map((t) => t.id);
  assert.ok(ids.indexOf("COUNTERFACTUAL") < ids.indexOf("REJECTION"), "order is the mechanism, not luck");
});

test("truncation never empties one side of the ledger", () => {
  // The bug this exists for: rows arrive avoided-first, so a plain slice(0, 2) would show two
  // losers-avoided and zero winners-forgone — a card headed "the guard paid" listing only wins
  // for the guard.
  const rows = cf().counterfactual!.rows;
  for (const limit of [2, 3, 4, 5, 6]) {
    const shown = balancedRows(rows, limit);
    assert.ok(shown.length <= limit, `limit ${limit} exceeded`);
    assert.ok(
      shown.some((r) => r.verdict === "avoided") && shown.some((r) => r.verdict === "forgone"),
      `limit ${limit} dropped a whole side`,
    );
  }
});

test("a side with nothing to show donates its budget rather than wasting it", () => {
  const onlyAvoided = cf().counterfactual!.rows.filter((r) => r.verdict === "avoided");
  assert.equal(balancedRows(onlyAvoided, 4).length, 3, "all three avoided rows should show");
  assert.equal(balancedRows([], 4).length, 0);
});

// ── GRADER_AGREEMENT ────────────────────────────────────────────────────────────────────────

const ga = (over: Partial<NonNullable<VisualBundle["graderAgreement"]>> = {}): VisualBundle => ({
  ...base,
  graderAgreement: {
    source: "NIGHT HAWK",
    windowLabel: "90 days to 5 Aug",
    populationLabel: "executable-graded rows with evidence on both sides",
    totalPlays: 141,
    comparable: 130,
    agreed: 126,
    agreementDisplay: "96.9%",
    graderALabel: "feature-store · raw mid",
    graderBLabel: "record · executable lane",
    rows: [
      { ticker: "MU", dateLabel: "29 Jul", a: "stopped −50%", b: "WIN (partial banked)" },
      { ticker: "SPXW", dateLabel: "31 Jul", a: "stopped −50%", b: "WIN (partial banked)" },
      { ticker: "META", dateLabel: "3 Aug", a: "stopped −50%", b: "WIN (partial banked)" },
      { ticker: "OKLO", dateLabel: "30 Jul", a: "time_stop win", b: "small loss" },
    ],
    ...over,
  },
});

test("every disagreement must have a row — a claimed exception with nothing to show is refused", () => {
  // 130 − 120 = 10 disagreements but only 4 rows. The card would print "10 disagreements — every
  // one of them" above four, asserting a completeness it does not have.
  assert.notEqual(routeVisual("do the graders agree", ga({ agreed: 120 }))?.template, "GRADER_AGREEMENT");
  assert.equal(routeVisual("do the graders agree", ga())!.template, "GRADER_AGREEMENT");
});

test("the comparable population cannot exceed the window, or the rate is inflated", () => {
  assert.notEqual(routeVisual("grader agreement", ga({ comparable: 200 }))?.template, "GRADER_AGREEMENT");
});

test("agreed cannot exceed comparable", () => {
  assert.notEqual(routeVisual("grader agreement", ga({ agreed: 999 }))?.template, "GRADER_AGREEMENT");
});

test("perfect agreement is renderable with no rows — there is nothing to enumerate", () => {
  assert.equal(routeVisual("grader agreement", ga({ agreed: 130, rows: [] }))!.template, "GRADER_AGREEMENT");
});

test("both evidence cards refuse an empty bundle", () => {
  const empty: VisualBundle = { systemsQueried: [], asOf: base.asOf };
  for (const id of ["COUNTERFACTUAL", "GRADER_AGREEMENT"]) {
    const spec = IMPLEMENTED_TEMPLATES.find((t) => t.id === id)!;
    assert.equal(spec.sufficient(empty), false, `${id} claims an empty bundle is sufficient`);
  }
});
