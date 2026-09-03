/**
 * Regression guard for a future-timestamp bug in the WATCH→ENTRY promotion gate (2026-09-03).
 * `checkPromoteEligibility` (spx-play-watch.ts) computed `ageMin = (Date.now() - new
 * Date(rec.first_at).getTime()) / 60_000`, a WATCH record persisted via `setMeta`/`getMeta`. A
 * future-dated `first_at` (clock skew across a restart/replica writing the shared record) produced
 * a negative age that never exceeded `maxAge`, extending an untrustworthy record's promotion
 * eligibility indefinitely instead of expiring it — the mirror-image of every genuinely-stale WATCH
 * record already correctly expiring above.
 *
 * Fix: a `first_at` more than ZERODTE_MARK_FUTURE_TOLERANCE_MS ahead of now (same constant/guard
 * marks-math.ts's isZeroDteMarkStale already applies) is now also expired, before the normal
 * `ageMin > maxAge` check runs.
 *
 * The function is DB-backed (getMeta/setMeta) and not exported for standalone unit testing, so this
 * is a source-text regression guard (same idiom as spx-play-engine.test.ts's getNhConfluenceBonus
 * check) rather than a full behavioral test.
 * Run: `npx tsx --test src/features/spx/lib/spx-play-watch-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-play-watch.ts"), "utf8");

test("spx-play-watch: ZERODTE_MARK_FUTURE_TOLERANCE_MS is imported from marks-math", () => {
  assert.match(
    src,
    /import\s*\{\s*ZERODTE_MARK_FUTURE_TOLERANCE_MS\s*\}\s*from\s*"@\/lib\/zerodte\/marks-math"/
  );
});

test("checkPromoteEligibility: a future-dated WATCH record is expired before the normal maxAge check", () => {
  const idx = src.indexOf("const ageMs = Date.now() - new Date(rec.first_at).getTime();");
  assert.ok(idx > 0, "the ageMs computation must still exist");
  const after = src.slice(idx, idx + 700);
  assert.match(
    after,
    /ageMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS/,
    "a future-dated first_at must be rejected (expired) rather than silently extending eligibility"
  );
});
