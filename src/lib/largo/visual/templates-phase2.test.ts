import test from "node:test";
import assert from "node:assert/strict";
import { routeVisual, IMPLEMENTED_TEMPLATES } from "./router";
import type { VisualBundle } from "./types";

/**
 * SCREENER / REJECTION / EM_CONE — the sufficiency gates.
 *
 * Each of these three can mislead in a way the first three cannot, and the gate is where that is
 * prevented. These tests are about what the router REFUSES.
 */

const base: VisualBundle = { systemsQueried: ["VECTOR"], asOf: "2026-08-10T20:05:00Z" };

const row = (ticker: string, v: number) => ({
  ticker,
  metricValue: v,
  metricDisplay: `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`,
  regime: (v >= 0 ? "above" : "below") as "above" | "below",
});

const screen = (n: number): VisualBundle => ({
  ...base,
  screen: {
    preset: "nearest_flip",
    metricLabel: "Distance to gamma flip",
    universeSize: 21,
    updatedAt: "2026-08-10T20:00:00Z",
    rows: Array.from({ length: n }, (_, i) => row(`T${i}`, (i + 1) * 0.11)),
  },
});

const rejections = (n: number, withGate = true): VisualBundle => ({
  ...base,
  rejections: {
    total: n,
    windowLabel: "today's session",
    rows: Array.from({ length: n }, (_, i) => ({
      ticker: `R${i}`,
      gateFailed: withGate ? "G-4 vix_unavailable" : "",
      reason: "VIX read unavailable at scan time",
      at: "10:32",
    })),
  },
});

const cone = (pathLen: number): VisualBundle => ({
  ...base,
  ticker: "SPX",
  cone: {
    upper: 7820,
    lower: 7680,
    upperDisplay: "7,820",
    lowerDisplay: "7,680",
    widthDisplay: "±0.90%",
    openDisplay: "7,752",
    closeDisplay: "7,741",
    sigmaLabel: "±1σ",
    verdict: "held",
    path: Array.from({ length: pathLen }, (_, i) => ({ price: 7700 + i })),
    asOf: "2026-08-10T20:00:00Z",
  },
});

test("every registered template is implemented, MARKET_MOVE last", () => {
  assert.equal(IMPLEMENTED_TEMPLATES.length, 15);
  assert.equal(IMPLEMENTED_TEMPLATES[IMPLEMENTED_TEMPLATES.length - 1]!.id, "MARKET_MOVE");
});

// ── SCREENER ────────────────────────────────────────────────────────────────────────────────

test("a screen needs THREE names — two ordered rows is a comparison, not a screen", () => {
  assert.equal(routeVisual("which names are nearest flip", screen(2)), null);
  assert.equal(routeVisual("which names are nearest flip", screen(3))!.template, "SCREENER");
});

test("screener intent fires on scanner vocabulary", () => {
  for (const q of ["show the screener", "which names are nearest flip", "most pinned names", "top 5 ranked"]) {
    assert.equal(routeVisual(q, screen(5))!.template, "SCREENER", q);
  }
});

// ── REJECTION ───────────────────────────────────────────────────────────────────────────────

test("every rejection row must NAME the gate that fired", () => {
  // "We passed on it" with no rule behind it is a claim about judgement. This card exists to
  // show a RULE, so a row without one disqualifies the whole card rather than rendering blank.
  assert.equal(routeVisual("what did we pass on", rejections(4, false)), null);
  assert.equal(routeVisual("what did we pass on", rejections(4, true))!.template, "REJECTION");
});

test("one rejection is an anecdote — two is the minimum", () => {
  assert.equal(routeVisual("what got rejected today", rejections(1)), null);
  assert.equal(routeVisual("what got rejected today", rejections(2))!.template, "REJECTION");
});

test("rejection intent fires on the natural phrasings", () => {
  for (const q of ["what did we pass on", "why not NVDA", "which setups were held", "what got rejected"]) {
    assert.equal(routeVisual(q, rejections(3))!.template, "REJECTION", q);
  }
});

// ── EM_CONE ─────────────────────────────────────────────────────────────────────────────────

test("EM_CONE REFUSES to render without a realised path — no intraday result claims", () => {
  // A cone with a stub of path implies an outcome that has not happened. This is what makes it a
  // post-close card by construction rather than by convention.
  assert.equal(routeVisual("did it stay inside the expected move", cone(0)), null);
  assert.equal(routeVisual("did it stay inside the expected move", cone(1)), null);
  assert.equal(routeVisual("did it stay inside the expected move", cone(2))!.template, "EM_CONE");
});

test("an inverted or degenerate band is not a band", () => {
  const bad: VisualBundle = { ...cone(10), cone: { ...cone(10).cone!, upper: 7680, lower: 7820 } };
  assert.equal(routeVisual("expected move", bad), null);
});

test("the three verdicts stay distinct in the type", () => {
  // held / breached / closed_outside are materially different claims: collapsing breached into
  // held would hide every intraday excursion, which is the negative-skew tail.
  const verdicts: VisualBundle["cone"][] = (["held", "breached", "closed_outside"] as const).map((v) => ({
    ...cone(5).cone!,
    verdict: v,
  }));
  assert.deepEqual(verdicts.map((c) => c!.verdict), ["held", "breached", "closed_outside"]);
});

// ── Cross-template ──────────────────────────────────────────────────────────────────────────

test("sufficiency still beats intent across the new templates", () => {
  // Asked for a screener on a bundle that only has a cone: falls back rather than drawing an
  // empty table, and reports that it did.
  const r = routeVisual("show me the screener", cone(6))!;
  assert.equal(r.template, "EM_CONE");
  assert.equal(r.matchedIntent, false);
  assert.ok(r.rejected.some((x) => x.template === "SCREENER"));
});

test("an explicit pick of a new template is still gated on evidence", () => {
  const r = routeVisual("anything", screen(4), "EM_CONE")!;
  assert.equal(r.template, "SCREENER", "falls back to what the evidence supports");
  assert.ok(r.rejected.some((x) => x.template === "EM_CONE"));
});
