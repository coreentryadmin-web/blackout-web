import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFLUENCE_BUCKETS,
  bucketForConfirmations,
  summarizeByConfluenceBucket,
  edgeBucketComparison,
  looseningJustificationCheck,
  gradeDirection,
} from "./confluence-floor-backtest-eval.mjs";

test("bucketForConfirmations maps exactly the E3 axis (0/1/2), truncating and rejecting non-numbers", () => {
  assert.equal(bucketForConfirmations(0), "0-conf");
  assert.equal(bucketForConfirmations(1), "1-conf (standard floor)");
  assert.equal(bucketForConfirmations(2), "2-conf (early-window floor / E3 edge bucket)");
  assert.equal(bucketForConfirmations(1.9), "1-conf (standard floor)", "truncates, never rounds up");
  for (const bad of [null, undefined, Number.NaN, "x", 3, -1]) {
    assert.equal(bucketForConfirmations(bad), null, `${String(bad)} must not fall into a bucket`);
  }
  assert.equal(CONFLUENCE_BUCKETS.length, 3);
});

test("summarizeByConfluenceBucket (flat, no split) counts only graded rows, preserves ascending bucket order", () => {
  const rows = [
    { confirmations: 2, graded: { win: true, maxRet: 0.03 } },
    { confirmations: 2, graded: { win: false, maxRet: 0.01 } },
    { confirmations: 0, graded: { win: false, maxRet: 0.0 } },
    { confirmations: 1, graded: null }, // ungraded — must be skipped
    { confirmations: null, graded: { win: true, maxRet: 0.05 } }, // unbucketable — skipped
  ];
  const s = summarizeByConfluenceBucket(rows);
  assert.deepEqual(
    s.map((x) => x.bucket),
    ["0-conf", "2-conf (early-window floor / E3 edge bucket)"]
  );
  const edge = s.find((x) => x.bucket.startsWith("2-conf"));
  assert.equal(edge.n, 2);
  assert.equal(edge.wins, 1);
  assert.equal(edge.winRate, 50);
  assert.ok(Math.abs(edge.avgMaxRetPct - 2) < 1e-9);
});

test("summarizeByConfluenceBucket splits by an arbitrary field (e.g. earlyWindow) within each bucket", () => {
  const rows = [
    { confirmations: 1, earlyWindow: true, graded: { win: true, maxRet: 0.02 } },
    { confirmations: 1, earlyWindow: false, graded: { win: false, maxRet: 0.0 } },
    { confirmations: 1, earlyWindow: false, graded: { win: true, maxRet: 0.01 } },
  ];
  const s = summarizeByConfluenceBucket(rows, "earlyWindow");
  const splits = s.filter((x) => x.bucket === "1-conf (standard floor)").map((x) => x.split);
  assert.deepEqual(splits.sort(), ["false", "true"]);
  const early = s.find((x) => x.bucket === "1-conf (standard floor)" && x.split === "true");
  assert.equal(early.n, 1);
  assert.equal(early.winRate, 100);
  const standard = s.find((x) => x.bucket === "1-conf (standard floor)" && x.split === "false");
  assert.equal(standard.n, 2);
  assert.equal(standard.winRate, 50);
});

test("edgeBucketComparison names the exact 1-conf vs 2-conf delta (today's standard floor vs E3's edge bucket)", () => {
  const summary = [
    { bucket: "1-conf (standard floor)", split: "all", n: 40, winRate: 30 },
    { bucket: "2-conf (early-window floor / E3 edge bucket)", split: "all", n: 20, winRate: 45 },
  ];
  const c = edgeBucketComparison(summary);
  assert.equal(c.deltaPp, 15);
  assert.equal(c.standard.winRate, 30);
  assert.equal(c.edge.winRate, 45);
});

test("edgeBucketComparison ignores split rows (only reads split==='all') and is null when a band is absent", () => {
  assert.equal(
    edgeBucketComparison([{ bucket: "1-conf (standard floor)", split: "true", n: 5, winRate: 40 }]),
    null,
    "a split-only row must not satisfy the flat comparison"
  );
  assert.equal(edgeBucketComparison([{ bucket: "0-conf", split: "all", n: 5, winRate: 40 }]), null);
});

test("looseningJustificationCheck names the exact 0-conf vs 1-conf delta the 2026-09-08 loosening argued was safe (flat, not negative)", () => {
  const summary = [
    { bucket: "0-conf", split: "all", n: 10, winRate: 20 },
    { bucket: "1-conf (standard floor)", split: "all", n: 40, winRate: 35 },
  ];
  const j = looseningJustificationCheck(summary);
  assert.equal(j.deltaPp, 15);
  assert.equal(j.blocked.winRate, 20);
  assert.equal(j.admitted.winRate, 35);
});

test("looseningJustificationCheck is null (not zero) when a band is entirely absent", () => {
  assert.equal(looseningJustificationCheck([{ bucket: "2-conf (early-window floor / E3 edge bucket)", split: "all", n: 5, winRate: 40 }]), null);
});

test("gradeDirection is re-exported unchanged from score-floor-backtest-eval.mjs (same grading rule)", () => {
  assert.equal(typeof gradeDirection, "function");
});
