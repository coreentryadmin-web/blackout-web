import test from "node:test";
import assert from "node:assert/strict";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  benzingaSurpriseToDisplayPct,
  classifyCalendarResult,
  loadWithEmptyAwareCache,
  buildRecentEarningsRevisions,
  computeEarningsYoY,
  dualBeatRateFromPrints,
  earningsWhenFromTime,
  overlayTimelineExpectedMoves,
  parseNextEarningsFromBenzinga,
  mergeEarningsTimelineSources,
  mergeStreetEstimates,
  pickEarningsCalendarRow,
  postPrintSurpriseLean,
} from "./meridian-benzinga-earnings-core.ts";

function bz(partial: Partial<BenzingaStructuredEarnings> & Pick<BenzingaStructuredEarnings, "ticker" | "date">) {
  return {
    benzinga_id: partial.benzinga_id ?? `${partial.ticker}:${partial.date}`,
    company_name: partial.company_name ?? partial.ticker,
    time: partial.time ?? null,
    date_status: partial.date_status ?? "confirmed",
    importance: partial.importance ?? 5,
    estimated_eps: partial.estimated_eps ?? null,
    estimated_revenue: partial.estimated_revenue ?? null,
    fiscal_period: partial.fiscal_period ?? "Q2",
    fiscal_year: partial.fiscal_year ?? 2026,
    actual_eps: partial.actual_eps ?? null,
    actual_revenue: partial.actual_revenue ?? null,
    eps_surprise: partial.eps_surprise ?? null,
    eps_surprise_pct: partial.eps_surprise_pct ?? null,
    revenue_surprise: partial.revenue_surprise ?? null,
    revenue_surprise_pct: partial.revenue_surprise_pct ?? null,
    previous_eps: partial.previous_eps ?? null,
    previous_revenue: partial.previous_revenue ?? null,
    eps_method: partial.eps_method ?? null,
    revenue_method: partial.revenue_method ?? null,
    currency: partial.currency ?? "USD",
    notes: partial.notes ?? null,
    last_updated: partial.last_updated ?? null,
    ...partial,
  } satisfies BenzingaStructuredEarnings;
}

test("earningsWhenFromTime buckets pre/post market", () => {
  assert.equal(earningsWhenFromTime("08:30:00"), "premarket");
  assert.equal(earningsWhenFromTime("16:20:00"), "afterhours");
  assert.equal(earningsWhenFromTime(null), null);
});

test("benzingaSurpriseToDisplayPct normalizes ratio to percent", () => {
  assert.equal(benzingaSurpriseToDisplayPct(0.0625), 6.3);
  assert.equal(benzingaSurpriseToDisplayPct(6.25), 6.3);
});

test("overlayTimelineExpectedMoves applies chain-IV expected move by ticker", () => {
  const rows = [
    {
      ticker: "NVDA",
      name: "NVIDIA",
      report_date: "2026-08-26",
      when: "afterhours" as const,
      expected_move_pct: null,
      source: "earnings_calendar" as const,
    },
  ];
  const em = new Map([["NVDA", 6.2]]);
  const out = overlayTimelineExpectedMoves(rows, em);
  assert.equal(out[0]?.expected_move_pct, 6.2);
});

test("parseNextEarningsFromBenzinga picks nearest upcoming print", () => {
  const next = parseNextEarningsFromBenzinga(
    "NVDA",
    [
      bz({ ticker: "NVDA", date: "2026-08-26", time: "16:20:00", date_status: "confirmed" }),
      bz({ ticker: "NVDA", date: "2026-05-01", actual_eps: 1.1 }),
    ],
    "2026-08-17"
  );
  assert.equal(next?.earnings_date, "2026-08-26");
  assert.equal(next?.days_until, 9);
  assert.equal(next?.report_time, "afterhours");
  assert.equal(next?.is_confirmed, true);
});

