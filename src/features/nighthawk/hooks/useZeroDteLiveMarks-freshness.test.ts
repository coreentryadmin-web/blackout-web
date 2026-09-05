/**
 * Regression guard for a future-timestamp bug in useZeroDteLiveMarks (2026-09-05). Raw
 * `Date.now() - lastSseAtRef < SSE_QUIET_MS` treats a clock-skewed future SSE timestamp as
 * "still active" and suppresses the REST poll fallback while marks may be stale.
 *
 * Run: `npx tsx --test src/features/nighthawk/hooks/useZeroDteLiveMarks-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/features/nighthawk/hooks/useZeroDteLiveMarks.ts"),
  "utf8"
);

test("useZeroDteLiveMarks: poll fallback quiet gate uses isWsUpdatedAtFresh (source scan)", () => {
  assert.match(
    src,
    /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/,
    "must import shared future-at freshness guard"
  );
  assert.match(
    src,
    /if \(isWsUpdatedAtFresh\(lastSseAtRef\.current, SSE_QUIET_MS\)\) return;/,
    "poll fallback must not treat future lastSseAt as still-active SSE"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*lastSseAtRef\.current\s*<\s*SSE_QUIET_MS/,
    "raw now-lastSseAt must not gate poll fallback"
  );
});
