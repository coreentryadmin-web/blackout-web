import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_WS_STALE_MS,
  overlayRestIndexWithWs,
  localWsIndexEntry,
  type WsIndexEntry,
} from "./index-snapshot-overlay";
import type { IndexQuote } from "./polygon";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

const REST: IndexQuote = {
  symbol: "I:VIX",
  price: 14.33,
  change_pct: -0.35,
  prev_close: 14.38,
};

const now = 1_000_000;

test("overlayRestIndexWithWs rebases change_pct off prior close when WS anchor is ws-bar", () => {
  // Measured 2026-09-04: stock-candle-store overlay served +0.07% while Polygon reported -0.35%.
  // A ws-bar anchor must not transport its session-open % — rebase against REST prev_close instead.
  const ws: WsIndexEntry = {
    price: 14.29,
    change_pct: 0.07,
    open_source: "ws-bar",
    updatedAt: now - 5_000,
  };
  const out = overlayRestIndexWithWs(REST, ws, now);
  assert.equal(out.price, 14.29);
  assert.ok(out.change_pct != null && out.change_pct < 0, `expected negative day change, got ${out.change_pct}`);
  assert.ok(Math.abs(out.change_pct - -0.63) < 0.05, `expected ~-0.63%, got ${out.change_pct}`);
});

test("overlayRestIndexWithWs trusts WS change_pct only when open_source is rest", () => {
  const ws: WsIndexEntry = {
    price: 14.29,
    change_pct: -0.4,
    open_source: "rest",
    updatedAt: now - 5_000,
  };
  const out = overlayRestIndexWithWs(REST, ws, now);
  assert.equal(out.change_pct, -0.4);
});

test("overlayRestIndexWithWs leaves REST untouched when WS is stale", () => {
  const ws: WsIndexEntry = {
    price: 14.29,
    change_pct: -0.4,
    open_source: "rest",
    updatedAt: now - INDEX_WS_STALE_MS - 1,
  };
  const out = overlayRestIndexWithWs(REST, ws, now);
  assert.deepEqual(out, REST);
});

test("overlayRestIndexWithWs leaves REST untouched when WS entry is missing", () => {
  assert.deepEqual(overlayRestIndexWithWs(REST, null, now), REST);
});

test("overlayRestIndexWithWs leaves REST untouched when WS updatedAt is clock-skewed future", () => {
  const ws: WsIndexEntry = {
    price: 14.29,
    change_pct: -0.4,
    open_source: "rest",
    updatedAt: now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 1,
  };
  const out = overlayRestIndexWithWs(REST, ws, now);
  assert.deepEqual(out, REST);
});

test("localWsIndexEntry rejects clock-skewed future updatedAt", () => {
  const store = {
    VIX: {
      price: 14.29,
      updatedAt: now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 1,
    },
  };
  assert.equal(localWsIndexEntry(store, "VIX", now), null);
});
