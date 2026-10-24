import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isLiveOdteSession,
  safeTicker,
  safePathSegment,
  safeDateSegment,
  sym,
  optionTradePrintToFlowRaw,
  fetchUwIvRank,
  fetchUwInsiderTransactions,
  fetchUwNope,
  emptyDarkPoolSnapshot,
  darkPoolBias,
  fetchUwFlow0dte,
  isDegenerateFlowAggregate,
  fetchUwMacroIndicators,
  fetchUwGreekExposureExpiry,
} from "./unusual-whales";
import { shapeMeridianDarkPool } from "../meridian/meridian-earnings-intel-core";
import { UW_REST_SECTIONS } from "../uw-docs-catalog";

// 2026-07-03 is a US market holiday (July 4th observed) per nighthawk/session.ts's calendar.
test("isLiveOdteSession: false on a market holiday even during normal trading hours", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-03T15:00:00.000Z")), false); // 11:00 ET
});

test("isLiveOdteSession: false on a weekend", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-04T15:00:00.000Z")), false); // Saturday
});

test("isLiveOdteSession: false off-hours on an otherwise real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T09:00:00.000Z")), false); // Mon 05:00 ET — before the 7am window
});

test("isLiveOdteSession: true during the trading window on a real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T15:00:00.000Z")), true); // Mon 11:00 ET
});

// ── safeTicker/safePathSegment/safeDateSegment/sym: `ticker` (and related identifiers) are
// untrusted, user-supplied input that this file splices into ~60 URL PATH segments via
// template literal — same class of bug as polygon-options-gex.ts's `resolveOptionsRoot`,
// flagged there by CodeQL as request-forgery. A crafted value must not reach the outbound URL.

test("safeTicker: normal tickers pass through uppercased, unchanged", () => {
  assert.equal(safeTicker("spy"), "SPY");
  assert.equal(safeTicker("nvda"), "NVDA");
});

test("safeTicker: dotted share classes (BRK.A/BRK.B) are preserved", () => {
  assert.equal(safeTicker("brk.b"), "BRK.B");
});

test("safeTicker: rejects (empty string) anything with path-injection characters, does not mangle-and-pass-through", () => {
  assert.equal(safeTicker("AAPL/../../evil.com"), "");
  assert.equal(safeTicker("SPY@evil.com"), "");
  assert.equal(safeTicker("SPY:8080"), "");
  assert.equal(safeTicker("SPY\nHost: evil.com"), "");
});

test("safeTicker: null/undefined/empty never throws", () => {
  assert.equal(safeTicker(""), "");
  assert.equal(safeTicker(undefined as unknown as string), "");
});

test("safePathSegment: lowercases legitimate [a-z0-9-] values, rejects anything else", () => {
  assert.equal(safePathSegment("SMA"), "sma");
  assert.equal(safePathSegment("technology"), "technology");
  assert.equal(safePathSegment("../../etc/passwd"), "");
  assert.equal(safePathSegment("foo bar@baz"), "");
});

test("safeDateSegment: passes through a clean digits-and-hyphens date, rejects anything else", () => {
  assert.equal(safeDateSegment("2026-07-06"), "2026-07-06");
  assert.equal(safeDateSegment("2026-07-06/../evil"), "");
});

test("sym: uppercases, strips the I: index prefix, then applies the same allowlist-and-reject guard", () => {
  assert.equal(sym("spy"), "SPY");
  assert.equal(sym("I:SPX"), "SPX");
  assert.equal(sym("i:vix"), "VIX");
  assert.equal(sym("AAPL/../evil"), "");
});

// ── Catalog-path regression guard. Four endpoints in this provider were calling
// paths that don't exist in the UW API (wrong pluralization / renamed routes),
// so `uwGetSafe` swallowed the 404 and returned null — the data was silently
// MISSING (short screener, ETF in/out-flow, ETF tide, screener option-contracts)
// with no error surfaced. The catalog (auto-generated from UW's own OpenAPI) is
// ground truth: every path we call must appear in it. These assertions pin the
// corrected paths so a copy/paste or a "helpful" rename can't regress them back
// to a silently-404ing route.
const CATALOG_PATHS = new Set(UW_REST_SECTIONS.flatMap((s) => s.endpoints.map((e) => e.path)));

