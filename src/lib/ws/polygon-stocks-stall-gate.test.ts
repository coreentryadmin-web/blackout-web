import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("stocks-socket: feed stall watchdog uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./stocks-socket.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /startStocksWatchdog[\s\S]*?!isWsUpdatedAtFresh\(at, STOCKS_STALL_MS, now\)/,
    "stocks feed stall must reject clock-skewed future lastMessageAt stamps"
  );
  assert.doesNotMatch(
    src,
    /startStocksWatchdog[\s\S]*?Date\.now\(\)\s*-\s*at\s*>\s*STOCKS_STALL_MS/,
    "raw Date.now()-at must not gate stocks feed stall"
  );
});

test("polygon-socket: indices stall watchdog uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./polygon-socket.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /startIndicesWatchdog[\s\S]*?!isWsUpdatedAtFresh\(lastIndicesMessageAt, INDICES_STALL_MS, now\)/,
    "indices feed stall must reject clock-skewed future lastIndicesMessageAt stamps"
  );
  assert.doesNotMatch(
    src,
    /startIndicesWatchdog[\s\S]*?Date\.now\(\)\s*-\s*lastIndicesMessageAt\s*>\s*INDICES_STALL_MS/,
    "raw Date.now()-lastIndicesMessageAt must not gate indices feed stall"
  );
});
