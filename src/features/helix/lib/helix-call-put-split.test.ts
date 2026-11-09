import { test } from "node:test";
import assert from "node:assert/strict";
import { callPutSplitPct, fmtSplitPct } from "./helix-call-put-split";

test("callPutSplitPct: never fabricates a 100% complement off an all-typeless ($0/$0) tape", () => {
  // RED before the fix: TickerDrawer.tsx rendered Put Premium as "100 - (callPct ?? 0)" = 100%
  // beside a $0 figure, for exactly this input (callPrem=0, putPrem=0 — every visible print was
  // typeless, so neither leg ever accumulated anything).
  const { callPct, putPct } = callPutSplitPct(0, 0);
  assert.equal(callPct, null);
  assert.equal(putPct, null);
});

test("callPutSplitPct: real call-only premium reads 100/0, not null", () => {
  const { callPct, putPct } = callPutSplitPct(500_000, 0);
  assert.equal(callPct, 100);
  assert.equal(putPct, 0);
});

test("callPutSplitPct: real put-only premium reads 0/100", () => {
  const { callPct, putPct } = callPutSplitPct(0, 500_000);
  assert.equal(callPct, 0);
  assert.equal(putPct, 100);
});

test("callPutSplitPct: putPct is always the exact complement of callPct when measured", () => {
  const { callPct, putPct } = callPutSplitPct(300_000, 700_000);
  assert.equal(callPct, 30);
  assert.equal(putPct, 70);
  assert.equal(callPct! + putPct!, 100);
});

test("callPutSplitPct: negative/garbage totals also refuse rather than divide by <=0", () => {
  const { callPct, putPct } = callPutSplitPct(-100, 50);
  assert.equal(callPct, null);
  assert.equal(putPct, null);
});

test("fmtSplitPct: null renders as an honest em-dash, never a fabricated 0%/100%", () => {
  assert.equal(fmtSplitPct(null), "—");
  assert.equal(fmtSplitPct(0), "0%");
  assert.equal(fmtSplitPct(100), "100%");
});
