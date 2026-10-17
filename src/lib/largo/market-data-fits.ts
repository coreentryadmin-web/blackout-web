// Fitting functions for multiple market data Largo tools that exceed 16k transport cap.
// Product-first design: all native data available to products; fitting applied only at Largo boundary.
import { fitRowsToBudget, fitEnvelopeToBudget } from "@/lib/largo/fit-tool-result";

// ============ get_market_oi_change ============
export interface OiChangeFittedResult {
  changes?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

// THIRD ROUND, switching strategy rather than re-guessing a smaller number again. #3155 shipped
// a 20-entry fixed cap ("should fit" off a sandbox estimate); live-truncated. #3159 re-measured
// and shipped 15; live-truncated again. #3162 cut to 8; live-truncated a THIRD time (probed
// 2026-08-29 22:15 UTC, post-deploy, ECS confirmed 8/8 tasks on that exact commit — not a
// propagation artifact). Three fixed-count guesses in one day, all wrong in the same direction,
// is a pattern: a static row count is a bet that some point-in-time entry-size measurement holds
// everywhere and always, and that bet keeps losing for reasons not fully pinned down (possibly
// larger real entries than any sandbox sample caught). `fitRowsToBudget` (fit-tool-result.ts,
// already used by get_earnings's related_news fix and by spx-structure-fit.ts) measures the
// ACTUAL serialized bytes at runtime instead of trusting an estimate, so it cannot go stale
// relative to its own measurement — this is the last time this comment should need updating.
export function fitMarketOiChangeForModel(raw: any[], maxShown = 20): { fitted: OiChangeFittedResult } {
  const rows = raw ?? [];
  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      changes: kept.length > 0 ? kept : undefined,
      shown: kept.length,
      truncated: total > kept.length,
      max_shown: maxShown,
    }),
    { maxRows: maxShown }
  );
  return { fitted: envelope as unknown as OiChangeFittedResult };
}

// ============ get_market_stats ============
export interface MarketStatsFittedResult {
  indices?: any;
  breadth?: any;
  shown: number;
  truncated: boolean;
}

export function fitMarketStatsForModel(raw: any): { fitted: MarketStatsFittedResult } {
  // Keep only core indices (SPY, SPX, QQQ, IWM, VIX) and breadth; shed extended stats
  const fitted: MarketStatsFittedResult = {
    shown: 1,
    truncated: false,
  };

  if (raw?.indices) {
    // Cap to major indices only
    const majorIndices = ["SPY", "SPX", "QQQ", "IWM", "VIX"];
    fitted.indices = typeof raw.indices === "object" && !Array.isArray(raw.indices)
      ? Object.fromEntries(
          Object.entries(raw.indices)
            .filter(([key]) => majorIndices.includes(key))
        )
      : raw.indices;
  }

  if (raw?.breadth) {
    fitted.breadth = raw.breadth;
  }

  return { fitted };
}

// ============ get_group_greek_flow ============
export interface GroupGreekFlowFittedResult {
  groups?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

export function fitGroupGreekFlowForModel(raw: any[], maxShown = 15): { fitted: GroupGreekFlowFittedResult } {
  const rows = raw ?? [];
  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      groups: kept.length > 0 ? kept : undefined,
      shown: kept.length,
      truncated: total > kept.length,
      max_shown: maxShown,
    }),
    { maxRows: maxShown }
  );
  return { fitted: envelope as unknown as GroupGreekFlowFittedResult };
}

// ============ get_group_greek_flow raw rows ============
// The un-summarized per-contract/per-ticker rows behind the group summary. MEASURED live
// (fetchUwGroupGreekFlow, 2026-08-29): group="mag7" (the tool's own default) returns 391 rows /
// ~277KB — 17x the 16k transport cap on its own, before anything else in the payload. Row-count
// caps here went 15 → 8, live-truncating both times — see fitMarketOiChangeForModel's comment
// for the full three-round history. Budget-bound now for the same reason.
export interface GroupGreekFlowRowsFittedResult {
  rows?: Record<string, unknown>[];
  rows_shown: number;
  rows_truncated: boolean;
  rows_max_shown: number;
}

