# Polygon Stocks API Audit
Last updated: 2026-06-30 (automated)

> **Provider note.** Polygon.io now redirects to **massive.com** — Polygon was rebranded/acquired as
> Massive. Our `POLYGON_API_BASE` defaults to `https://api.massive.com` and the WS to
> `wss://socket.massive.com/indices`. The REST surface is byte-for-byte Polygon-shaped, so this audit
> treats the official Polygon/Massive Stocks catalog as ground truth and maps it to our actual calls.
> All REST goes through the single funnel `polygonTrackedFetch` (token bucket + cluster 429 breaker) in
> [polygon-rate-limiter.ts](src/lib/providers/polygon-rate-limiter.ts).

> **Staleness caught.** The committed catalog `src/lib/docs-usage-summary.json` (generated 2026-06-18)
> marks Financials (income/balance/cash-flow/ratios), Daily Market Summary, IPOs, Splits & Dividends as
> **unused**. That is no longer true — the current code calls all of them. This report is grounded in a
> live grep of `src/`, not that snapshot. Recommend regenerating `docs-usage-summary.json`.

## Summary
- Total Stocks REST endpoints available: **44**
- Total Stocks WS channels available: **7** (T, Q, A, AM, FMV, NOI, LULD)
- Currently using (REST): **29 / 44**
- Currently using (WS, Stocks asset class): **0 / 7**  *(we run a separate **Indices** WS — `A.` + `V.` on `I:SPX`/`I:VIX`/… via [polygon-socket.ts](src/lib/ws/polygon-socket.ts) — but no Stocks-cluster channel)*
- High-value unused: **3** (Ticker Events; Stocks WS aggregates for the breadth universe; Net Order Imbalance at the close)

## REST Endpoints