test("UW provider paths exist in the docs catalog (no silent 404s)", () => {
  // Concrete tickers in code map to `{ticker}` in the catalog template.
  for (const p of [
    "/api/short_screener",
    "/api/etfs/{ticker}/in-outflow",
    "/api/market/{ticker}/etf-tide",
    "/api/screener/option-contracts",
    "/api/lit-flow/{ticker}",
  ]) {
    assert.ok(CATALOG_PATHS.has(p), `${p} must exist in UW_REST_SECTIONS (catalog is ground truth)`);
  }
});

test("the old broken UW paths are NOT in the catalog (they were the bug)", () => {
  for (const p of [
    "/api/shorts/screener",
    "/api/etf/{ticker}/in-outflow",
    "/api/etf/{ticker}/tide",
    "/api/screener/contracts",
    "/api/lit-flow/ticker", // literal word "ticker" — ticker is a PATH param, not this
  ]) {
    assert.ok(!CATALOG_PATHS.has(p), `${p} is a non-existent route — must not be reintroduced`);
  }
});

test("optionTradePrintToFlowRaw forwards per-contract price for Fill column", () => {
  const raw = optionTradePrintToFlowRaw({
    id: "x1",
    underlying: "SPY",
    option_symbol: "SPY260717C00600000",
    price: 3.45,
    size: 500,
    premium: 172_500,
    executed_at: "2026-07-17T15:30:00",
    tags: ["SWEEP"],
  });
  assert.equal(raw.price, 3.45);
  assert.equal(raw.size, 500);
});

// ── EOD IV-rank caching (the rate-limit fix) ─────────────────────────────────────────
// WHY: iv_rank is END-OF-DAY data (UW recomputes once/session ~22:35 UTC), so a live UW hit per
// caller was pure rate-limit exposure. fetchUwIvRank was uncached (uwGetSafe direct, ttl=0). Now
// /volatility/stats has a long TTL in uwCacheTtlMs (in-process L1) AND fetchUwIvRank rides the Redis
// shared cache (L2). This test proves the L1 layer: two sequential calls within TTL issue exactly ONE
// underlying network fetch (the second is served from cache). Uses a unique ticker so the first call
// is a guaranteed cold miss regardless of any other test's cache state. No REDIS_URL → L1-only path.
test("fetchUwIvRank caches within TTL: two sequential calls → ONE underlying fetch", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  const prevTtl = process.env.UW_IV_RANK_CACHE_SEC;
  process.env.UW_API_KEY = "test-uw-key";            // uwConfigured() → true (fetch is mocked; header value is irrelevant)
  delete process.env.REDIS_URL;                       // force the L1-only path (getUwCacheRedis → null)
  process.env.UW_IV_RANK_CACHE_SEC = "3600";          // long TTL so the 2nd call is a fresh hit, not a stale re-fetch

  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ data: { iv_rank: "43.0832" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    // Unique ticker → the first call cannot hit a warm L1 slot left by another test.
    const a = await fetchUwIvRank("IVCACHETEST");
    const b = await fetchUwIvRank("IVCACHETEST");
    assert.equal(a, 43.0832);                          // parsed number, contract unchanged (number|null)
    assert.equal(b, 43.0832);                          // identical served value
    assert.equal(fetchCount, 1, "second call must be served from cache — only ONE upstream fetch");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
    if (prevTtl === undefined) delete process.env.UW_IV_RANK_CACHE_SEC; else process.env.UW_IV_RANK_CACHE_SEC = prevTtl;
  }
});