export function fitGroupGreekFlowRowsForModel(
  raw: Record<string, unknown>[],
  maxShown = 15
): GroupGreekFlowRowsFittedResult {
  const rowsIn = raw ?? [];
  const { envelope } = fitEnvelopeToBudget(
    rowsIn,
    (kept, total) => ({
      rows: kept.length > 0 ? kept : undefined,
      rows_shown: kept.length,
      rows_truncated: total > kept.length,
      rows_max_shown: maxShown,
    }),
    { maxRows: maxShown }
  );
  return envelope as unknown as GroupGreekFlowRowsFittedResult;
}

// ============ get_screener ============
export interface ScreenerFittedResult {
  candidates?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

// MEASURED live (fetchUwScreenerStocks, 2026-08-29): ~1956 bytes/entry with technicals attached
// (the PR that shipped the first cap estimated ~300-400). Row-count caps here went
// 15 → 6 → 3, live-truncating every time — see fitMarketOiChangeForModel's comment for the full
// three-round history. Budget-bound now for the same reason.
export function fitScreenerForModel(raw: any[], maxShown = 15): { fitted: ScreenerFittedResult } {
  const rows = raw ?? [];
  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      candidates: kept.length > 0 ? kept : undefined,
      shown: kept.length,
      truncated: total > kept.length,
      max_shown: maxShown,
    }),
    { maxRows: maxShown }
  );
  return { fitted: envelope as unknown as ScreenerFittedResult };
}

// ============ vector gex-ladder (reached via call_internal_api, not a named tool) ============
// MEASURED TRUNCATED live 2026-08-31: GET /api/market/vector/gex-ladder?ticker=SPX&dte=0dte
// serialized to 18,858 chars raw (18,945 once call_internal_api's {ok,status,path,area,data}
// wrapper is added) — 118% of the 16k transport cap — at 200 rows (buildGexLadder's own default
// `maxRows`, vector-gex-ladder.ts). Because `ladder.rows` serializes BEFORE `ladder.maxAbs` (the
// per-row magnitude normaliser every bar's width/intensity depends on) and before the top-level
// `depth`/`depthSpot` fields, a raw tail-cut (`raw.slice(0, MAX_TOOL_RESULT_CHARS)`,
// anthropic.ts) drops those trailing fields entirely, plus every row past the cut point (SPX
// 2026-08-31: everything below strike 7325, roughly a third of the ladder including its most
// negative put wall).
//
// This route was invisible to every prior truncation fix and to largo-truncation-probe.mjs's
// sweep: it is not itself a Largo tool with a fixed argument recipe (LANE_TOOLS) — Largo reaches
// it generically through `call_internal_api`, whose only argument is an arbitrary `path` string
// (route-registry.ts class:"read"). Same bug class as #2433/#2436/#2480 (get_zerodte_record,
// get_nighthawk_edition, get_nighthawk_outcomes), on a delivery path none of those three audits,
// or the probe built after them, could see — see the findings-staging entry for this fix.
//
// Fix mirrors the rest of this file: budget-bound (fitEnvelopeToBudget), not a fixed row count —
// see fitMarketOiChangeForModel's comment above for why a fixed count is the wrong shape here.
// Row PRIORITY (not array order) decides what survives: the crowned king per side (`isKing`) is
// kept first — it is the single most load-bearing row, the exact strike the banner/chart/desk
// terminal all cite — then remaining rows nearest spot. The route's own array order is DESCENDING
// BY STRIKE, so a naive head-first budget cut would silently keep only the far-OTM top of the
// chain and lose spot's own neighbourhood entirely.
export interface GexLadderFittedResult {
  [key: string]: unknown;
  ladder: {
    [key: string]: unknown;
    rows: Array<Record<string, unknown>>;
  };
  rows_shown: number;
  rows_total: number;
  rows_truncated: boolean;
}