test("mergeEarningsTimelineSources overlays expected move on Benzinga row", () => {
  const merged = mergeEarningsTimelineSources(
    [bz({ ticker: "NVDA", company_name: "NVIDIA", date: "2026-08-26", time: "16:20:00" })],
    [
      {
        ticker: "NVDA",
        name: "NVDA",
        report_date: "2026-08-26",
        when: "afterhours",
        expected_move_pct: 6.2,
        source: "chain_iv",
      },
    ]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "NVIDIA");
  assert.equal(merged[0]?.expected_move_pct, 6.2);
  assert.equal(merged[0]?.report_time, "16:20");
});

test("mergeEarningsTimelineSources drops stale UW-only date when Benzinga confirmed differs", () => {
  const merged = mergeEarningsTimelineSources(
    [bz({ ticker: "NVDA", date: "2026-08-26", date_status: "confirmed" })],
    [
      {
        ticker: "NVDA",
        name: "NVDA",
        report_date: "2026-08-20",
        when: "afterhours",
        expected_move_pct: 5,
        source: "chain_iv",
      },
    ]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.report_date, "2026-08-26");
});

test("mergeStreetEstimates prefers Benzinga then UW tail", () => {
  const merged = mergeStreetEstimates(
    [bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 2.07, estimated_revenue: 9e10, fiscal_year: 2027 })],
    [{ period: "Q1 FY26", eps_estimate: 1.9, revenue_estimate: 8e10, source: "uw" }]
  );
  assert.equal(merged[0]?.source, "earnings_calendar");
  assert.equal(merged[0]?.eps_estimate, 2.07);
});

test("pickEarningsCalendarRow selects event date", () => {
  const row = pickEarningsCalendarRow(
    [bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 2.07, previous_eps: 1.04 })],
    "2026-08-26"
  );
  assert.equal(row?.estimated_eps, 2.07);
  assert.equal(row?.previous_eps, 1.04);
});

test("computeEarningsYoY from estimate vs prior", () => {
  const yoy = computeEarningsYoY(bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 1.2, previous_eps: 1.0 }));
  assert.equal(yoy?.eps_yoy_pct, 20);
});

test("dualBeatRateFromPrints grades eps and revenue beats", () => {
  const rates = dualBeatRateFromPrints([
    { report_date: "2026-05-01", beat: true, revenue_surprise_pct: 2, surprise_pct: 3 } as never,
    { report_date: "2026-02-01", beat: false, revenue_surprise_pct: -1, surprise_pct: -2 } as never,
  ]);
  assert.equal(rates.eps_beat_rate, 0.5);
  assert.equal(rates.revenue_beat_rate, 0.5);
});

test("postPrintSurpriseLean scores beat and miss", () => {
  const beat = postPrintSurpriseLean({
    is_printed: true,
    eps_surprise_pct: 4.2,
    revenue_surprise_pct: 1.1,
  } as never);
  assert.equal(beat.lean, "beat");
  assert.equal(beat.score, 2);

  const miss = postPrintSurpriseLean({
    is_printed: true,
    eps_surprise_pct: -3,
    revenue_surprise_pct: null,
  } as never);
  assert.equal(miss.lean, "miss");
  assert.equal(miss.score, -2);
});

test("buildRecentEarningsRevisions filters by last_updated window", () => {
  const rows = buildRecentEarningsRevisions(
    [
      bz({
        ticker: "META",
        date: "2026-08-20",
        last_updated: "2026-08-17T12:00:00Z",
        estimated_eps: 5.1,
      }),
      bz({
        ticker: "NVDA",
        date: "2026-08-26",
        last_updated: "2026-08-10T12:00:00Z",
        estimated_eps: 2.07,
      }),
    ],
    "2026-08-16T00:00:00Z"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ticker, "META");
});

/* ── Empty-aware caching ──────────────────────────────────────────────────────────────
 *
 * These exist because the bug they describe was invisible to every other test: it lived inside a
 * `server-only` module, so nothing could run it, and the symptom (blank earnings panels) looked
 * from the outside exactly like a company with no history.
 */

