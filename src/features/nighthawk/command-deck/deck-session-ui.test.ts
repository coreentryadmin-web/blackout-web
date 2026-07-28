import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultZeroDteStatusFilter,
  isZeroDteSessionActive,
  markStreamKind,
  preferredPlayId,
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