export function fitGexLadderForModel(raw: Record<string, unknown>): GexLadderFittedResult {
  const ladder = (raw?.ladder && typeof raw.ladder === "object" ? raw.ladder : {}) as Record<string, unknown>;
  const rows = Array.isArray(ladder.rows) ? (ladder.rows as Array<Record<string, unknown>>) : [];
  const spot =
    typeof ladder.spot === "number" ? ladder.spot : typeof raw?.spot === "number" ? (raw.spot as number) : null;

  const prioritized = [...rows].sort((a, b) => {
    const ak = a.isKing ? 0 : 1;
    const bk = b.isKing ? 0 : 1;
    if (ak !== bk) return ak - bk;
    if (spot == null) return 0;
    return Math.abs(Number(a.strike) - spot) - Math.abs(Number(b.strike) - spot);
  });

  const shell = (kept: Array<Record<string, unknown>>, total: number) => ({
    ...raw,
    ladder: {
      ...ladder,
      // Re-sort the kept rows back to the route's own display order (descending strike) so a
      // partial ladder still reads top-to-bottom like the full one, rather than in priority order.
      rows: [...kept].sort((a, b) => Number(b.strike) - Number(a.strike)),
    },
    rows_shown: kept.length,
    rows_total: total,
    rows_truncated: total > kept.length,
  });

  const { envelope } = fitEnvelopeToBudget(prioritized, shell);
  return envelope as unknown as GexLadderFittedResult;
}

export type GroupGreekFlowToolResult = {
  group: string;
  expiry?: string;
  source: string;
  note: string;
  rows?: Record<string, unknown>[];
  rows_shown: number;
  rows_truncated: boolean;
  rows_max_shown: number;
  summary: unknown;
};

/** Budget the FULL get_group_greek_flow return — rows plus summary/metadata/note. */
export function fitGroupGreekFlowToolResultForModel(input: {
  group: string;
  expiry?: string;
  source: string;
  note: string;
  summary: unknown;
  rows: Record<string, unknown>[];
  maxRows?: number;
}): GroupGreekFlowToolResult {
  const maxRows = input.maxRows ?? 15;
  const shell = (kept: Record<string, unknown>[], total: number) => ({
    group: input.group,
    expiry: input.expiry,
    source: input.source,
    note: input.note,
    rows: kept.length > 0 ? kept : undefined,
    rows_shown: kept.length,
    rows_truncated: total > kept.length,
    rows_max_shown: maxRows,
    summary: input.summary,
  });
  const { envelope } = fitEnvelopeToBudget(input.rows ?? [], shell, { maxRows });
  return envelope as unknown as GroupGreekFlowToolResult;
}

// ============ get_options_flow (non-SPX, per-ticker branch) ============
// MEASURED TRUNCATED live 2026-10-17 (CloudWatch /ecs/blackout-production, `[largo] tools:`
// log line): `get_options_flow 418ms TRUNCATED 33210/16000` — less than half the tool's own
// serialized answer survived the transport's raw tail-cut. Root cause is the same shape as
// every other fix in this file: the per-ticker branch of `get_options_flow` (run-tool.ts)
// returns TWO independently-sized raw row arrays — `flow_alerts` (up to 50 UW flow-alert rows)
// and `flow_recent` (up to 100 recent-trade rows) — neither budget-checked, so a single
// moderately-active ticker's raw UW pages alone exceed the 16k cap before the model ever sees
// the aggregates (`alert_premium`, `bias`, `strike_stacks`) that are this tool's actual answer.
// Fix follows this file's established shape: aggregates/metadata first (so a future cap hit
// eats the row sample, never the answer), both row fields budget-fit via `fitRowsToBudget`
// sequentially against the SAME running base object (so the combined serialized size — not
// either array's size alone — is what gets measured against the cap), each with its own honest
// shown/truncated/total trio. The SPX branch of this same tool (spx_sniper_desk source, a
// separate code path in run-tool.ts) is NOT touched here — its `flow_alerts`/`unified_tape`
// come from the live desk object and `unified_tape` is already row-capped at 20; it was not the
// measured truncation and widening this fix to cover it on no measured evidence would repeat
// the exact mistake fitMarketOiChangeForModel's own comment above documents (a fix sized to a
// guess, not evidence) — tracked as a follow-up to verify separately, not fixed speculatively.
export interface OptionsFlowFittedResult {
  ticker: string;
  source: string;
  note: string;
  window_hours: number | null;
  helix_session_alerts: number;
  intraday_0dte: unknown;
  alert_premium: { calls: number; puts: number; net: number };
  bias: string;
  strike_stacks: unknown;
  flow_alerts?: Record<string, unknown>[];
  flow_alerts_shown: number;
  flow_alerts_total: number;
  flow_alerts_truncated: boolean;
  flow_recent?: Record<string, unknown>[];
  flow_recent_shown: number;
  flow_recent_total: number;
  flow_recent_truncated: boolean;
}