// ── fetchUwGreekExposureExpiry: NO cache layer at all (the 2026-10-18 tail-latency fix) ────────
// WHY: live-measured ALB TargetResponseTime p99=8.94s/Max=43.2s, recurring every 13-51min, traced
// to [api-queue-timing] bursts naming flow-per-expiry + greek-exposure/expiry + net-flow/expiry
// together. Unlike its two pool-siblings in the SAME runUwPooled fan-out (fetchDeskEnrichmentFields
// / buildSpxDeskFlow, spx-desk.ts) — fetchUwFlowPerExpiry (Redis L2, 120s) and fetchUwNetFlowExpiry
// (this file's own L1, 120s) — fetchUwGreekExposureExpiry had NO cache anywhere. Its wrapper
// (loadSpxDeskFlow, spx-desk-loader.ts) is cached for only 2s, matching the client's own live SWR
// poll interval, so under RTH/extended-hours polling this was the highest-frequency fully-live UW
// call in the app (~every 2s), competing for the same cluster-wide rate-limiter budget the periodic
// economy/SPX-cluster enrichment bursts also need. Same pattern as the fetchUwIvRank test above:
// two sequential calls within TTL issue exactly ONE underlying fetch.
test("fetchUwGreekExposureExpiry caches within TTL: two sequential calls → ONE underlying fetch", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  const prevTtl = process.env.UW_GREEK_EXPOSURE_EXPIRY_CACHE_SEC;
  process.env.UW_API_KEY = "test-uw-key";
  delete process.env.REDIS_URL;
  process.env.UW_GREEK_EXPOSURE_EXPIRY_CACHE_SEC = "120";

  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ data: [{ expiry: "2026-10-24", call_gamma: "100", put_gamma: "-50" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    const a = await fetchUwGreekExposureExpiry("GEXPIRYCACHETEST");
    const b = await fetchUwGreekExposureExpiry("GEXPIRYCACHETEST");
    assert.deepEqual(a, b, "identical cached rows served");
    assert.equal(fetchCount, 1, "second call must be served from cache — only ONE upstream fetch");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
    if (prevTtl === undefined) delete process.env.UW_GREEK_EXPOSURE_EXPIRY_CACHE_SEC; else process.env.UW_GREEK_EXPOSURE_EXPIRY_CACHE_SEC = prevTtl;
  }
});