| Endpoint | Status | File:Line | Notes |
|---|---|---|---|
| `/v2/aggs/ticker/{t}/range/{m}/{span}/{from}/{to}` (Custom Bars) | USED | [polygon.ts:703](src/lib/providers/polygon.ts#L703), [712](src/lib/providers/polygon.ts#L712), [726](src/lib/providers/polygon.ts#L726), [735](src/lib/providers/polygon.ts#L735); [polygon-largo.ts:50](src/lib/providers/polygon-largo.ts#L50) | minute/5-min/day bars for index & stock; Largo multi-timeframe |
| `/v2/aggs/ticker/{t}/prev` (Previous Day Bar) | USED | [polygon-largo.ts:59](src/lib/providers/polygon-largo.ts#L59) | `fetchPreviousDayBar` |
| `/v2/aggs/grouped/locale/us/market/stocks/{date}` (Daily Market Summary) | USED | [polygon.ts:209](src/lib/providers/polygon.ts#L209) | full-market breadth (A/D, %>VWAP, leaders) |
| `/v1/open-close/{t}/{date}` (Daily Ticker Summary) | USED | [polygon-largo.ts:334](src/lib/providers/polygon-largo.ts#L334) | `fetchOpenClose` |
| `/v2/snapshot/locale/us/markets/stocks/tickers/{t}` (Single Snapshot) | USED | [polygon.ts:114](src/lib/providers/polygon.ts#L114) | `fetchStockSnapshot` |
| `/v2/snapshot/locale/us/markets/stocks/tickers` (Full/multi Snapshot) | USED | [polygon.ts:137](src/lib/providers/polygon.ts#L137), [157](src/lib/providers/polygon.ts#L157); [gap-proxy.ts:25](src/lib/providers/gap-proxy.ts#L25) | batch leaders + sector ETFs (breadth/SectorThermal) |
| `/v2/snapshot/locale/us/markets/stocks/{gainers\|losers}` (Top Movers) | USED | [polygon.ts:306](src/lib/providers/polygon.ts#L306), [309](src/lib/providers/polygon.ts#L309) | Grid Movers panel |
| `/v2/last/trade/{t}` (Last Trade) | USED | [polygon-largo.ts:327](src/lib/providers/polygon-largo.ts#L327) | `fetchStockLastTrade` |
| `/v2/last/nbbo/{t}` (Last Quote) | USED | [polygon-largo.ts:321](src/lib/providers/polygon-largo.ts#L321) | `fetchStockLastNbbo` |
| `/v3/trades/{stockTicker}` (Trades, tick-level) | **UNUSED** | — | `/v3/trades` is used for **options** only ([option-trades.ts:256](src/lib/providers/option-trades.ts#L256)); no stock-tape pull |
| `/v3/quotes/{stockTicker}` (Quotes, tick-level NBBO history) | **UNUSED** | — | no historical stock-quote pull |
| `/v1/indicators/sma/{t}` | USED | [polygon.ts:1267](src/lib/providers/polygon.ts#L1267); [polygon-largo.ts:141](src/lib/providers/polygon-largo.ts#L141) | |
| `/v1/indicators/ema/{t}` | USED | [polygon.ts:762](src/lib/providers/polygon.ts#L762), [1248](src/lib/providers/polygon.ts#L1248); [polygon-largo.ts:130](src/lib/providers/polygon-largo.ts#L130) | |
| `/v1/indicators/macd/{t}` | USED | [polygon-largo.ts:96](src/lib/providers/polygon-largo.ts#L96) | |
| `/v1/indicators/rsi/{t}` | USED | [polygon.ts:773](src/lib/providers/polygon.ts#L773), [1306](src/lib/providers/polygon.ts#L1306); [polygon-largo.ts:119](src/lib/providers/polygon-largo.ts#L119) | |
| `/v3/reference/tickers` (All Tickers / search) | USED | [polygon-largo.ts:382](src/lib/providers/polygon-largo.ts#L382) | ticker search box |
| `/v3/reference/tickers/{t}` (Ticker Overview) | USED | [polygon-largo.ts:152](src/lib/providers/polygon-largo.ts#L152) | `fetchPolygonTickerDetails` |
| `/v3/reference/tickers/{t}/related` (Related Tickers) | USED | [polygon-largo.ts:358](src/lib/providers/polygon-largo.ts#L358) | canonical Polygon path is `/v1/related-companies/{t}` — verify this alias still resolves on Massive |
| `/v3/reference/tickers/types` (Ticker Types) | **UNUSED** | — | low priority |
| `/v3/reference/dividends` (Dividends) | USED | [polygon-largo.ts:429](src/lib/providers/polygon-largo.ts#L429) | Polygon now flags this path "deprecated" in favor of `/stocks/v1/dividends` |
| `/v3/reference/splits` (Splits) | USED | [polygon-largo.ts:453](src/lib/providers/polygon-largo.ts#L453) | deprecated path; newer is `/stocks/v1/splits` |
| `/vX/reference/ipos` (IPOs) | USED | [polygon-largo.ts:478](src/lib/providers/polygon-largo.ts#L478) | IPO calendar |
| `/vX/reference/tickers/{id}/events` (Ticker Events) | **UNUSED** | — | **high-value** — symbol changes / M&A timeline |
| `/stocks/financials/v1/income-statements` | USED | [polygon.ts:958](src/lib/providers/polygon.ts#L958) | Night Hawk fundamentals |
| `/stocks/financials/v1/balance-sheets` | USED | [polygon.ts:990](src/lib/providers/polygon.ts#L990) | |
| `/stocks/financials/v1/cash-flow-statements` | USED | [polygon.ts:1021](src/lib/providers/polygon.ts#L1021) | |
| `/stocks/financials/v1/ratios` | USED | [polygon.ts:851](src/lib/providers/polygon.ts#L851) | valuation/leverage/liquidity |
| `/stocks/v1/float` | USED | [polygon-largo.ts:365](src/lib/providers/polygon-largo.ts#L365) | `fetchStockFloat` |
| `/stocks/v1/short-interest` | USED | [polygon.ts:786](src/lib/providers/polygon.ts#L786) | bi-weekly short interest |
| `/stocks/v1/short-volume` | USED | [polygon.ts:1189](src/lib/providers/polygon.ts#L1189) | daily ATS short volume |
| `/v3/reference/conditions` (Condition Codes) | **UNUSED** | — | only needed if we adopt `/v3/trades` or `/v3/quotes` |
| `/v3/reference/exchanges` (Exchanges) | **UNUSED** | — | low priority (decode trade/quote exchange IDs) |
| `/v1/marketstatus/now` (Market Status) | USED | [polygon.ts:1380](src/lib/providers/polygon.ts#L1380); [admin-api-dashboard.ts:145](src/lib/admin-api-dashboard.ts#L145) | cached 60s |
| `/v1/marketstatus/upcoming` (Market Holidays) | USED | [polygon-largo.ts:338](src/lib/providers/polygon-largo.ts#L338) | `fetchMarketUpcomingStatus` |
| `/v2/reference/news` (News) | USED | [polygon-largo.ts:158](src/lib/providers/polygon-largo.ts#L158), [342](src/lib/providers/polygon-largo.ts#L342) | Polygon news + insights |
| `/benzinga/v2/news` (Benzinga, Massive extension) | USED | [polygon.ts:403](src/lib/providers/polygon.ts#L403) | catalysts/analyst PT/earnings — not in core Polygon Stocks docs |
| Filings: `/stocks/filings/vX/index`, `10-K/vX/sections`, `8-K/vX/text`, `vX/13-F`, `vX/risk-factors`, `vX/form-3`, `vX/form-4`, `taxonomies/vX/risk-factors` | **UNUSED** | — | entire SEC filings suite unused; plan entitlement unverified |

*(Indices crossover: `/v3/snapshot/indices` ([polygon.ts:358](src/lib/providers/polygon.ts#L358)) powers SPX/VIX — counted under the Indices audit, not Stocks.)*

## WebSocket Channels

| Channel | Event | Status | Notes |
|---|---|---|---|
| Trades | `T.*` | **UNUSED** | no stock tape stream |
| Quotes | `Q.*` | **UNUSED** | no NBBO stream |
| Aggregates / second | `A.*` | **UNUSED (stocks)** | we run `A.` only on the **Indices** cluster (`A.I:SPX`…) at [polygon-socket.ts:311](src/lib/ws/polygon-socket.ts#L311) |
| Aggregates / minute | `AM.*` | **UNUSED** | — |
| Fair Market Value | `FMV.*` | **UNUSED** | Business-plan-only |
| Net Order Imbalance | `NOI.*` | **UNUSED** | MOC/MOO imbalance at the close — see recommendations |
| Limit Up / Limit Down | `LULD.*` | **UNUSED** | halt/limit events; UW `trading_halts` partly overlaps |

Our only live socket for this provider is the **indices** feed (`wss://socket.massive.com/indices`,
channels `A.` + `V.`), with cross-replica Redis leader election (one WS per API key). No Stocks-cluster
socket is opened anywhere in the codebase.

## High-Value Unused Endpoints

1. **Ticker Events — `/vX/reference/tickers/{id}/events`** *(complexity: LOW)*
   Timeline of symbol changes, CUSIP/FIGI continuity, and M&A for a ticker. **Benefits Night Hawk &
   watchlists:** dossiers and stored outcomes silently break when a ticker is renamed/merged (e.g.
   FB→META). A low-frequency reference call (cache REFERENCE TTL) keyed per symbol prevents stale/dead
   tickers from poisoning the evening scan and historical play records.

2. **Stocks WS aggregates — `A.`/`AM.` on the breadth universe** *(complexity: MEDIUM; plan-gated)*
   Today `SectorThermal`, breadth, and Grid Movers poll `/v2/snapshot/.../tickers` on a timer. A
   per-second/minute stocks aggregate stream for the ~17 leaders + sector ETFs would cut REST snapshot
   polling and give push-latency sector rotation. The hard parts (single-WS-per-key, leader election,
   stall watchdog) are **already solved** for indices in [polygon-socket.ts](src/lib/ws/polygon-socket.ts)
   and can be cloned for a `/stocks` cluster. **Gate:** requires a real-time **Stocks** WS entitlement —
   we only demonstrably have Indices + Options sockets today (verify before building).

3. **Net Order Imbalance — `NOI.*` (WS)** *(complexity: MEDIUM; likely Business-tier)*
   Real-time MOC/MOO imbalance events. **Benefits the power-hour engine** ([spx-power-hour-engine.ts](src/lib/spx-power-hour-engine.ts)):
   the 3:50pm closing-auction imbalance is a genuine directional tell for the last-10-minutes SPX push
   that we currently infer only indirectly. Only worth it if the plan includes NOI.

**Lower-value / conditional:** `/v3/trades` + `/v3/quotes` (stock tick tape — marginal for an
SPX-index-focused desk); `/v3/reference/conditions` + `/v3/reference/exchanges` (only needed to decode
codes *if* we adopt the tick endpoints); `LULD` WS (UW `trading_halts` already covers most of this);
the SEC **filings** suite (10-K/8-K/13-F/Form 3/4) — rich but heavy, and UW already supplies
insider/institutional data we consume.

## Implementation Recommendations (ranked)

1. **Regenerate `src/lib/docs-usage-summary.json`.** It is 12 days stale and wrongly reports the entire
   financials/ratios/grouped-summary/IPO/splits/dividends surface as unused, which will mislead future
   audits and the admin API dashboard. Lowest effort, highest correctness payoff.
2. **Wire Ticker Events** into Night Hawk symbol resolution + watchlist hygiene. Low effort, prevents a
   real correctness failure mode (renamed/merged tickers) consistent with the "values live + correct"
   standing rule.
3. **Confirm the Stocks real-time WS entitlement**, then (if entitled) clone the indices socket to a
   `/stocks` cluster for the breadth universe to retire snapshot polling. Medium effort; check plan first.
4. **Evaluate NOI for the power-hour engine** — high signal value for the closing auction *if* the plan
   includes it; otherwise skip.
5. **Migrate Dividends/Splits off the deprecated `/v3/reference/*` paths** to `/stocks/v1/{dividends,splits}`
   before Polygon/Massive removes the old routes. Low effort, avoids a future breakage.
6. **Verify the Related-Tickers path.** We call `/v3/reference/tickers/{t}/related`; the documented
   canonical is `/v1/related-companies/{t}`. Confirm the alias still resolves on Massive or switch.

— Do **not** invest in stock tick Trades/Quotes or the SEC filings suite unless a specific tool needs
them; for an SPX-0DTE-centric platform the marginal value is low and UW covers the adjacent surfaces.