export function fitOptionsFlowForModel(
  input: {
    ticker: string;
    source: string;
    note: string;
    window_hours: number | null;
    helix_session_alerts: number;
    intraday_0dte: unknown;
    alert_premium: { calls: number; puts: number; net: number };
    bias: string;
    strike_stacks: unknown;
    flow_alerts: Record<string, unknown>[];
    flow_recent: Record<string, unknown>[];
  },
  maxEach = 30
): OptionsFlowFittedResult {
  // Aggregates + metadata FIRST — the tool's actual answer — so the row samples are what a
  // future cap hit eats, never these fields. Measured against the budget below via the running
  // `base` object, so `strike_stacks` (the costliest metadata field) is already accounted for
  // before either row array gets a single entry.
  const base: Record<string, unknown> = {
    ticker: input.ticker,
    source: input.source,
    note: input.note,
    window_hours: input.window_hours,
    helix_session_alerts: input.helix_session_alerts,
    intraday_0dte: input.intraday_0dte,
    alert_premium: input.alert_premium,
    bias: input.bias,
    strike_stacks: input.strike_stacks,
  };

  const alertsFit = fitRowsToBudget(base, "flow_alerts", input.flow_alerts ?? [], { maxRows: maxEach });
  // flow_recent is fit against base WITH the now-kept flow_alerts already included, so its
  // budget check measures the true combined size rather than re-spending the same headroom
  // flow_alerts already used.
  const baseWithAlerts = { ...base, flow_alerts: alertsFit.kept };
  const recentFit = fitRowsToBudget(baseWithAlerts, "flow_recent", input.flow_recent ?? [], { maxRows: maxEach });

  return {
    ...base,
    flow_alerts: alertsFit.kept.length > 0 ? alertsFit.kept : undefined,
    flow_alerts_shown: alertsFit.kept.length,
    flow_alerts_total: alertsFit.total,
    flow_alerts_truncated: alertsFit.total > alertsFit.kept.length,
    flow_recent: recentFit.kept.length > 0 ? recentFit.kept : undefined,
    flow_recent_shown: recentFit.kept.length,
    flow_recent_total: recentFit.total,
    flow_recent_truncated: recentFit.total > recentFit.kept.length,
  } as OptionsFlowFittedResult;
}

