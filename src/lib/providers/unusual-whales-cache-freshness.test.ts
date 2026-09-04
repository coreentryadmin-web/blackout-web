import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");

test("readUwCache rejects far-future fetchedAt (source scan)", () => {
  // readUwCache delegates the future-skew guard to the shared isWsUpdatedAtFresh() helper
  // (same pattern the sibling stocks-socket.ts/polygon-socket.ts source-scan tests in this
  // PR assert) rather than inlining a second copy of the WS_TIMESTAMP_FUTURE_TOLERANCE_MS
  // comparison — assert the delegation, not a literal re-implementation.
  assert.match(
    src,
    /function readUwCache[\s\S]*?isWsUpdatedAtFresh\(slot\.fetchedAt, ttl\)/,
    "in-process UW REST cache must not treat clock-skewed future fetchedAt as fresh"
  );
  assert.doesNotMatch(
    src,
    /function readUwCache[\s\S]*?Date\.now\(\)\s*-\s*slot\.fetchedAt/,
    "raw Date.now()-fetchedAt must not gate UW in-process cache"
  );
});
