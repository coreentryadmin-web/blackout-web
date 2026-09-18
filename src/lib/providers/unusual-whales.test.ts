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
  emptyDarkPoolSnapshot,
  darkPoolBias,
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