// ============ get_earnings related_news ============
// MEASURED TRUNCATED live 2026-08-29 (largo-truncation-probe.mjs, control PROVEN, truncation
// point reported at `related_news`). `fetchBenzingaEarnings(sym, 15)` returns up to 15 news
// items, each carrying `body` (up to 2000 chars) + `teaser` (up to 400 chars) + title/url/
// author/tickers/channels/tags (fetchBenzingaNews, providers/polygon.ts) — up to ~37KB for the
// field on its own, more than double the 16k transport cap before the structured earnings
// calendar/history/estimates fields (the tool's actual primary answer, per its own header
// comment) are even reached. This field is explicitly SECONDARY — "stories mentioning this
// ticker in the earnings channel, NOT its own results" — so `body` is dropped entirely
// regardless of budget (never needed for a headline-level mention) and `teaser` is trimmed
// further, before the remaining, already-small rows go through `fitRowsToBudget` rather than a
// bare row-count cap. WHY A BUDGET BOUND, NOT A FIXED COUNT: a companion same-day fix
// (#3159/market-data-fits.ts) originally capped get_market_oi_change/get_screener/
// get_group_greek_flow to a fixed row count sized off a one-time sandbox measurement of average
// entry bytes — deployed, all three were STILL live-truncated (see #3162's follow-up fix). A
// fixed count is a bet that a point-in-time entry-size measurement holds everywhere and always;
// `fitRowsToBudget` measures the actual serialized bytes at runtime instead, so it cannot go
// stale relative to its own measurement.
export interface EarningsRelatedNewsFittedResult {
  related_news: Array<{ title: string; teaser: string; published: string; url: string }>;
  related_news_shown: number;
  related_news_truncated: boolean;
  related_news_max_shown: number;
}

export function fitEarningsRelatedNewsForModel(
  raw: Array<Record<string, unknown>>,
  maxShown = 5,
  /** Sibling fields already decided for this turn's get_earnings envelope (print_history,
   *  next_report, …) — measured ALONGSIDE related_news so its own truncated flag is honest about
   *  how much room was actually left, rather than measuring related_news in isolation. Defaults to
   *  `{}` so every existing caller/test is unaffected. */
  base: Record<string, unknown> = {}
): EarningsRelatedNewsFittedResult {
  const trimmed = (raw ?? []).map((a) => ({
    title: String(a.title ?? ""),
    teaser: String(a.teaser ?? "").slice(0, 200),
    published: String(a.published ?? ""),
    url: String(a.url ?? ""),
  }));
  const { kept, total } = fitRowsToBudget(base, "related_news", trimmed, { maxRows: maxShown });
  return {
    related_news: kept,
    related_news_shown: kept.length,
    related_news_truncated: total > kept.length,
    related_news_max_shown: maxShown,
  };
}

// ============ get_earnings unusual_whales (UW raw quarterly earnings history) ============
// MEASURED live 2026-10-17 (this session's CloudWatch sweep found `get_earnings` TRUNCATED at
// 83506/16000 and 90305/16000 chars — both the related_news fix above and the budget this file's
// own header documents were already shipped, so neither explains an overflow of that size).
// Root cause: `fetchUwEarnings(sym)` (unusual-whales.ts) returns EVERY quarter UW has on file with
// no slice/limit at all — unlike every sibling UW fetcher in that file (fetchUwScreenerStocks,
// fetchUwUnusualTrades, fetchUwOptionContractFlow all cap their own result). Measured live against
// the real endpoint: NVDA 107 rows / ~70.6KB, AAPL ~80.9KB, TSLA ~47.5KB — several times the
// entire 16k transport cap on this ONE field alone, merged into get_earnings's envelope completely
// unfit (`unusual_whales: uw` in run-tool.ts). This data is also the LOWEST-value earnings source
// per get_earnings's own precedence comment ("the structured feed is primary... the news channel
// is not") — it exists only as a last-resort `source` label when Benzinga structured+news are both
// empty, and print_history (Benzinga, reaction-aware, already capped to 6) already covers the
// model's real need for historical prints. Fit it like every other list field in this module.
export interface EarningsUwHistoryFittedResult {
  unusual_whales: Array<Record<string, unknown>>;
  unusual_whales_shown: number;
  unusual_whales_truncated: boolean;
}

export function fitEarningsUwHistoryForModel(
  base: Record<string, unknown>,
  raw: Array<Record<string, unknown>>,
  maxShown = 8
): EarningsUwHistoryFittedResult {
  const { kept, total } = fitRowsToBudget(base, "unusual_whales", raw ?? [], { maxRows: maxShown });
  return {
    unusual_whales: kept,
    unusual_whales_shown: kept.length,
    unusual_whales_truncated: total > kept.length,
  };
}

