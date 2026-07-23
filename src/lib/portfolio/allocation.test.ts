import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  allocatedBook,
  DEFAULT_ALLOCATION,
  type AllocationCandidate,
} from "./allocation.ts";

function c(over: Partial<AllocationCandidate> & { ticker: string }): AllocationCandidate {
  return { direction: "LONG", score: 75, ...over };
}

test("cross-sectional rank: sorts by score, best = rank 1", () => {
  const out = allocate([c({ ticker: "PLTR", score: 79 }), c({ ticker: "NVDA", score: 82 }), c({ ticker: "AMD", score: 81 })]);
  assert.deepEqual(out.map((d) => d.ticker), ["NVDA", "AMD", "PLTR"]);
  assert.deepEqual(out.map((d) => d.rank), [1, 2, 3]);
});

test("EV ranks over score when finite (the calibration graduation hook)", () => {
  // AMD has a lower score but a higher calibrated EV → it outranks NVDA.
  const out = allocate([c({ ticker: "NVDA", score: 90, ev: 0.3 }), c({ ticker: "AMD", score: 80, ev: 0.9 })]);
  assert.equal(out[0]!.ticker, "AMD");
  assert.equal(out[0]!.rankValue, 0.9);
});

test("duplicate thesis: same sector + direction is ONE edge — sibling is redundant + skipped at cap 1", () => {
  const out = allocate([
    c({ ticker: "NVDA", sector: "semis", score: 82 }),
    c({ ticker: "AMD", sector: "semis", score: 81 }),
    c({ ticker: "SMCI", sector: "semis", score: 79 }),
  ]);
  const nvda = out.find((d) => d.ticker === "NVDA")!;
  const amd = out.find((d) => d.ticker === "AMD")!;
  assert.equal(nvda.clusterRole, "PRIMARY");
  assert.equal(nvda.sizing, "FULL");
  assert.equal(amd.clusterRole, "REDUNDANT");
  assert.equal(amd.sizing, "SKIP"); // maxPerCluster default 1 → the sibling is a duplicate of the same thesis
  assert.match(amd.reasons.join(" "), /duplicate/);
});

test("opposite directions in one sector are NOT the same thesis", () => {
  const out = allocate([
    c({ ticker: "NVDA", sector: "semis", direction: "LONG", score: 82 }),
    c({ ticker: "INTC", sector: "semis", direction: "SHORT", score: 80 }),
  ]);
  // different (sector,direction) clusters → both PRIMARY (a long-semis and a short-semis are distinct edges)
  assert.equal(out.find((d) => d.ticker === "NVDA")!.clusterRole, "PRIMARY");
  assert.equal(out.find((d) => d.ticker === "INTC")!.clusterRole, "PRIMARY");
});

test("opportunity cost: existing exposure to a thesis makes a fresh add redundant", () => {
  const out = allocate(
    [c({ ticker: "AMD", sector: "semis", score: 88 })],
    [{ ticker: "NVDA", direction: "LONG", sector: "semis" }], // already long the semis thesis
  );
  const amd = out[0]!;
  assert.equal(amd.clusterRole, "REDUNDANT"); // the book already holds this thesis
  assert.equal(amd.sizing, "SKIP"); // covered — even though AMD scored 88 on its own
});

test("sector concentration cap limits total names per sector across directions", () => {
  const out = allocate(
    [
      c({ ticker: "AAPL", sector: "tech", direction: "LONG", score: 85 }),
      c({ ticker: "MSFT", sector: "tech", direction: "SHORT", score: 84 }),
      c({ ticker: "GOOG", sector: "tech", direction: "LONG", score: 83 }),
    ],
    [],
    { ...DEFAULT_ALLOCATION, maxPerCluster: 2, maxPerSector: 2 },
  );
  const taken = allocatedBook(out);
  assert.equal(taken.length, 2); // third tech name blocked by the sector cap
  assert.match(out.find((d) => d.ticker === "GOOG")!.reasons.join(" "), /sector concentration/);
});

test("top-N cut: everything past the cross-sectional cut is SKIP, not a mediocre trade", () => {
  const many = Array.from({ length: 15 }, (_, i) => c({ ticker: `T${i}`, sector: `s${i}`, score: 90 - i }));
  const out = allocate(many, [], { ...DEFAULT_ALLOCATION, topN: 10 });
  assert.equal(allocatedBook(out).length, 10);
  assert.equal(out[10]!.sizing, "SKIP");
  assert.match(out[10]!.reasons.join(" "), /top 10/);
});

test("unknown sector never merges names into a false shared thesis", () => {
  const out = allocate([
    c({ ticker: "ABC", sector: null, score: 80 }),
    c({ ticker: "XYZ", sector: null, score: 79 }),
  ]);
  // both PRIMARY — a null sector is keyed by ticker, so two unknowns aren't collapsed into one edge
  assert.ok(out.every((d) => d.clusterRole === "PRIMARY"));
  assert.ok(out.every((d) => d.sizing !== "SKIP"));
});

test("determinism: same set always allocates the same way", () => {
  const set = [c({ ticker: "B", score: 80, sector: "x" }), c({ ticker: "A", score: 80, sector: "y" })];
  assert.deepEqual(allocate(set), allocate(set));
});
