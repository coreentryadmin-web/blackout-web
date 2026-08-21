import { test } from "node:test";
import assert from "node:assert/strict";

import { coverage, joinProductSignals, type ProductContribution } from "./cross-product";
import type { ProductSignal } from "./product-read";

const sig = (direction: "bullish" | "bearish" | "neutral", evidence: string[]): ProductSignal => ({
  ticker: "SPX",
  ticker_class: "index",
  direction,
  evidence,
});

test("aligned when every reporting product points the same way", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["net premium +4.2M"]) },
    { product: "vector", signal: sig("bullish", ["regime long-gamma since 10:05"]) },
  ]);
  assert.equal(read.verdict, "aligned");
  assert.equal(read.direction, "bullish");
  assert.equal(read.camps.length, 1);
});

test("a LONE DISSENTER produces split, not a majority answer", () => {
  // The obvious design is majority vote, which would answer "bullish" and delete the finding.
  // If Vector's differential says the regime just flipped while three others read the tape
  // bullish, that disagreement is exactly why a member looks twice before sizing up.
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["net premium +4.2M"]) },
    { product: "thermal", signal: sig("bullish", ["sector heat 78th pct"]) },
    { product: "nighthawk", signal: sig("bullish", ["3 long-call plays committed"]) },
    { product: "vector", signal: sig("bearish", ["gamma flipped short at 7650"]) },
  ]);
  assert.equal(read.verdict, "split");
  assert.equal(read.direction, null, "must NOT resolve to the majority");
  assert.equal(read.camps.length, 2);
  assert.equal(read.camps[0].products.length, 3, "camps are largest-first");
  assert.deepEqual(read.camps[1].products, ["vector"]);
  assert.match(String(read.disagreement), /genuine disagreement/);
  assert.match(String(read.disagreement), /vector read SPX bearish/);
});

test("evidence is attributed per product so a member can tell who measured what", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["net premium +4.2M"]) },
    { product: "vector", signal: sig("bearish", ["gamma flipped short at 7650"]) },
  ]);
  const all = read.camps.flatMap((c) => c.evidence);
  assert.ok(all.includes("helix: net premium +4.2M"));
  assert.ok(all.includes("vector: gamma flipped short at 7650"));
});

test("confidence does NOT decide the outcome — the honest lane keeps its vote", () => {
  // The contract tells a product to OMIT confidence when it cannot calibrate. Weighting by
  // confidence would systematically down-rank the honest lanes and up-rank whichever one was most
  // willing to invent a number. A 0.95 must not overrule an omission.
  const confident: ProductContribution = {
    product: "helix",
    signal: { ...sig("bullish", ["net premium +4.2M"]), confidence: { score: 0.95, basis: "n=200", sample_size: 200 } },
  };
  const honest: ProductContribution = {
    product: "vector",
    signal: sig("bearish", ["gamma flipped short at 7650"]), // no confidence — cannot calibrate
  };
  const read = joinProductSignals("SPX", [confident, honest]);
  assert.equal(read.verdict, "split");
  assert.equal(read.direction, null, "a 0.95 must not overrule a product that honestly omitted");
});

test("absence is part of the answer — a thin consensus cannot look broad", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["net premium +4.2M"]) },
    { product: "vector", signal: sig("bullish", ["regime long-gamma"]) },
    { product: "meridian", signal: null, missingReason: "no earnings event within the window" },
    { product: "thermal", signal: null, missingReason: "snapshot stale (>15m)" },
    { product: "nighthawk", signal: null, missingReason: "no committed plays this session" },
  ]);
  assert.equal(read.verdict, "aligned");
  assert.equal(read.missing.length, 3);
  assert.deepEqual(coverage(read), { reporting: 2, total: 5, label: "2/5 products reporting" });
  // Every absence states why.
  for (const m of read.missing) assert.ok(m.reason.length > 0);
});

test("an unexplained absence is recorded, never silently dropped from the denominator", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["+4.2M"]) },
    { product: "vector", signal: sig("bullish", ["long gamma"]) },
    { product: "thermal", signal: null }, // no reason given
  ]);
  assert.equal(read.missing.length, 1);
  assert.match(read.missing[0].reason, /gave no reason/);
  assert.equal(coverage(read).label, "2/5 products reporting".replace("5", "3"));
});

test("one voice is insufficient — never 'aligned' off a sample of one", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["+4.2M"]) },
    { product: "vector", signal: null, missingReason: "no baseline yet this session" },
  ]);
  assert.equal(read.verdict, "insufficient");
  assert.equal(read.direction, null, "manufacturing consensus from one product is the failure");
  assert.equal(read.disagreement, undefined);
  assert.equal(read.missing[0].reason, "no baseline yet this session");
});

test("zero contributions is well-formed, not a crash", () => {
  const read = joinProductSignals("SPX", []);
  assert.equal(read.verdict, "insufficient");
  assert.deepEqual(read.camps, []);
  assert.equal(coverage(read).label, "0/0 products reporting");
});

test("a three-way split keeps all three camps", () => {
  const read = joinProductSignals("SPX", [
    { product: "helix", signal: sig("bullish", ["a"]) },
    { product: "vector", signal: sig("bearish", ["b"]) },
    { product: "thermal", signal: sig("neutral", ["c"]) },
  ]);
  assert.equal(read.verdict, "split");
  assert.equal(read.camps.length, 3);
});
