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
  emptyDarkPoolSnapshot,
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
