import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Source-inspection regression guard (2026-09-29, built while repairing a live pull-latch
// split-brain -- see docs/audit/findings-staging/2026-09-29-nighthawk-republish-missing-outcome-rows-split-brain.md).
// The route needs `@/lib/db`/`@/lib/make-redis` (transitively pulls in "server-only"), which this
// repo's test environment can't safely mock without breaking the "@/" alias across the whole
// loaded graph -- same constraint post-publish-backfill.test.ts's own header documents, and the
// same substitute this codebase already uses for it (see analytics/route.test.ts, the wiring
// pinned at source).
//
// What this guards specifically: the route's entire safety property is that it REPLAYS an
// already-published verdict rather than computing a new one. That property lives in two places --
// (1) playStatuses/market are sourced from the cached Redis blob, never freshly fetched from
// Polygon/platform-intel, and (2) the route never writes back to the Redis status key. Losing
// either would turn this from "safe replay of already-shown data" into "silently recomputes
// mid-day and can overwrite the Redis blob members already saw" -- exactly the behavior this route
// was built to avoid (see the file's own header comment for why re-invoking the morning-confirm
// cron with ?force=1 was rejected as the fix).
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
}

test("replay-morning-verdicts: admin-gated", () => {
  const src = readSource();
  assert.match(src, /requireAdminApi\(\)/);
});

test("replay-morning-verdicts: playStatuses/market are sourced from the cached Redis blob, not freshly computed", () => {
  const src = readSource();
  const callIdx = src.indexOf("await persistNighthawkMorningVerdicts(");
  assert.ok(callIdx >= 0, "persistNighthawkMorningVerdicts must be called");
  const call = src.slice(callIdx, src.indexOf("});", callIdx) + 3);
  assert.match(call, /checkedAt:\s*cached\.checked_at/);
  assert.match(call, /playStatuses:\s*cached\.plays/);
  assert.match(call, /gapPts:\s*cached\.overnight_gap_pts/);
  assert.match(call, /spxPremarket:\s*cached\.spx_premarket/);
  assert.match(call, /spxPriorClose:\s*cached\.prior_close/);
  assert.match(call, /regime:\s*cached\.regime/);
});

test("replay-morning-verdicts: never writes back to the Redis status key (read-only w.r.t. Redis)", () => {
  const src = readSource();
  assert.match(src, /redis\.get\(REDIS_KEY\(editionFor\)\)/);
  assert.doesNotMatch(src, /redis\.set\(/);
});

test("replay-morning-verdicts: edition_for is required, no implicit 'latest' default", () => {
  const src = readSource();
  assert.match(src, /ISO_DATE_RE\.test\(body\.edition_for\)/);
});
