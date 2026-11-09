import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcileOptionSubscriptions } from "./options-socket";

// BUG FIX (2026-11-09, five-engine-largo-cycle audit): reconcileOptionSubscriptions used to query
// `user_positions`, a table DROPPED in src/lib/migrations/006_drop_user_positions.sql (2026-07-06)
// and never recreated — every ~30s tick threw 42P01 (relation does not exist), swallowed as a
// console.warn, since that date. 0DTE self-subscribes independently via live-marks.ts's own
// reconcileWsSubscriptions, so this generic reconciler contributed exactly zero contracts to the
// WS pool in that entire window. Minimal fix: stop issuing the dead query.

test("reconcileOptionSubscriptions resolves cleanly with no DB round trip (no longer queries the dropped user_positions table)", async () => {
  // No DB mock is set up at all — if this still tried to import/query the database, a real
  // connection attempt in this sandboxed test run would hang or throw, not resolve instantly.
  await assert.doesNotReject(reconcileOptionSubscriptions());
});

test("options-socket source no longer references the dropped user_positions table (source scan)", () => {
  const src = readFileSync(new URL("./options-socket.ts", import.meta.url), "utf8");
  // Only the doc comment explaining the fix may mention it now — assert there's no live SQL
  // query string left (the old literal `FROM user_positions` query text).
  assert.ok(
    !src.includes("FROM user_positions"),
    "must not still issue a query against the dropped user_positions table"
  );
});
