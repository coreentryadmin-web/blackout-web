import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("stocks-socket: LULD halt staleness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./stocks-socket.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /export function isLuldHaltSourceStaleForState[\s\S]*?isWsUpdatedAtFresh\(localFreshestAt, maxAgeMs, now\)/,
    "isLuldHaltSourceStaleForState must reject clock-skewed future localFreshestAt stamps"
  );
  assert.match(
    src,
    /export function isLuldHaltSourceStaleForState[\s\S]*?isWsUpdatedAtFresh\(clusterMessageAt, maxAgeMs, now\)/,
    "isLuldHaltSourceStaleForState must reject clock-skewed future clusterMessageAt stamps"
  );
  assert.doesNotMatch(
    src,
    /export function isLuldHaltSourceStaleForState[\s\S]*?now\s*-\s*localFreshestAt\s*<=\s*maxAgeMs/,
    "raw now-localFreshestAt must not gate LULD halt freshness"
  );
});

test("luld-halts-store: feed staleness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./luld-halts-store.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /export function isLuldHaltFeedStale[\s\S]*?!isWsUpdatedAtFresh\(at, maxAgeMs\)/,
    "isLuldHaltFeedStale must reject clock-skewed future last_message_at stamps"
  );
  assert.doesNotMatch(
    src,
    /export function isLuldHaltFeedStale[\s\S]*?Date\.now\(\)\s*-\s*at\s*>\s*maxAgeMs/,
    "raw Date.now()-at must not gate LULD feed freshness"
  );
});
