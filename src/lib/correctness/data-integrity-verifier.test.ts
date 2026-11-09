import { test, mock } from "node:test";
import assert from "node:assert/strict";

// data-integrity-verifier.ts's own top-level imports pull in "server-only" (directly, and
// transitively via @/lib/db and @/lib/providers/gex-positioning), @/lib/shared-cache, and
// @/lib/admin-cron-health (which itself pulls @/lib/db → "pg") — mock.module() needs the
// RELATIVE path from THIS FILE's own location for every one of them (Node 20's tsx alias
// resolver does not run inside mock.module()'s specifier resolution; a "@/..." specifier there
// crashes with ERR_MODULE_NOT_FOUND even though it works under Node 22 — see
// docs/audit/FINDINGS.md and every sibling mock.module()-based test in this repo, e.g.
// flows-verifier.test.ts). This suite only exercises the pure, exported `ageMin()` helper, so
// every mock below is a trivial no-op stub — none of these are called by the assertions here.
mock.module("server-only", { namedExports: {} });

// Mutable so the verifyDataIntegrity() test below (added for the pg_editions-empty-vs-skipped
// regression) can flip Postgres "on" and script per-table probe responses, WITHOUT disturbing the
// ageMin()-only tests above, which never call verifyDataIntegrity and so never read these.
let dbConfiguredValue = false;
let dbQueryHandler: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> = async () => ({
  rows: [],
});

mock.module("../db", {
  namedExports: {
    dbConfigured: () => dbConfiguredValue,
    dbQuery: async (sql: string) => dbQueryHandler(sql),
    fetchLatestNighthawkEdition: async () => null,
    fetchNighthawkEditionByDate: async () => null,
  },
});

mock.module("../providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => null,
  },
});

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheRawTtlSec: async () => null,
  },
});

mock.module("../admin-cron-health", {
  namedExports: {
    buildCronHealthSnapshot: async () => null,
  },
});

const mod = () => import("./data-integrity-verifier");

// The tolerance data-integrity-verifier.ts guards against, mirrored here rather than imported —
// this suite intentionally treats ageMin() as a black box over its OWN documented contract
// (Infinity past this bound) rather than re-deriving the bound from marks-math.ts, so the test
// still catches a regression if the guard's threshold silently drifts.
const FUTURE_TOLERANCE_MS = 60_000;

test("ageMin: ordinary past timestamp returns its true positive age in minutes", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const tenMinutesAgo = now - 10 * 60_000;
  assert.equal(ageMin(tenMinutesAgo, now), 10);
});

test("ageMin: a timestamp within the future-clock-skew tolerance still returns a (small negative) age, not Infinity", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const thirtySecondsFuture = now + 30_000; // 30s ahead of now, within the 60s tolerance
  const result = ageMin(thirtySecondsFuture, now);
  assert.ok(Number.isFinite(result), "expected a finite age within tolerance");
  assert.ok(result < 0, "expected a small negative age for a within-tolerance future timestamp");
});

// BUG FIX regression (2026-09-04): before the fix, this returned a large NEGATIVE number
// (e.g. -300 for 5 minutes in the future), which every call site's `aMin <= thresholdMinutes`
// freshness check reads as trivially TRUE — a future-dated (clock-skewed or corrupted) row
// silently passed as "fresh" instead of being flagged. This is the exact bug shape already fixed
// across SPX Slayer (#3423), coaching alerts (#3442), the GEX heatmap cache (#3481), and 12+
// other sites this session — data-integrity-verifier.ts is itself the tool meant to CATCH this
// class of corruption, so it must not be blind to it in its own core age computation.
test("ageMin: a timestamp far in the future (beyond tolerance) returns Infinity, not a trivially-fresh negative age", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const fiveMinutesFuture = now + 5 * 60_000; // thenMs = now + 5min
  assert.equal(ageMin(fiveMinutesFuture, now), Infinity);
});

test("ageMin: Infinity fails every realistic freshness threshold used by this file's checks", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const oneHourFuture = now + 60 * 60_000;
  const aMin = ageMin(oneHourFuture, now);
  // Mirrors the checkPostgres/checkRedis pattern: `fresh = Number.isFinite(latestMs) && aMin <= N`.
  for (const thresholdMinutes of [15, 20, 30]) {
    assert.equal(aMin <= thresholdMinutes, false, `Infinity must not pass a <= ${thresholdMinutes}m freshness check`);
  }
});

test("ageMin: right at the tolerance boundary is still treated as finite (not yet Infinity)", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const exactlyAtTolerance = now + FUTURE_TOLERANCE_MS; // thenMs = now + tolerance, diffMs === -tolerance
  assert.ok(Number.isFinite(ageMin(exactlyAtTolerance, now)), "boundary (diffMs === -tolerance) should not yet flip to Infinity");
});

test("ageMin: just past the tolerance boundary flips to Infinity", async () => {
  const { ageMin } = await mod();
  const now = 1_000_000_000_000;
  const justPastTolerance = now + FUTURE_TOLERANCE_MS + 1; // thenMs = now + tolerance + 1ms
  assert.equal(ageMin(justPastTolerance, now), Infinity);
});

