import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVectorPickLiveStatus,
  isSetupInvalidated,
  parseInvalidationLevel,
} from "./vector-pick-live-status";

test("parseInvalidationLevel extracts numeric level", () => {
  assert.equal(parseInvalidationLevel("5m close > 7,600 (wall breaks)"), 7600);
});

test("isSetupInvalidated: spot above ceiling invalidates fade", () => {
  const r = isSetupInvalidated(7610, "5m close > 7,600", "short", 7600, 7500, null);
  assert.equal(r.invalidated, true);
});

test("evaluateVectorPickLiveStatus: still_buy on fresh quote near entry", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 576,
    side: "call",
    entryMid: 3.25,
    quote: { bid: 3.2, ask: 3.5, mid: 3.35, delta: 0.42 },
    invalidation: "5m close < 570",
    bias: "long",
    putWall: 570,
  });
  assert.equal(r.status, "still_buy");
});

test("evaluateVectorPickLiveStatus: dont_buy when premium extended", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 576,
    side: "call",
    entryMid: 3.0,
    quote: { bid: 3.8, ask: 4.0, mid: 3.9, delta: 0.42 },
    bias: "long",
  });
  assert.equal(r.status, "dont_buy");
  assert.match(r.reason, /extended/i);
});

test("evaluateVectorPickLiveStatus: dont_buy when setup invalidated", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 568,
    side: "call",
    entryMid: 3.2,
    quote: { bid: 2.8, ask: 3.0, mid: 2.9, delta: 0.3 },
    invalidation: "5m close < 570",
    bias: "long",
    putWall: 570,
  });
  assert.equal(r.status, "dont_buy");
  assert.equal(r.setupInvalidated, true);
});