// ============ get_earnings estimates (UW forward consensus) ============
// MEASURED live 2026-10-17: `fetchUwEarningsEstimates(sym)` → `extractRows(data)` cannot unwrap
// UW's `{ ticker, estimates: [...] }` response shape (the "estimates" key isn't in extractRows's
// recognized-wrapper list), so it falls through to extractRows's single-row fallback and returns
// the ENTIRE response as one opaque row. Measured consistently ~16KB regardless of ticker (NVDA
// 15.96KB, AAPL 16.07KB, TSLA 16.01KB, META 16.05KB, GOOG 16.12KB) — already over this module's
// own budget before anything else in get_earnings is counted, and merged in (`estimates`)
// completely unfit. Since it is one indivisible row (not a flat list this module can shorten),
// fitting it can only ever be all-or-nothing — but that is still real protection: if the fields
// decided before it have already consumed the budget, this drops the whole thing with an honest
// `estimates_truncated: true` instead of silently blowing the transport cap.
export interface EarningsEstimatesFittedResult {
  estimates: Array<Record<string, unknown>>;
  estimates_shown: number;
  estimates_truncated: boolean;
}

export function fitEarningsEstimatesForModel(
  base: Record<string, unknown>,
  raw: Array<Record<string, unknown>>
): EarningsEstimatesFittedResult {
  const { kept, total } = fitRowsToBudget(base, "estimates", raw ?? []);
  return {
    estimates: kept,
    estimates_shown: kept.length,
    estimates_truncated: total > kept.length,
  };
}

// ============ get_etf_flow in_outflow / etf_tide ============
// MEASURED TRUNCATED live 2026-10-17 (`get_etf_flow TRUNCATED 224052/16000`). Both
// `fetchUwEtfInOutflow` and `fetchUwEtfTide` (unusual-whales.ts) pass the raw UW response straight
// through via `uwGetSafe<unknown>` with no row limit of any kind, and `get_etf_flow` (run-tool.ts)
// merged both in with zero fitting. Measured live against the real endpoints: `in-outflow` carries
// ~721 DAILY rows (years of history, ~144 bytes/row, up to 225KB for IWM) and `etf-tide` carries
// ~390 INTRADAY ticks for a single session (~150 bytes/row, 58-70KB) — a trader asking about ETF
// flow needs a recent window of either, not the full history.
//
// THE TWO SERIES SORT IN OPPOSITE DIRECTIONS — verified live, not assumed: `in-outflow` is
// newest-first (today, yesterday, ...), `etf-tide` is oldest-first (market open -> now), because
// one is a daily history and the other is today's own intraday walk. Naively keeping "the first N"
// of both would silently show the STALEST slice of the one series the model most wants the LATEST
// reading from (today's tide), so this function reverses an oldest-first series before fitting —
// "most recent" always means the same thing to the caller regardless of which way UW sorted it.
export interface EtfSeriesFittedResult {
  data?: Array<Record<string, unknown>>;
  data_shown: number;
  data_total: number;
  data_truncated: boolean;
}

export function fitEtfSeriesForModel(
  raw: unknown,
  base: Record<string, unknown>,
  { maxShown = 30, newestFirst = true }: { maxShown?: number; newestFirst?: boolean } = {}
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return (raw ?? {}) as Record<string, unknown>;
  const { data, ...rest } = raw as Record<string, unknown> & { data?: unknown };
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const ordered = newestFirst ? rows : [...rows].reverse();
  const { kept, total } = fitRowsToBudget({ ...base, ...rest }, "data", ordered, { maxRows: maxShown });
  return {
    ...rest,
    data: kept.length > 0 ? kept : undefined,
    data_shown: kept.length,
    data_total: total,
    data_truncated: total > kept.length,
  };
}