// ───────────────────────────────────────────────────────────────────────────
// classifyRedisTtlProbe — the redis_ttl check's pure classification logic.
//
// BUG FIX (2026-11-09): this check's own detail text has always promised to flag "TTL -1 (no
// expiry) — a stale-as-live risk", but it used to read its input through sharedCacheGetWithTtl,
// which filters every result through `raw && ttl > 0` — a present-but-TTL-less key (the EXACT
// state this check claims to catch) failed that gate the same as a genuinely-absent key and fell
// through to an unrelated in-process memory map, so the probe came back `null` either way. The
// "TTL -1" branch in the old code (`ttl < 0 ? "NO expiry set..." : ...`) was therefore dead code —
// unreachable in production, confirmed by tracing sharedCacheGetWithTtl's own implementation, not
// merely suspected. The fix (sharedCacheRawTtlSec, shared-cache.ts) hands back Redis' own literal
// TTL verdict unfiltered, and this classifier is the first thing to actually exercise the -1 case.
// ───────────────────────────────────────────────────────────────────────────

test("classifyRedisTtlProbe: TTL -1 (key present, no expiry) ALWAYS flags — the exact smell this check exists to catch", async () => {
  const { classifyRedisTtlProbe } = await mod();
  for (const rth of [true, false]) {
    const verdict = classifyRedisTtlProbe(-1, rth);
    assert.equal(verdict.outcome, "flag", `rth=${rth}: a no-expiry key must flag regardless of market hours`);
    assert.match(verdict.detail, /no expiry/i);
    assert.equal(verdict.actual, -1);
  }
});

test("classifyRedisTtlProbe: TTL -2 (key genuinely absent) during RTH is consistency-only, not a silent skip masquerading as success", async () => {
  const { classifyRedisTtlProbe } = await mod();
  const verdict = classifyRedisTtlProbe(-2, true);
  assert.equal(verdict.outcome, "consistency-only");
  assert.equal(verdict.actual, -2);
});

test("classifyRedisTtlProbe: TTL -2 off-RTH is skipped (writer legitimately idle)", async () => {
  const { classifyRedisTtlProbe } = await mod();
  const verdict = classifyRedisTtlProbe(-2, false);
  assert.equal(verdict.outcome, "skipped");
});

test("classifyRedisTtlProbe: null (Redis unreachable) is always skipped, never flag or consistency-only", async () => {
  const { classifyRedisTtlProbe } = await mod();
  for (const rth of [true, false]) {
    assert.equal(classifyRedisTtlProbe(null, rth).outcome, "skipped");
  }
});

test("classifyRedisTtlProbe: a bounded positive TTL within the expected window passes", async () => {
  const { classifyRedisTtlProbe } = await mod();
  const verdict = classifyRedisTtlProbe(30, true);
  assert.equal(verdict.outcome, "pass");
  assert.equal(verdict.actual, 30);
});

test("classifyRedisTtlProbe: a positive TTL far outside the expected window flags", async () => {
  const { classifyRedisTtlProbe } = await mod();
  const verdict = classifyRedisTtlProbe(3600, true);
  assert.equal(verdict.outcome, "flag");
  assert.match(verdict.detail, /outside the expected/i);
});

// BUG FIX regression: an EMPTY nighthawk_editions table (pre-launch, or the publish writer never
// landed — "no edition has ever published") carries NO applicable check at all: there is nothing
// to recompute, no invariant to hold, nothing "internally consistent". Before the fix, checkPostgres
// labeled that case "consistency-only" — the SAME status reserved (per types.ts's HONESTY
// PRINCIPLE) for "every applicable check held but no independent oracle confirmed it". Reporting
// "nothing applicable" as "consistency-only" is the exact mislabeled-outcome class already fixed
// twice in this correctness vein (largo-verifier.ts's self-consistency-miscounted-as-independent,
// nighthawk-verifier.ts's L4 check emitting "pass" when the comparison never ran) — here the sibling
// check ONE TABLE DOWN in this SAME file (nighthawk_play_outcomes, empty branch, line ~340) already
// gets this right ("skipped", "no outcomes ledger to sanity-check yet"), proving the correct label
// was known and simply not applied consistently. Getting this wrong matters beyond cosmetics:
// run-correctness.ts's collectCoverageGaps() treats every "consistency-only" metric as a reported
// coverage gap (and flattenTotals() counts it in `consistencyOnly`, not `skipped`) — so a pre-launch
// or writer-never-landed deploy falsely reports a DATALAYER coverage gap on a metric that never
// actually ran any check this run, instead of the honest "skipped / not assertable yet".
test("verifyDataIntegrity: an EMPTY nighthawk_editions table is reported skipped, not consistency-only (nothing was actually checked)", async () => {
  dbConfiguredValue = true;
  dbQueryHandler = async (sql: string) => {
    if (sql.includes("nighthawk_editions")) return { rows: [{ latest_ms: null, total: "0" }] };
    if (sql.includes("nighthawk_play_outcomes")) return { rows: [{ total: "0", bad_outcome: "0" }] };
    // flow_alerts / cron_job_runs probes: no rows → dbProbe's catch degrades these to a plain skip,
    // which is irrelevant to this test (they group under their own, different metric names).
    throw new Error("no canned response for this probe in this test");
  };
  try {
    const { verifyDataIntegrity } = await mod();
    const score = await verifyDataIntegrity(true);
    const editions = score.metrics.find((m) => m.metric === "pg_editions");
    assert.ok(editions, "expected a pg_editions metric on the DATALAYER scorecard");
    assert.equal(
      editions!.status,
      "skipped",
      `empty nighthawk_editions has nothing applicable to check — expected "skipped" (matching the ` +
        `sibling pg_nh_outcomes-empty branch), got "${editions!.status}"`
    );
    assert.equal(editions!.independentlyConfirmed, false);
    const [check] = editions!.checks;
    assert.equal(check.outcome, "skipped");
  } finally {
    // Restore the ageMin-tests' baseline so this test's state can't leak into a re-run / future test.
    dbConfiguredValue = false;
    dbQueryHandler = async () => ({ rows: [] });
  }
});
