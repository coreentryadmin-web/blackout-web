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
