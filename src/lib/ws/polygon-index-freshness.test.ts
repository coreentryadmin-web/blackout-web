import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/ws/polygon-socket.ts"), "utf8");

test("getIndexFeedFreshness rejects far-future updatedAt as stalled (source scan)", () => {
  assert.match(src, /WS_TIMESTAMP_FUTURE_TOLERANCE_MS/);
  assert.match(
    src,
    /rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS[\s\S]*?stalled: true/,
    "far-future index ticks must not read as live via Math.max(0, now - updatedAt)"
  );
});

test("getIndexStoreStatus: symbol ageMs comes from getIndexFeedFreshness, not raw Date.now()-updatedAt", () => {
  assert.match(
    src,
    /getIndexStoreStatus[\s\S]*?getIndexFeedFreshness\(sym\)/,
    "admin/socket-health index ages must share the same future-timestamp guard as getIndexFeedFreshness"
  );
  assert.doesNotMatch(
    src,
    /getIndexStoreStatus[\s\S]*?Date\.now\(\)\s*-\s*indexStore\[sym\]\.updatedAt/,
    "raw age math in getIndexStoreStatus would report clock-skewed future ticks as live"
  );
});
