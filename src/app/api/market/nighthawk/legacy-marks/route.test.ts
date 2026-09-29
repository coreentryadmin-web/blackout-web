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

// Bug (found 2026-09-16, live audit): the getLiveOptionMarkSync() calls here used to gate the
// WS-tick freshness check on ZERODTE_MARK_STALE_MS (5s, 0DTE's own bar), so a WS tick 5-30s old
// was discarded and the row fell through to a REST snapshot that can be equally or more stale —
// even though buildLegacyOptionMarkRow's own staleness check (fixed earlier the same day, PR
// #5073) already correctly uses LEGACY_QUOTE_STALE_MS (30s). Reproduced live: CRWD (a liquid
// name) read stale:true repeatedly with asof lagging real time by 70-90s. Source-level regression
// (same convention as the roundFloats assertion above — a Next.js route handler isn't easily
// invoked in this harness without mocking auth/WS internals) so this module never regresses back
// to the wrong constant.
test("legacy-marks/route.ts gates the WS-tick freshness check on LEGACY_QUOTE_STALE_MS, not ZERODTE's 5s bar", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/nighthawk/legacy-marks/route.ts"),
    "utf8"
  );
  assert.match(src, /import \{ LEGACY_QUOTE_STALE_MS \} from "@\/lib\/zerodte\/marks-math"/);
  assert.doesNotMatch(src, /import \{ ZERODTE_MARK_STALE_MS/);
  assert.match(src, /getLiveOptionMarkSync\(occ, LEGACY_QUOTE_STALE_MS\)/);
  assert.match(src, /getLiveOptionMarkSync\(legacyOccForSnapshot\(occ\), LEGACY_QUOTE_STALE_MS\)/);
  assert.doesNotMatch(src, /getLiveOptionMarkSync\([^)]*ZERODTE_MARK_STALE_MS\)/);
});
