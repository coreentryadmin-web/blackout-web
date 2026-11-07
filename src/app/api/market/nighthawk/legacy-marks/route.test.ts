import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("legacy-marks/route.ts rounds member-visible floats at the API boundary", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/nighthawk/legacy-marks/route.ts"),
    "utf8"
  );
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /roundFloats\(\{ available: true, marks \}\)/);
});

// Bug (found 2026-09-16, live audit, fixed that day): the WS-tick freshness check used to gate
// on ZERODTE_MARK_STALE_MS (5s) instead of LEGACY_QUOTE_STALE_MS (30s) here. That correctness now
// lives in fetchLegacyOptionMarksServer (legacy-option-marks-server.ts), which this route
// delegates to — covered by legacy-option-marks-server.test.ts's own staleness-gate assertion,
// not duplicated here.
//
// Bug (found 2026-11-07, live audit): this route used to reimplement the WS+REST fetch inline
// instead of calling the shared fetchLegacyOptionMarksServer, so when PR #7517/#7522 added a
// Redis cache fallback (serve a stale-but-present mark when both WS and REST fail for an OCC
// with a prior successful fetch) to that shared function, this route's own duplicate copy never
// got it — 19 real open Legacy positions read fully null marks live despite the fix having
// "landed." Fixed by deleting the duplicate inline implementation and delegating to
// fetchLegacyOptionMarksServer(occs, { includeStale: true }) — the same function the
// legacy-live-sync cron and Discord trade-notify already use, so there is only one
// WS+REST+cache-fallback implementation left to regress. Source-level regression (same
// convention as the roundFloats assertion above — a Next.js route handler isn't easily invoked
// in this harness without mocking auth/WS internals) so this route never regresses back to a
// second inline copy.
test("legacy-marks/route.ts delegates to fetchLegacyOptionMarksServer with includeStale:true (cache-fallback reachable)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/nighthawk/legacy-marks/route.ts"),
    "utf8"
  );
  assert.match(
    src,
    /import \{\s*fetchLegacyOptionMarksServer,?[\s\S]*?\} from "@\/features\/nighthawk\/lib\/legacy-option-marks-server"/
  );
  assert.match(src, /fetchLegacyOptionMarksServer\(occs, \{ includeStale: true \}\)/);
  // No second, inline WS+REST implementation re-introduced in this route.
  assert.doesNotMatch(src, /getLiveOptionMarkSync\(/);
  assert.doesNotMatch(src, /buildLegacyOptionMarkRow\(/);
});
