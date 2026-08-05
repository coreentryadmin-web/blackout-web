import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAdvContextLine,
  formatGexContextLine,
  estimateDarkpoolShareSize,
} from "./discord-context-enrichment.ts";

test("formatGexContextLine shows nearest level distance", () => {
  const line = formatGexContextLine(740, {
    flip: 720,
    call_wall: 750,
    put_wall: 700,
  });
  assert.match(line ?? "", /call wall \(750\)/);
  assert.match(line ?? "", /below/);
});

test("formatGexContextLine returns null without levels", () => {
  assert.equal(formatGexContextLine(100, { flip: null, call_wall: null, put_wall: null }), null);
});

test("formatAdvContextLine computes share pct of ADV", () => {
  const line = formatAdvContextLine(500_000, 10_000_000);
  assert.match(line ?? "", /5\.0% of 20D/);
});

test("estimateDarkpoolShareSize derives from premium and price", () => {
  assert.equal(estimateDarkpoolShareSize({ premium: 1_000_000, price: 100, share_size: null }), 10_000);
});