// ── fetchUwMacroIndicators: sequential fan-out stacks admission waits additively (2026-10-15) ──
// WHY: live-measured in production the same day this test was written — `[uw] queue wait` log
// lines tagged "(background sweep)" showed TWO of the THREE UW_MACRO_INDICATORS (GDP, CPI,
// UNRATE) each independently paying 13.6s/17.3s rate-limiter admission waits inside the SAME
// `fetchDeskEnrichmentFields` pass, stacking to ~31s of pure queue dead time for just these two
// indicators — coincident, minute-for-minute, with that session's recurring AWS/ApplicationELB
// TargetResponseTime Max spikes to 40-43s. Root cause: `fetchUwMacroIndicators` fanned its 3
// indicator fetches out through `runUwSequential` (`await task()` one at a time) rather than
// `runUwPool` (this file's sibling functions already use the pooled form for every other
// latency-sensitive fan-out — see `fetchDeskEnrichmentFields`'s own call site and `runUwPooled`'s
// doc comment: "latency-critical lanes (live SPX desk)... batch jobs (nighthawk dossiers) can
// stay on runUwSequential"). `fetchUwMacroIndicators` is shared by BOTH a latency-critical caller
// (spx-desk.ts's desk-enrichment pool) and a batch one (nighthawk market-wide), so it had
// defaulted to the slower, serializing shape for both. Sequential execution means each
// indicator's full rate-limiter admission wait is paid back-to-back rather than overlapped — with
// 3 indicators this can nearly TRIPLE the worst-case wall time under real contention, exactly
// the shape of the measured incident. Switching its internal fan-out to the pooled primitive
// (concurrency = all 3, since the list is always small and fixed) lets their admission waits
// overlap instead of stack, with no behavior change for either caller (same results, same
// resilience — each task still independently `.catch(() => null)`-protected).
//
// This is a SOURCE-SCAN test (same established pattern as the adjacent "readUwCache... (source
// scan)" test above), not a timing-based behavioral one — deliberately. A behavioral timing test
// here would have to go through the REAL throttleUw/acquireSlot admission stack (there is no
// mockable seam between `fetchUwMacroIndicators` and the rate limiter: `fetchUwEconomyIndicator`/
// `uwGetSafe` are internal, non-exported same-module functions), and that stack's own concurrency
// ceiling is itself environment-sensitive: `effectiveMaxConcurrency()` divides
// `UW_GLOBAL_MAX_CONCURRENCY` (default 2) by `REPLICA_COUNT` whenever Redis is unavailable (as in
// any sandbox/CI run without a live Redis) — e.g. this very sandbox exports `REPLICA_COUNT=5`
// ambiently, which collapses the degraded local concurrency ceiling to 1 regardless of whether the
// caller dispatches its 3 tasks sequentially or pooled. Under a concurrency-1 ceiling, pooled and
// sequential dispatch are OBSERVATIONALLY IDENTICAL from outside (the shared semaphore itself
// forces serialization no matter how the caller scheduled its promises) — a timing assertion would
// therefore flip between RED and GREEN depending on an unrelated ambient env var, not on whether
// this fix is actually in place. The fix is a real, meaningful improvement wherever more than one
// concurrency slot is actually available (production, with Redis up, uses the real cluster-wide
// `UW_GLOBAL_MAX_CONCURRENCY` ceiling un-divided) — this test instead pins the concrete code shape
// that makes that true, so it stays both deterministic and still fails if someone reverts the fix
// or "fixes" it back to sequential for a seemingly unrelated reason.
test("fetchUwMacroIndicators: fans its indicators out through the pooled primitive, not the sequential one (source scan)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");
  assert.match(
    src,
    /function fetchUwMacroIndicators[\s\S]*?runUwPool\(/,
    "fetchUwMacroIndicators must fan its indicator fetches out through runUwPool so their rate-limiter admission waits can overlap instead of stacking serially (live-measured 2026-10-15: GDP+CPI sequential admission waits of 13.6s/17.3s inside one fetchDeskEnrichmentFields pass, coincident with that session's 40-43s ALB TargetResponseTime Max spikes)"
  );
  assert.doesNotMatch(
    src,
    /function fetchUwMacroIndicators[\s\S]*?runUwSequential\(/,
    "fetchUwMacroIndicators must not fall back to the sequential fan-out — see the block comment above the function for why stacking (not just slow upstream) was the live-measured root cause"
  );
});

// ── 0DTE flow-per-strike zero-cache poisoning (2026-10-14) ──────────────────────────────────
// WHY: live-confirmed SPX Slayer defect — flow_0dte_net flipped between a real multi-hundred-
// million value and exactly 0/0/0 every ~2 minutes (the flowPerStrike TTL), because a transient
// empty/degraded UW poll was cached verbatim and served as valid for the full TTL to every
// downstream reader (desk score factor, gate block, Largo's run-tool). isDegenerateFlowAggregate
// is the shared guard both fetchUwFlow0dte and the uw-cache-refresh cron now apply before caching.

test("isDegenerateFlowAggregate: true only when BOTH sides are exactly zero", () => {
  assert.equal(isDegenerateFlowAggregate({ call_premium: 0, put_premium: 0 }), true);
  assert.equal(isDegenerateFlowAggregate({ call_premium: 0, put_premium: 500 }), false);
  assert.equal(isDegenerateFlowAggregate({ call_premium: 500, put_premium: 0 }), false);
  assert.equal(isDegenerateFlowAggregate({ call_premium: -200, put_premium: 100 }), false);
});

