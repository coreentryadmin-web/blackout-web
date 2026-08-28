import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateVectorPlayBieStats,
  isVectorPickClosureFavorable,
  VECTOR_PLAY_BIE_MIN_SAMPLE,
} from "./vector-play-bie-stats";

const BUCKET = "long|scalp|fade-call|call-at";

function row(pct: number | null, invalidated = false) {
  return {
    premium_pct_from_entry: pct,
    setup_invalidated: invalidated,
    bie_bucket: BUCKET,
  };
}

test("isVectorPickClosureFavorable: invalidated is never favorable", () => {
  assert.equal(isVectorPickClosureFavorable(row(50, true)), false);
});

test("isVectorPickClosureFavorable: green at exit counts as favorable", () => {
  assert.equal(isVectorPickClosureFavorable(row(5, false)), true);
  assert.equal(isVectorPickClosureFavorable(row(-1, false)), false);
});

test("aggregateVectorPlayBieStats: returns null under MIN_SAMPLE", () => {
  const rows = Array.from({ length: VECTOR_PLAY_BIE_MIN_SAMPLE - 1 }, () => row(10));
  assert.equal(aggregateVectorPlayBieStats(rows, BUCKET), null);
});

test("aggregateVectorPlayBieStats: computes favPct at n>=MIN_SAMPLE", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => row(10)),
    ...Array.from({ length: 4 }, () => row(-20)),
  ];
  const stats = aggregateVectorPlayBieStats(rows, BUCKET)!;
  assert.equal(stats.samples, 10);
  assert.equal(stats.favPct, 0.6);
  assert.equal(stats.windowDays, 60);
});

test("aggregateVectorPlayBieStats: ignores other buckets", () => {
  const rows = Array.from({ length: 12 }, () => ({
    ...row(10),
    bie_bucket: "other|bucket",
  }));
  assert.equal(aggregateVectorPlayBieStats(rows, BUCKET), null);
});
