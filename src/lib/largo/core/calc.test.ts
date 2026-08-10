import { test } from "node:test";
import assert from "node:assert/strict";
import { fin, delta, pctChange, stats, rankBy, agreementOf, reconcile, winRate, fmt } from "./calc";

test("fin fails closed on everything that is not a finite number", () => {
  assert.equal(fin(7), 7);
  assert.equal(fin(-0.5), -0.5);
  assert.equal(fin(0), 0, "zero is a real reading, not a missing one");
  for (const junk of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(fin(junk as number), null, String(junk));
  }
  // A numeric string is data the caller has not parsed yet. Coercing it here would hide a
  // provider returning strings, which is exactly the kind of drift an audit needs to see.
  assert.equal(fin("7" as unknown as number), null);
});

test("delta never treats a missing side as zero", () => {
  assert.equal(delta(10, 4), 6);
  assert.equal(delta(4, 10), -6);
  assert.equal(delta(10, null), null, "unknown base must not yield '+10'");
  assert.equal(delta(null, 10), null);
});

test("pctChange returns null on a zero base rather than Infinity", () => {
  // Design rule 2. (x - 0)/0 is Infinity, which formats into something that looks like a number
  // and reads as a real move. A zero base is undefined, not infinite, and not 0%.
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(0, 0), null);
  assert.equal(pctChange(null, 10), null);
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(90, 100), -10);
  // Negative base: magnitude is what matters, so a move from -100 to -50 is +50%, not -50%.
  assert.equal(pctChange(-50, -100), 50);
});

test("stats reports its sample size and what it excluded", () => {
  const s = stats([1, 2, 3, null, NaN, 4]);
  assert.equal(s?.n, 4);
  assert.equal(s?.excluded, 2, "the caller must be able to say 2 rows had no value");
  assert.equal(s?.sum, 10);
  assert.equal(s?.mean, 2.5);
  assert.equal(s?.median, 2.5);
  assert.equal(s?.min, 1);
  assert.equal(s?.max, 4);
  assert.equal(stats([5, 1, 3])?.median, 3, "odd count takes the middle of the SORTED values");
});

test("stats returns null on an empty usable set instead of a zero-filled object", () => {
  // Design rule: an all-null column and a column of genuine zeros are different findings. A
  // {mean: 0} shape makes them indistinguishable downstream.
  assert.equal(stats([]), null);
  assert.equal(stats([null, undefined, NaN]), null);
  assert.equal(stats([0, 0])?.mean, 0, "genuine zeros still produce stats");
  assert.equal(stats([0, 0])?.n, 2);
});

test("rankBy puts items with no value in `unranked`, NEVER last", () => {
  // The fabrication this prevents: a ticker with no flow data sorted to the bottom and then
  // narrated as "the weakest name today". It is unknown, not worst.
  const rows = [
    { t: "NVDA", vol: 900 },
    { t: "ZZZZ", vol: null as number | null },
    { t: "TSLA", vol: 1200 },
  ];
  const r = rankBy(rows, (x) => x.vol);
  assert.deepEqual(r.ranked.map((x) => x.item.t), ["TSLA", "NVDA"]);
  assert.deepEqual(r.unranked.map((x) => x.t), ["ZZZZ"]);
  assert.ok(!r.ranked.some((x) => x.item.t === "ZZZZ"), "an unknown value must not occupy a rank");
  assert.deepEqual(r.ranked.map((x) => x.rank), [1, 2], "ranks are contiguous over usable rows only");
});

test("rankBy honours direction", () => {
  const asc = rankBy([{ v: 3 }, { v: 1 }, { v: 2 }], (x) => x.v, "asc");
  assert.deepEqual(asc.ranked.map((x) => x.value), [1, 2, 3]);
});

test("rankBy flags ties instead of breaking them on input order", () => {
  // Input order is an implementation detail; presenting it as a ranking is fabrication.
  const r = rankBy([{ t: "A", v: 100 }, { t: "B", v: 100 }, { t: "C", v: 50 }], (x) => x.v);
  assert.equal(r.ties, 2, "both tied rows are flagged, not just the loser");
  assert.deepEqual(r.ranked.map((x) => x.tied), [true, true, false]);
  assert.equal(r.ranked.find((x) => x.item.t === "C")!.tied, false);
});