test("fetchUwFlow0dte: a degenerate both-zero poll substitutes the prior real aggregate instead of serving zero", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  process.env.UW_API_KEY = "test-uw-key";
  delete process.env.REDIS_URL; // force the in-process-only path so every call reaches the mocked fetch directly

  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    const body =
      callCount === 1
        ? { data: [{ strike: 100, call_premium: "500000000", put_premium: "200000000" }] }
        : { data: [] }; // empty rows → aggregateFlowPerStrikeRows → {0, 0, 0}, the degenerate shape
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });

  try {
    const first = await fetchUwFlow0dte("FLOWZEROTEST");
    assert.equal(first.call_premium, 500_000_000);
    assert.equal(first.put_premium, 200_000_000);

    const second = await fetchUwFlow0dte("FLOWZEROTEST");
    assert.deepEqual(
      second,
      first,
      "a degenerate 0/0 poll must substitute the last real aggregate, never serve a bare zero over it"
    );
    assert.equal(callCount, 2, "both calls must have actually reached the upstream fetch (no Redis caching active)");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
  }
});

test("fetchUwFlow0dte: a genuinely degenerate FIRST poll (no prior good value yet) is served honestly as zero", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  process.env.UW_API_KEY = "test-uw-key";
  delete process.env.REDIS_URL;

  mock.method(globalThis, "fetch", async () => {
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  try {
    // Unique ticker — guaranteed no sticky value from another test could leak in.
    const result = await fetchUwFlow0dte("FLOWZEROCOLDSTART");
    assert.equal(result.call_premium, 0);
    assert.equal(result.put_premium, 0);
    assert.equal(result.net, 0, "with no prior good value to fall back to, an honest zero is correct — never fabricate one");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
  }
});

// ── NOPE net_delta: dead-field lookup, same bug class as `summarizeGroupGreekFlow`'s
// `net_delta`/`net_gamma` (#3290, 2026-09-02) ───────────────────────────────────────────────
// WHY: live-verified 2026-10-08 against the REAL UW `/api/stock/{t}/nope` response (SPY):
// `{"timestamp":"...","call_delta":"328598403.373379","put_delta":"-101025599.646208",
// "call_vol":...,"put_vol":...,"stock_vol":...,"call_fill_delta":"...","put_fill_delta":"...",
// "nope_fill":"0.268465","nope":"8.693712"}` — there is NO `net_delta` key anywhere on the row.
// `fetchUwNope` read `r.net_delta ?? 0`, so `net_delta` was ALWAYS exactly 0 on every real call —
// fabricating "perfectly balanced dealer delta flow" on a row that was actually ~+227.6M net-long
// (call_delta + put_delta). This feeds straight into `spx-desk.ts`'s `nope_net_delta` (SPX desk)
// AND directly into Largo's `get_nope` tool for every NON-SPX ticker (`run-tool.ts` calls
// `fetchUwNope(sym)` unmodified) — a member asking Largo about NOPE on any skewed-flow ticker
// would see a hard-coded 0, not a measured number.
test("fetchUwNope: computes net_delta from the REAL call_delta/put_delta fields, never the nonexistent `net_delta` key", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  process.env.UW_API_KEY = "test-uw-key";
  delete process.env.REDIS_URL; // force L1-only path, no live Redis needed

  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            timestamp: "2026-10-07T19:59:00Z",
            call_delta: "328598403.373379",
            put_delta: "-101025599.646208",
            call_vol: 5396919,
            put_vol: 6150926,
            stock_vol: 26176714,
            nope_fill: "0.268465",
            nope: "8.693712",
            // Deliberately NO `net_delta` key — matches the real upstream shape exactly.
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  try {
    const result = await fetchUwNope("NOPEDELTATEST");
    assert.ok(result, "expected a non-null row");
    assert.equal(result!.nope, 8.693712);
    // The real, honest computation: call_delta + put_delta (the same two signed inputs UW's own
    // `nope` is derived from) — NOT the fabricated 0 a dead `r.net_delta` lookup always produced.
    assert.ok(
      Math.abs(result!.net_delta! - 227572803.727171) < 0.01,
      `expected net_delta ≈ +227.57M (call_delta+put_delta), got ${result!.net_delta}`,
    );
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
  }
});