/** A cache with the one property the real one has and the logic depends on: throws are NOT stored. */
function fakeCache() {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  let now = 0;
  const cache = async <T,>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await load(); // a rejection propagates and stores nothing — as in server-cache
    store.set(key, { value, expiresAt: now + ttlMs });
    return value;
  };
  return { cache, advance: (ms: number) => { now += ms; }, size: () => store.size };
}

const OK_TTL = 600_000;
const EMPTY_TTL = 60_000;

function runner(results: Array<{ rows: unknown[]; error: string | null }>) {
  let calls = 0;
  const c = fakeCache();
  const run = () =>
    loadWithEmptyAwareCache({
      cache: c.cache,
      baseKey: "k",
      okTtlMs: OK_TTL,
      emptyTtlMs: EMPTY_TTL,
      fetchOnce: async () => {
        const r = results[Math.min(calls, results.length - 1)]!;
        calls += 1;
        return r;
      },
      onError: (message) => ({ rows: [], error: message }),
    });
  return { run, advance: c.advance, calls: () => calls };
}

test("classifyCalendarResult separates error from empty from ok", () => {
  assert.equal(classifyCalendarResult({ rows: [1], error: null }), "ok");
  assert.equal(classifyCalendarResult({ rows: [], error: null }), "empty");
  // An error WITH rows is still an error — a partial answer from a broken call is not an answer.
  assert.equal(classifyCalendarResult({ rows: [1], error: "boom" }), "error");
  assert.equal(classifyCalendarResult({}), "empty");
});

test("a good answer is served from cache and fetched only once", async () => {
  const r = runner([{ rows: [1, 2], error: null }]);
  assert.equal((await r.run()).rows.length, 2);
  assert.equal((await r.run()).rows.length, 2);
  // Two minutes: past the SHORT ttl, nowhere near the long one. Advancing by a multiple of
  // EMPTY_TTL would also clear the long layer if the two were ever set equal, and the test would
  // then pass under exactly the collapsed-lifetime behaviour it exists to rule out.
  r.advance(120_000);
  assert.equal((await r.run()).rows.length, 2);
  assert.equal(r.calls(), 1);
});

test("an EMPTY answer is held only for the short ttl, then retried", async () => {
  // This is the regression under test. Under the old single-TTL code the empty was cached for
  // the full ten minutes and every Benzinga-fed panel stayed blank until it expired.
  const r = runner([
    { rows: [], error: null },
    { rows: [1, 2, 3], error: null },
  ]);
  assert.equal((await r.run()).rows.length, 0);
  await r.run();
  assert.equal(r.calls(), 1, "within the short ttl the upstream is not hammered");

  // Same reasoning: a literal just past the short ttl, so this fails if the empty were being
  // held at the long lifetime.
  r.advance(61_000);
  const recovered = await r.run();
  assert.equal(recovered.rows.length, 3, "after the short ttl the empty is retried, not re-served");
  assert.equal(recovered.error, null);
});

test("an empty answer carries NO error — a name with no coverage is not an outage", async () => {
  const r = runner([{ rows: [], error: null }]);
  const res = await r.run();
  assert.equal(res.error, null);
  assert.deepEqual(res.rows, []);
});

test("a failed fetch carries its message out and is never cached as an answer", async () => {
  const r = runner([
    { rows: [], error: "upstream 500" },
    { rows: [9], error: null },
  ]);
  const bad = await r.run();
  assert.match(String(bad.error), /upstream 500/);

  // The failure must not have poisoned either layer once the short ttl lapses.
  r.advance(61_000);
  assert.equal((await r.run()).rows.length, 1);
});

test("the empty ttl is genuinely shorter than the ok ttl", () => {
  // Guards the constant relationship the whole design rests on: if these were ever set equal the
  // two layers would collapse back into the single-lifetime behaviour that caused the bug.
  assert.ok(EMPTY_TTL < OK_TTL);
});