test("rankBy on an all-missing column ranks nothing", () => {
  const r = rankBy([{ v: null }, { v: undefined }], (x) => x.v as number | null);
  assert.deepEqual(r.ranked, []);
  assert.equal(r.unranked.length, 2);
  assert.equal(r.ties, 0);
});

test("agreementOf surfaces the conflict rather than averaging it away", () => {
  // Averaging two contradictory reads produces a number NO source reported and buries the most
  // valuable finding — that they disagree.
  const a = agreementOf(
    [{ src: "helix", dir: "long" }, { src: "thermal", dir: "short" }],
    (v) => v.dir
  );
  assert.equal(a.conflict, true);
  assert.equal(a.agreed.length, 0, "two singletons are not a consensus");
  assert.equal(a.outliers.length, 2);

  const b = agreementOf(
    [{ src: "helix", dir: "long" }, { src: "thermal", dir: "long" }, { src: "vector", dir: "short" }],
    (v) => v.dir
  );
  assert.equal(b.conflict, true, "a majority does not erase the dissent");
  assert.deepEqual(b.agreed.map((v) => v.dir), ["long"]);
  assert.deepEqual(b.outliers.map((v) => v.src), ["vector"]);

  const c = agreementOf([{ dir: "long" }, { dir: "long" }], (v) => v.dir);
  assert.equal(c.conflict, false);
});

test("reconcile reports the spread instead of asserting agreement", () => {
  const ok = reconcile(
    [
      { source: "helix", value: 7757.64 },
      { source: "thermal", value: 7757.64 },
      { source: "polygon", value: 7757.7 },
    ],
    0.1
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.usable, 3);
  assert.ok(ok.spreadPct! < 0.01, `spread was ${ok.spreadPct}`);

  const bad = reconcile([{ source: "a", value: 100 }, { source: "b", value: 110 }], 1);
  assert.equal(bad.ok, false);
  assert.ok(Math.abs(bad.spreadPct! - 10) < 1e-9);
  assert.equal(bad.min, 100);
  assert.equal(bad.max, 110);
});

test("reconcile cannot manufacture a disagreement from one reading", () => {
  const one = reconcile([{ source: "a", value: 100 }, { source: "b", value: null }], 1);
  assert.equal(one.usable, 1);
  assert.equal(one.spreadPct, null, "one reading has no spread — not a 0% one");
  assert.equal(one.ok, true);
  assert.equal(reconcile([], 1).usable, 0);
  // A zero base gets the same guard pctChange uses.
  assert.equal(reconcile([{ source: "a", value: 0 }, { source: "b", value: 5 }], 1).spreadPct, null);
});

test("winRate returns null — not 0% — when nothing has been graded", () => {
  // Reporting 0% over zero graded rows reads as "we lose everything" when the truth is "nothing
  // has been graded yet". That is the single worst number this engine could emit.
  const none = winRate([]);
  assert.equal(none.graded, 0);
  assert.equal(none.ratePct, null);
  const open = winRate([{ outcome: "open" }, { outcome: "pending" }]);
  assert.equal(open.graded, 0);
  assert.equal(open.ratePct, null);
});

test("winRate tallies the real outcome vocabulary", () => {
  const r = winRate([
    { outcome: "win" },
    { outcome: "doubled" },
    { outcome: "target" },
    { outcome: "loss" },
    { outcome: "stopped" },
    { outcome: "breakeven" },
    { outcome: "open" },
  ]);
  assert.equal(r.wins, 3);
  assert.equal(r.losses, 2);
  assert.equal(r.breakeven, 1);
  assert.equal(r.graded, 6, "an OPEN row is not graded and must not dilute the rate");
  assert.ok(Math.abs(r.ratePct! - 50) < 1e-9);
});

test("fmt renders unknown as an em-dash, never as 0 or NaN", () => {
  assert.equal(fmt(null), "—");
  assert.equal(fmt(undefined), "—");
  assert.equal(fmt(NaN), "—");
  assert.equal(fmt(Infinity), "—");
  assert.equal(fmt(0), "0.00", "a genuine zero still prints as a number");
  assert.equal(fmt(-12.345, { decimals: 1 }), "-12.3");
  assert.equal(fmt(12.3, { decimals: 1, sign: true }), "+12.3");
  assert.equal(fmt(-12.3, { decimals: 1, sign: true }), "-12.3", "sign:true never doubles a minus");
  assert.equal(fmt(5, { decimals: 0, suffix: "%" }), "5%");
});
