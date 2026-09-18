import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug (found 2026-09-16, live audit): sibling of the same-day fix to
// /api/market/nighthawk/legacy-marks/route.ts. This module feeds the legacy-live-sync cron
// directly (runLegacyLiveSync's real position mark-and-manage pass) — its getLiveOptionMarkSync()
// calls used ZERODTE_MARK_STALE_MS (5s) to decide whether a cached WS tick counts as "live" at
// all, so a WS tick 5-30s old was silently discarded and the row fell through to a REST snapshot
// that can be equally or more stale. A row that reads stale gets skipped entirely by
// runLegacyLiveSync's `if (mark == null) { noQuote += 1; continue; }` — no peak/trough tracking,
// no trim/close evaluation for that position that cron cycle. Source-level regression (same
// convention as legacy-marks/route.test.ts — this module has no prior dedicated test file) so it
// never regresses back to the wrong constant.
test("legacy-option-marks-server.ts gates the WS-tick freshness check on LEGACY_QUOTE_STALE_MS, not ZERODTE's 5s bar", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/nighthawk/lib/legacy-option-marks-server.ts"),
    "utf8"
  );
  assert.match(src, /import \{ LEGACY_QUOTE_STALE_MS \} from "@\/lib\/zerodte\/marks-math"/);
  assert.doesNotMatch(src, /import \{ ZERODTE_MARK_STALE_MS/);
  assert.match(src, /getLiveOptionMarkSync\(occ, LEGACY_QUOTE_STALE_MS\)/);
  assert.match(src, /getLiveOptionMarkSync\(legacyOccForSnapshot\(occ\), LEGACY_QUOTE_STALE_MS\)/);
  assert.doesNotMatch(src, /getLiveOptionMarkSync\([^)]*ZERODTE_MARK_STALE_MS\)/);
});