test("fetchUwNope: net_delta is null (not fabricated 0) when the row carries neither call_delta nor put_delta", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevRedis = process.env.REDIS_URL;
  process.env.UW_API_KEY = "test-uw-key";
  delete process.env.REDIS_URL;

  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ data: [{ timestamp: "2026-10-07T19:59:00Z", nope: "0" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  try {
    const result = await fetchUwNope("NOPEDELTATEST2");
    assert.ok(result, "expected a non-null row");
    assert.equal(result!.net_delta, null, "absence must stay absence, never fabricated as 0");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
  }
});

// Live-verified 2026-09-12: `/api/insider/transactions?ticker=X` silently ignores `ticker` (and
// `symbol`/`symbols`/`tickers`/`ticker_symbols`) and returns the unfiltered market-wide feed —
// the real per-ticker filter param is `ticker_symbol`. Pins the outgoing request shape so a future
// regression back to the wrong param name fails loudly here instead of silently mixing every
// ticker's dossier/Largo insider read with a random other ticker's transactions.
test("fetchUwInsiderTransactions: sends the real `ticker_symbol` filter param, not `ticker`", async () => {
  const prevKey = process.env.UW_API_KEY;
  process.env.UW_API_KEY = "test-uw-key";

  let capturedUrl = "";
  mock.method(globalThis, "fetch", async (input: string | URL) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ data: [{ ticker: "AAPL" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    await fetchUwInsiderTransactions("AAPL", 5);
    const params = new URL(capturedUrl).searchParams;
    assert.equal(params.get("ticker_symbol"), "AAPL", "must send the real filter param");
    assert.equal(params.get("ticker"), null, "must NOT send the guessed, silently-ignored param");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
  }
});

/* ── dark pool: a claim about the day requires that the day was looked at ──────────────── */

test("emptyDarkPoolSnapshot makes a definite claim — so it must be reserved for a real answer", () => {
  // The sentence asserts something about the whole trading day. Pinned here so it cannot be
  // reworded into something vaguer and quietly reused for the unknown case, which is exactly
  // the shape of the defect: the claim was reachable when nothing had been looked at.
  const s = emptyDarkPoolSnapshot();
  assert.equal(s.detail, "No large dark pool prints today");
  assert.deepEqual(s.prints, []);
  assert.equal(s.total_premium, 0);
  assert.equal(s.bias, "neutral");
  assert.equal(s.pcr, null);
});

test("darkPoolBias: zero typed (call+put) premium is 'neutral', never a fabricated 'mixed' verdict", () => {
  // ROOT CAUSE: dark-pool prints are UW EQUITY block trades, not options — verified live against
  // /api/darkpool/recent and /api/darkpool/{ticker} (2026-08-30): every row carries
  // ticker/price/size/premium/nbbo_bid/nbbo_ask/market_center/etc, and NEVER a type/option_type
  // field. So the caller's `optType` is always "", and call/put premium are always 0 for a real,
  // nonzero total — permanently, for every ticker. Before this fix, 0/0 fell through to
  // `Math.abs(call - put) < total * 0.15`, which is true for ANY positive total, and returned
  // "mixed" — a confident "measured, balanced institutional flow" claim computed from nothing.
  // That string reaches members verbatim (Meridian Earnings Intel panel: "$2.2M total · mixed"),
  // Night Hawk's dossier text ("bias mixed"), and Largo (`dark_pool_bias: "mixed"`).
  assert.equal(darkPoolBias(0, 0, 2_190_000), "neutral", "0/0 split over real premium must not read as measured-balanced");
  assert.equal(darkPoolBias(0, 0, 1), "neutral");

  // Genuinely typed premium must still classify normally — this guard must not swallow a real
  // measurement, only the zero-denominator fabrication above.
  assert.equal(darkPoolBias(700_000, 300_000, 1_000_000), "bullish"); // 70% call >= 65% threshold
  assert.equal(darkPoolBias(300_000, 700_000, 1_000_000), "bearish"); // 70% put >= 65% threshold
  assert.equal(darkPoolBias(520_000, 480_000, 1_000_000), "mixed");   // within 15% of even, genuinely measured
  assert.equal(darkPoolBias(0, 0, 0), "neutral");                     // pre-existing total<=0 branch, unaffected
});

test("fetchUwDarkPool returns null when the upstream never answered — it does not claim 'none today'", () => {
  // A SOURCE guard, because the decision lives inside a network- and Redis-bound closure that
  // cannot be exercised here. `uwGetSafe` never throws: it returns null when UW is unconfigured,
  // when the circuit is open with no stale cache, on a 403, and when retries are exhausted.
  // `extractRows(null)` is [], so without this guard "no answer" and "answered: none" were the
  // same object — and that object carries a positive claim about the day, which then gets cached.
  //
  // Measured on prod 2026-08-21: BEKE served `9 print(s) | $2.19M` at ~11:33 and ~11:53 ET, then
  // "No large dark pool prints today" from 12:25, stable across three reads. Executed prints do
  // not leave a session's tape, so 9 -> 0 cannot be true of the day.
  const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");
  const body = /export async function fetchUwDarkPool\(([\s\S]*?)\n}/.exec(src)?.[0] ?? "";
  assert.ok(body, "fetchUwDarkPool must exist");

  const guardAt = body.indexOf("if (data == null) return null;");
  const rowsAt = body.indexOf("extractRows(data)");
  assert.ok(guardAt > -1, "fetchUwDarkPool must return null when the upstream did not answer");
  assert.ok(rowsAt > -1, "fetchUwDarkPool must still parse rows when it did answer");
  assert.ok(
    guardAt < rowsAt,
    "the did-it-answer guard must come BEFORE extractRows — after it, null has already " +
      "collapsed into an empty array and the two cases are indistinguishable again"
  );
  // The claim must be reached only through the shared helper, never rebuilt inline next to a
  // path that can be entered without an answer.
  assert.match(body, /if \(!rows\.length\) return emptyDarkPoolSnapshot\(\);/);
  assert.doesNotMatch(body, /detail: "No large dark pool prints today"/, "the claim must have one home");
});

test("readUwCache: in-process UW L1 cache freshness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");
  assert.match(
    src,
    /function readUwCache[\s\S]*?isWsUpdatedAtFresh\(slot\.fetchedAt, ttl\)/,
    "readUwCache must reject clock-skewed future fetchedAt stamps for fresh hits"
  );
  assert.match(
    src,
    /function readUwCache[\s\S]*?isWsUpdatedAtFresh\(slot\.fetchedAt, UW_SLOW_CACHE_MAX_STALE_MS\)/,
    "readUwCache stale fallback must also reject future fetchedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /function readUwCache[\s\S]*?Date\.now\(\)\s*-\s*slot\.fetchedAt/,
    "raw Date.now()-fetchedAt must not gate UW in-process cache"
  );
});

/* ── uwGetSafe retry-budget guard ──────────────────────────────────────────────────────
 * WHY: uwGetSafe's retry loop had no total-elapsed-time budget — a call hitting repeated
 * transient failures could legitimately stack (retries + 1) attempts, each up to
 * trackedFetch's own 15s default timeout, plus exponential backoff between them, into a
 * ~48.5s worst case at the default retries=2. Nothing upstream actually cancels that loop:
 * dossierFetch's 8s Promise.race and fetchTickerDossierWithWall's 45s per-ticker wall both
 * give up on the CALLER's side while the loop keeps running orphaned, continuing to hold one
 * of throttleUw's GLOBAL_MAX_CONCURRENCY (default 2) slots — a ceiling shared by every UW
 * call across the whole app — and starving every other concurrent UW caller. Traced live on
 * production 2026-09-14: 6 of 14 raw Night Hawk Legacy candidates were dropped by the 45s
 * dossier wall the same night this pattern was live (see
 * docs/audit/findings-staging/2026-09-14-uw-retry-budget.md).
 *
 * Proves the loop stops SCHEDULING new attempts once `UW_GET_SAFE_MAX_RETRY_BUDGET_MS` (read
 * directly in milliseconds) would be exceeded by the UPCOMING backoff sleep, even though
 * `retries` (2) would otherwise still allow more.
 *
 * Deliberately does NOT mock the global `Date`/timers: this file's real `uwGetSafe` runs
 * through the REAL production admission path (`throttleUwCoalesced` → `acquireSlot` →
 * `QueueBudget`/token-bucket refill in uw-rate-limiter.ts), and those all measure real
 * elapsed time via `Date.now()` too. A frozen/fake clock that only jumps forward at one
 * controlled instant desyncs from those real `setTimeout`-driven loops — confirmed live
 * while writing this test: it hung for 3+ minutes (token-bucket "elapsed since last
 * refill" reads permanently ~0 against a clock that only moves when told to, so the local
 * admission spin never sees a refill and never sees its own queue-budget expire either,
 * since that budget is ALSO measured off the same frozen clock). Real timers avoid the
 * whole class of hazard: the mocked fetch itself sleeps a real, short, fixed duration
 * (80ms) LONGER than the configured budget (40ms) before failing, so the budget is
 * genuinely, deterministically spent by the time uwGetSafe's catch handler checks it —
 * no race on incidental scheduling overhead.
 */
test("uwGetSafe: stops retrying once its own retry-budget elapses, even with retries left", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevBudget = process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS;
  process.env.UW_API_KEY = "test-uw-key";
  process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS = "40";

  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    // Outlasts the 40ms budget on its own — attempt 0 alone spends the whole budget, so
    // attempt 1 must never be scheduled regardless of how fast/slow the rest of the
    // process happens to run.
    await new Promise((r) => setTimeout(r, 80));
    throw new Error("fetch failed"); // isUwTransientNetwork branch — retryable, no 429 breaker feed
  });

  try {
    const rows = await fetchUwInsiderTransactions("UWBUDGETTEST", 5);
    assert.deepEqual(rows, [], "no stale cache exists for this fresh ticker — must fall through to empty");
    assert.equal(
      fetchCount,
      1,
      "must NOT attempt a 2nd or 3rd call once the retry budget is spent, despite retries=2 allowing it"
    );
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevBudget === undefined) delete process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS;
    else process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS = prevBudget;
  }
});

