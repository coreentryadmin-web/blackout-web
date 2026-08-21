import test from "node:test";
import assert from "node:assert/strict";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  benzingaSurpriseToDisplayPct,
  benzingaTickerWindow,
  dedupeEarningsRowsByEvent,
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

/* ── dedupeEarningsRowsByEvent ────────────────────────────────────────────────────────
 * Guards the phantom-reversal defect: production served GRRR "EPS est 0.27 → 0.2" AND
 * "EPS est 0.2 → 0.27" in ONE payload because the same (ticker, date) was diffed twice.
 */

test("dedupeEarningsRowsByEvent collapses a repeated (ticker, date) to the freshest row", () => {
  const rows = [
    { ticker: "GRRR", date: "2026-08-20", estimated_eps: 0.27, last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "GRRR", date: "2026-08-20", estimated_eps: 0.2, last_updated: "2026-08-18T13:00:00Z" },
    { ticker: "HD", date: "2026-08-18", estimated_eps: 4.73, last_updated: "2026-08-18T10:00:39Z" },
  ];
  const out = dedupeEarningsRowsByEvent(rows);
  assert.equal(out.length, 2);
  const grrr = out.find((r) => r.ticker === "GRRR")!;
  // The 13:00 row wins — feeding BOTH to the diff is what manufactured the mirrored pair.
  assert.equal(grrr.estimated_eps, 0.2);
});

test("dedupeEarningsRowsByEvent keys case- and whitespace-insensitively on the ticker", () => {
  const out = dedupeEarningsRowsByEvent([
    { ticker: "grrr", date: "2026-08-20", last_updated: "2026-08-18T10:00:00Z" },
    { ticker: " GRRR ", date: "2026-08-20", last_updated: "2026-08-18T11:00:00Z" },
  ]);
  assert.equal(out.length, 1);
});

test("dedupeEarningsRowsByEvent slices a datetime date down to the calendar day", () => {
  const out = dedupeEarningsRowsByEvent([
    { ticker: "X", date: "2026-08-20", last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "X", date: "2026-08-20T16:00:00Z", last_updated: "2026-08-18T11:00:00Z" },
  ]);
  assert.equal(out.length, 1);
});

test("dedupeEarningsRowsByEvent keeps the FIRST row when timestamps tie or are unusable", () => {
  const tie = dedupeEarningsRowsByEvent([
    { ticker: "X", date: "2026-08-20", estimated_eps: 1, last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "X", date: "2026-08-20", estimated_eps: 2, last_updated: "2026-08-18T10:00:00Z" },
  ]);
  assert.equal(tie[0]!.estimated_eps, 1);

  // A row with no parseable timestamp must never displace one that has a real observation time.
  const junk = dedupeEarningsRowsByEvent([
    { ticker: "X", date: "2026-08-20", estimated_eps: 1, last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "X", date: "2026-08-20", estimated_eps: 2, last_updated: null },
  ]);
  assert.equal(junk[0]!.estimated_eps, 1);
});

test("dedupeEarningsRowsByEvent passes through rows it cannot key rather than dropping them", () => {
  // Silently discarding these would quietly shrink the diff input, which is the same class of
  // failure as the duplicate: the caller believes it fed the function everything it had.
  const out = dedupeEarningsRowsByEvent([
    { ticker: "", date: "2026-08-20", last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "X", date: "", last_updated: "2026-08-18T10:00:00Z" },
    { ticker: "Y", date: "2026-08-20", last_updated: "2026-08-18T10:00:00Z" },
  ]);
  assert.equal(out.length, 3);
});

test("dedupeEarningsRowsByEvent tolerates empty and nullish input", () => {
  assert.deepEqual(dedupeEarningsRowsByEvent([]), []);
  assert.deepEqual(dedupeEarningsRowsByEvent(null), []);
  assert.deepEqual(dedupeEarningsRowsByEvent(undefined), []);
});

test("benzingaTickerWindow: the lookback is DERIVED from the print count, never fixed", () => {
  // THE REGRESSION. The window was pinned at 420 days — about 4.6 quarters — while callers asked
  // for 6 (the pre-earnings card) and 8 (print history). Measured live 2026-08-21 against the old
  // window: NVDA returned 4 usable past prints, WMT 5, AAPL 5, BABA 5. Never the count requested.
  // Not a WRONG number — the summary states its real n — but a silently smaller sample, which
  // weakens every beat rate and average move computed over it.
  assert.ok(
    benzingaTickerWindow(6).lookbackDays > 420,
    "6 prints needs more than the old fixed 420-day window"
  );
  assert.ok(benzingaTickerWindow(8).lookbackDays > benzingaTickerWindow(6).lookbackDays);
  // ~91 days between quarterly prints; the window must clear that per print with slack.
  for (const n of [1, 4, 6, 8, 12]) {
    assert.ok(
      benzingaTickerWindow(n).lookbackDays >= n * 91,
      `${n} prints needs at least ${n * 91} days, got ${benzingaTickerWindow(n).lookbackDays}`
    );
  }
});

test("benzingaTickerWindow: the row cap covers the projected future tail, not just the prints", () => {
  // The response is sorted date.desc over a window spanning past AND future, and Benzinga
  // projects ~4-8 quarters ahead — those rows sit at the TOP of a desc sort and are consumed
  // before any past print is reached. A cap equal to the print count could never reach them.
  for (const n of [1, 6, 8]) {
    assert.ok(
      benzingaTickerWindow(n).limit >= n + 8,
      `cap ${benzingaTickerWindow(n).limit} leaves no room for the projected tail at n=${n}`
    );
  }
});

test("benzingaTickerWindow: clamps a nonsense count instead of requesting the world", () => {
  for (const bad of [0, -5, Number.NaN]) {
    const w = benzingaTickerWindow(bad as number);
    assert.ok(w.lookbackDays > 0 && Number.isFinite(w.lookbackDays));
    assert.ok(w.limit > 0);
  }
  assert.ok(benzingaTickerWindow(9999).limit <= 200, "cap must stay inside Benzinga's own ceiling");
  assert.ok(benzingaTickerWindow(9999).lookbackDays <= 24 * 95 + 60);
});
