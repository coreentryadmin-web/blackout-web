import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultZeroDteStatusFilter,
  isZeroDteSessionActive,
  markStreamKind,
  preferredPlayId,
  resolveFocusTickerMatch,
} from "./deck-session-ui.ts";

test("isZeroDteSessionActive: RTH heat states are active; CLOSED/PRE_MARKET are not", () => {
  assert.equal(isZeroDteSessionActive("RTH"), true);
  assert.equal(isZeroDteSessionActive("OPENING_DRIVE"), true);
  assert.equal(isZeroDteSessionActive("POST_COMMIT"), true);
  assert.equal(isZeroDteSessionActive("POWER_HOUR"), true);
  assert.equal(isZeroDteSessionActive("CLOSED"), false);
  assert.equal(isZeroDteSessionActive("PRE_MARKET"), false);
});

test("isZeroDteSessionActive: unknown heat falls back to ET minutes", () => {
  assert.equal(isZeroDteSessionActive(null, 10 * 60), true); // 10:00
  assert.equal(isZeroDteSessionActive(undefined, 8 * 60), false); // 08:00
  assert.equal(isZeroDteSessionActive("", 16 * 60), false); // 16:00 exact = closed
});

test("defaultZeroDteStatusFilter: RTH prefers OPEN then WATCH", () => {
  assert.equal(defaultZeroDteStatusFilter({ heatState: "RTH", open: 2, watch: 5 }), "OPEN");
  assert.equal(defaultZeroDteStatusFilter({ heatState: "RTH", open: 0, watch: 5 }), "WATCH");
  assert.equal(defaultZeroDteStatusFilter({ heatState: "RTH", open: 0, watch: 0 }), "ALL");
});

test("defaultZeroDteStatusFilter: after close defaults to ALL", () => {
  assert.equal(defaultZeroDteStatusFilter({ heatState: "CLOSED", open: 0, watch: 6 }), "ALL");
});

test("markStreamKind: never LIVE when session/play closed; prefers CLOSED over SYNC", () => {
  assert.equal(markStreamKind({ live: true, sync: false, stale: false, playClosed: false, sessionClosed: false, hasMark: true }), "LIVE");
  assert.equal(markStreamKind({ live: false, sync: true, stale: false, playClosed: true, sessionClosed: false, hasMark: true }), "CLOSED");
  assert.equal(markStreamKind({ live: false, sync: true, stale: false, playClosed: false, sessionClosed: true, hasMark: true }), "CLOSED");
  assert.equal(markStreamKind({ live: false, sync: true, stale: false, playClosed: false, sessionClosed: false, hasMark: true }), "SYNC");
  assert.equal(markStreamKind({ live: false, sync: false, stale: true, playClosed: false, sessionClosed: false, hasMark: true }), "STALE");
});

test("preferredPlayId: working beats watch beats closed", () => {
  assert.equal(
    preferredPlayId([
      { id: "c", status: "CLOSED" },
      { id: "w", status: "WATCH" },
      { id: "o", status: "OPEN" },
    ]),
    "o",
  );
  assert.equal(
    preferredPlayId([
      { id: "c", status: "CLOSED" },
      { id: "w", status: "WATCH" },
    ]),
    "w",
  );
});

test("resolveFocusTickerMatch: matches by ticker case-insensitively and returns null with no focusTicker", () => {
  const plays = [
    { id: "a", ticker: "AAPL" },
    { id: "b", ticker: "TSLA" },
  ];
  assert.deepEqual(resolveFocusTickerMatch(plays, "aapl", null), { id: "a" });
  assert.equal(resolveFocusTickerMatch(plays, null, null), null);
  assert.equal(resolveFocusTickerMatch(plays, "NVDA", null), null);
});

test("resolveFocusTickerMatch: fires even when the focus target is ALREADY selected by coincidence", () => {
  // Live repro 2026-09-13 (`/nighthawk?view=swings&ticker=AAPL`): the board's own default
  // selection can independently land on the exact ticker a focus request names. The OLD guard
  // (`selId !== match.id`) misread that as "already handled" and never opened mobile detail —
  // this decouples the decision from `selId` entirely, so a real navigation always fires once.
  const plays = [{ id: "a", ticker: "AAPL" }];
  assert.deepEqual(resolveFocusTickerMatch(plays, "AAPL", null), { id: "a" });
});

test("resolveFocusTickerMatch: does not re-fire for a focusTicker value already handled (poll refresh, member closed the detail view)", () => {
  const plays = [
    { id: "a", ticker: "AAPL" },
    { id: "t", ticker: "TSLA" },
  ];
  assert.equal(resolveFocusTickerMatch(plays, "AAPL", "AAPL"), null);
  // A DIFFERENT focus request (e.g. a fresh Legacy hand-off) still fires.
  assert.deepEqual(resolveFocusTickerMatch(plays, "TSLA", "AAPL"), { id: "t" });
});
