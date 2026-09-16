import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FLOW_INGEST_ALT_SKIP_REASONS,
  ageMinFromIso,
  isFlowIngestAlternateWriterSkip,
} from "./cron-writer-target-fresh";

test("isFlowIngestAlternateWriterSkip recognizes live alternate-writer skip reasons", () => {
  for (const reason of FLOW_INGEST_ALT_SKIP_REASONS) {
    assert.equal(isFlowIngestAlternateWriterSkip(reason), true);
  }
  assert.equal(isFlowIngestAlternateWriterSkip("locked"), false);
  assert.equal(isFlowIngestAlternateWriterSkip(null), false);
});

test("ageMinFromIso reads an ordinary past timestamp as its real age", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const tenMinAgo = new Date(now - 10 * 60_000).toISOString();
  assert.equal(ageMinFromIso(tenMinAgo, now), 10);
});

test("a future-dated timestamp (clock skew / bad write) is rejected, not read as extra-fresh", () => {
  // Previously this computed a negative age, which trivially passed every caller's
  // `ageMin <= N` freshness check -- a corrupted future timestamp would flip a genuinely dead
  // cron job's writer-target probe to "fresh", masking the real staleness on the admin dashboard
  // (admin-cron-health.ts's TARGET_FRESH_OVERRIDE_KEYS path) instead of failing the check.
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const fiveMinInTheFuture = new Date(now + 5 * 60_000).toISOString();
  assert.equal(ageMinFromIso(fiveMinInTheFuture, now), null);
});

test("a timestamp a few seconds in the future stays within tolerance", () => {
  // signalWindowAgeMs's 60s tolerance absorbs ordinary clock skew between replicas/DB/app --
  // only timestamps meaningfully ahead of now are rejected.
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const tenSecInTheFuture = new Date(now + 10_000).toISOString();
  const age = ageMinFromIso(tenSecInTheFuture, now);
  assert.ok(age != null && age < 0 && age > -1);
});

test("probePgFlowAlertsFresh and the vector-bead-record probe route through the same future-dated guard", () => {
  const src = readFileSync(join(__dirname, "cron-writer-target-fresh.ts"), "utf8");
  assert.match(src, /const ageMs = signalWindowAgeMs\(ms, Date\.now\(\)\)/);
  assert.match(src, /signalWindowAgeMs\(tail\.time \* 1000, Date\.now\(\)\)/);
});

test("REGRESSION: the zerodte-warm writer-target probe reads the scanner heartbeat, not the earnings cache", () => {
  // 2026-09-16: this probe used to check ZERODTE_EARNINGS_KEY -- the cron route's FAST
  // synchronous sub-task, warmed on every invocation regardless of whether the HEAVY
  // background chain (warmZeroDteBoard -> scanZeroDteBoard -> persistZeroDteScan ->
  // discovery-events) ever completes. A live ~35min stall in that background chain left the
  // earnings cache fresh the whole time, so this probe reported "target fresh" and
  // admin-cron-health.ts's TARGET_FRESH_OVERRIDE_KEYS suppressed the staleness -- the exact
  // outage recordZeroDteScanTick("cron")'s heartbeat exists to catch. Assert the probe now
  // reads that heartbeat (loadZeroDteScanHeartbeat) and never re-introduces the earnings-cache
  // proxy for this case.
  const src = readFileSync(join(__dirname, "cron-writer-target-fresh.ts"), "utf8");
  const caseStart = src.indexOf('case "zerodte-warm": {');
  assert.notEqual(caseStart, -1, "zerodte-warm case must still exist");
  const nextCaseStart = src.indexOf('case "uw-cache-refresh"', caseStart);
  const caseBody = src.slice(caseStart, nextCaseStart === -1 ? undefined : nextCaseStart);
  assert.match(caseBody, /loadZeroDteScanHeartbeat/);
  assert.doesNotMatch(caseBody, /ZERODTE_EARNINGS_KEY/);
});
