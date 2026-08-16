import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The bead session rail must only ever carry CASH-RTH samples.
 *
 * These are source scans rather than behavioural tests on purpose: every writer of
 * `vector:wall-history` lives behind a UW websocket, a Redis leader lock and a live SSE hub, none
 * of which are constructible in a unit test — and the bug being pinned here is precisely a MISSING
 * guard, which a behavioural test on the guarded path cannot see. Scanning the source is what
 * catches a fifth writer being added later without the gate.
 *
 * The bug: `STALE_RECORD_MAX_MS` answers "is the cached wall read recent?", not "is the market
 * open?". SPX/SPY/QQQ are oracle tickers with an always-on `gex_strike_expiry` subscription, so
 * their cache stays fresh overnight and the freshness check passes 24h a day. Prod 2026-08-07:
 * SPX's rail held 5,429 samples from 00:00:00 ET with only 28% inside RTH; META (non-oracle, cache
 * goes stale after the close) held 1,445 starting at 09:30:00 with 95% in-session.
 */

const SNAPSHOT = "src/features/vector/lib/vector-snapshot.ts";
const UNIVERSE = "src/features/vector/lib/vector-universe.ts";
const WALL_WRITE = "src/features/vector/lib/vector-wall-write.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function writerLinesIn(path: string, pattern: RegExp): number[] {
  const lines = read(path).split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (pattern.test(line) && !/^\s*import/.test(line)) hits.push(i);
  });
  return hits;
}

test("vector-snapshot imports the ET cash-RTH clock", () => {
  assert.match(
    read(SNAPSHOT),
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "the RTH gate needs the shared market-hours clock, not a hand-rolled hour check"
  );
});

test("vector-snapshot SSE writers sit behind wallRailRecordingOpen before persistWallSampleDebounced", () => {
  const lines = read(SNAPSHOT).split("\n");
  const writerLines = writerLinesIn(SNAPSHOT, /\bpersistWallSampleDebounced\s*\(/);
  assert.ok(writerLines.length >= 2, `expected SSE debounced writers, found ${writerLines.length}`);

  for (const idx of writerLines) {
    const window = lines.slice(Math.max(0, idx - 80), idx).join("\n");
    assert.match(
      window,
      /wallRailRecordingOpen\(\)/,
      `persistWallSampleDebounced at line ${idx + 1} has no wallRailRecordingOpen gate above it`
    );
  }
});

test("vector-universe durable writes route through writeWallHistorySample (canonical RTH gate inside)", () => {
  const src = read(UNIVERSE);
  assert.match(src, /writeWallHistorySample\(/, "universe must use the canonical wall writer");
  assert.doesNotMatch(
    src,
    /\bappendSessionWallSample\s*\(/,
    "universe must not bypass the observability writer"
  );
});

test("writeWallHistorySample applies isEtCashRth by default", () => {
  const src = read(WALL_WRITE);
  assert.match(src, /isEtCashRth\(\)/, "canonical writer must gate on cash RTH");
  assert.match(src, /rthRequired\s*=\s*true/, "RTH gate is on by default");
});

test("the RTH gate is evaluated BEFORE the staleness check, not merged into it", () => {
  // Ordering matters for intent, not just correctness: freshness passing overnight is exactly the
  // trap. Keeping the market-hours question first makes the two checks obviously independent.
  const src = read(SNAPSHOT);
  const gateIdx = src.indexOf("if (!wallRailRecordingOpen()) return false;");
  const staleIdx = src.indexOf("nowMs - s.cachedWallsAt <= STALE_RECORD_MAX_MS");
  assert.ok(gateIdx > -1, "recordVectorWallSamplesFromWarm must gate on wallRailRecordingOpen()");
  assert.ok(staleIdx > -1, "the staleness check must still exist");
  assert.ok(gateIdx < staleIdx, "the RTH gate must come before the first staleness check");
});

test("the gate documents WHY freshness is not a substitute for market hours", () => {
  // If this comment is ever deleted the next reader will 'simplify' the gate away again, since a
  // freshness check superficially looks like it already covers off-hours.
  const src = read(SNAPSHOT);
  assert.match(src, /function wallRailRecordingOpen\(\)/, "gate helper must exist and be named");
  assert.match(
    src,
    /is the cached wall read recent\?", not "is the market open\?/,
    "the docblock must state the distinction the bug turned on"
  );
});

test("the in-process leader and this module agree on the same gate", () => {
  // Four writers touch the rail; all four must use one clock. If the leader ever switches to a
  // different notion of 'open', the rails would disagree about what a session contains.
  const leader = read("src/lib/vector-bead-recorder-leader.ts");
  assert.match(leader, /isEtCashRth\(\)/, "leader still gates on cash RTH");
  assert.match(read(SNAPSHOT), /isEtCashRth/, "snapshot writers gate on the same clock");
});
