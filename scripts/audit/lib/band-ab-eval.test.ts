import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_BANDS,
  TOD_WINDOWS,
  bucketBy,
  compareBuckets,
  etMinutesOf,
  nNeededForGap,
} from "./band-ab-eval.mjs";
import { proportionDiffCI } from "../../../src/lib/zerodte/calibration-stats";

const play = (o = {}) => ({ score: 70, etMinutes: 600, pnlPct: 10, direction: "long", ...o });

test("etMinutesOf: 24h and AM/PM forms, and the noon/midnight edges", () => {
  assert.equal(etMinutesOf("09:47"), 587);
  assert.equal(etMinutesOf("9:47 AM"), 587);
  assert.equal(etMinutesOf("2:15 PM"), 14 * 60 + 15);
  assert.equal(etMinutesOf("12:30 PM"), 12 * 60 + 30, "noon is 12, not 24");
  assert.equal(etMinutesOf("12:30 AM"), 30, "midnight is 0, not 12");
});

test("etMinutesOf: an unreadable stamp is null — never bucketed as midnight", () => {
  // A row silently landing at 00:00 would be counted in no session window at all, or worse, in
  // whichever window happened to start at zero. Dropping it is the only honest option.
  for (const bad of ["", "not a time", null, undefined, 947, "99:99"]) {
    assert.equal(etMinutesOf(bad), null, `${String(bad)} must not parse`);
  }
});

test("bucketBy: rows land in the band that contains them, half-open at the top", () => {
  const plays = [play({ score: 64 }), play({ score: 65 }), play({ score: 74 }), play({ score: 75 })];
  const b = bucketBy(plays, SCORE_BANDS, (p) => p.score);
  const n = Object.fromEntries(b.map((x) => [x.label, x.n]));
  assert.equal(n["55-64"], 1, "64 belongs below the floor");
  assert.equal(n["65-74"], 2, "65 and 74 belong to the floor band");
  assert.equal(n["75-84"], 1);
});

test("bucketBy: a null score is DROPPED, not treated as zero", () => {
  const b = bucketBy([play({ score: null }), play({ score: 70 })], SCORE_BANDS, (p) => p.score);
  assert.equal(b.reduce((a, x) => a + x.n, 0), 1);
  assert.equal(b.find((x) => x.label === "<45").n, 0, "a missing score is not a low score");
});

test("bucketBy: an UNGRADED row is excluded from n — it cannot win or lose", () => {
  const b = bucketBy([play({ pnlPct: null }), play({ pnlPct: 5 })], SCORE_BANDS, (p) => p.score);
  const band = b.find((x) => x.label === "65-74");
  assert.equal(band.n, 1);
  assert.equal(band.wins, 1);
});

test("bucketBy: breakeven is not a win", () => {
  const b = bucketBy([play({ pnlPct: 0 })], SCORE_BANDS, (p) => p.score);
  const band = b.find((x) => x.label === "65-74");
  assert.equal(band.n, 1);
  assert.equal(band.wins, 0);
});

test("compareBuckets: a ten-play gap is INCONCLUSIVE — the whole point of the harness", () => {
  // This is the exact shape that produced the "55-64 beats 65+" claim: a big-looking point gap
  // on a tiny sample. The CI must refuse to call it.
  const a = { label: "55-64", n: 10, wins: 4, winRate: 0.4 };
  const b = { label: "65+", n: 124, wins: 48, winRate: 0.387 };
  const out = compareBuckets(a, b, proportionDiffCI);
  assert.equal(out.verdict, "INCONCLUSIVE");
  assert.ok(out.loPts < 0 && out.hiPts > 0, "the interval must straddle zero");
});

test("compareBuckets: a large, well-sampled gap DOES separate", () => {
  const a = { label: "good", n: 200, wins: 140, winRate: 0.7 };
  const b = { label: "bad", n: 200, wins: 60, winRate: 0.3 };
  assert.equal(compareBuckets(a, b, proportionDiffCI).verdict, "A SEPARATED");
});

test("compareBuckets: an empty bucket is NO DATA, never a win", () => {
  const empty = { label: "empty", n: 0, wins: 0, winRate: null };
  const full = { label: "full", n: 50, wins: 25, winRate: 0.5 };
  assert.equal(compareBuckets(empty, full, proportionDiffCI).verdict, "NO DATA");
  assert.equal(compareBuckets(full, empty, proportionDiffCI).verdict, "NO DATA");
});

test("nNeededForGap: a 15-point gap needs ~86 per bucket; a smaller gap needs more", () => {
  assert.equal(nNeededForGap(15), 86);
  assert.ok(nNeededForGap(5) > nNeededForGap(15));
  assert.equal(nNeededForGap(0), Infinity);
});

test("TOD_WINDOWS tile the session without overlapping", () => {
  for (let i = 1; i < TOD_WINDOWS.length; i++) {
    assert.equal(TOD_WINDOWS[i].lo, TOD_WINDOWS[i - 1].hi, `${TOD_WINDOWS[i].label} must abut its predecessor`);
  }
});
