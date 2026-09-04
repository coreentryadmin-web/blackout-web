import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uwSocketGateOpen } from "./uw-socket";

test("uwSocketGateOpen: non-leader always false", () => {
  assert.equal(uwSocketGateOpen(false), false);
});

test("uwSocketGateOpen: leader always true (24/7 for spot prices)", () => {
  assert.equal(uwSocketGateOpen(true), true);
});

test("uw-socket: channel freshness gates use isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./uw-socket.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /export function isUwChannelFresh[\s\S]*?return isWsUpdatedAtFresh\(at, maxAgeMs\)/,
    "isUwChannelFresh must reject clock-skewed future lastMessageAt stamps"
  );
  assert.match(
    src,
    /cluster_live: clusterAt != null && isWsUpdatedAtFresh\(clusterAt, 120_000, now\)/,
    "cluster_live must not treat negative age as live"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*at\s*<=\s*maxAgeMs/,
    "raw Date.now()-at must not gate UW channel freshness"
  );
  assert.match(
    src,
    /function isUwHaltSourceStale[\s\S]*?return freshest == null \|\| !isWsUpdatedAtFresh\(freshest, maxAgeMs\)/,
    "isUwHaltSourceStale must reject clock-skewed future effectiveFreshestUwMessageAt stamps"
  );
  assert.doesNotMatch(
    src,
    /function isUwHaltSourceStale[\s\S]*?Date\.now\(\)\s*-\s*freshest\s*>\s*maxAgeMs/,
    "isUwHaltSourceStale must not treat negative age as live"
  );
});