/* Control: within budget, the existing retry+backoff behavior is unchanged — a transient
 * failure still gets `retries` attempts before falling through. Uses real backoff sleeps
 * (no mocked timers/Date at all — see the hang this caused above), so this is
 * intentionally slow (~3-4s) rather than instant; that's the cost of proving the guard
 * doesn't regress the normal case, not a flake. */
test("uwGetSafe: still exhausts all retries when comfortably within budget", async () => {
  const prevKey = process.env.UW_API_KEY;
  const prevBudget = process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS;
  process.env.UW_API_KEY = "test-uw-key";
  process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS = "60000"; // comfortably above the real backoff total

  let fetchCount = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    throw new Error("fetch failed");
  });

  try {
    const rows = await fetchUwInsiderTransactions("UWBUDGETTEST2", 5);
    assert.deepEqual(rows, []);
    assert.equal(fetchCount, 3, "default retries=2 means 3 total attempts when never budget-limited");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
    if (prevBudget === undefined) delete process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS;
    else process.env.UW_GET_SAFE_MAX_RETRY_BUDGET_MS = prevBudget;
  }
});

test("the Meridian shaper makes no claim when handed an unknown", () => {
  // The other half of the contract: the provider now returns null for "did not answer", and the
  // consumer must render that as silence rather than as a fact. It already did — the provider was
  // simply never giving it the chance.
  const unknown = shapeMeridianDarkPool(null);
  assert.equal(unknown.available, false);
  assert.equal(unknown.detail, null, "an unknown must not be described as an empty day");
  assert.deepEqual(unknown.top_prints, []);

  // ...and a genuine empty answer DOES carry the sentence through.
  const answered = shapeMeridianDarkPool(emptyDarkPoolSnapshot());
  assert.equal(answered.available, false);
  assert.equal(answered.detail, "No large dark pool prints today");
});
