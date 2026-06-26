# BlackOut — Full API Utilization Plan ("Use Every Entitled Endpoint")

Status: PLAN (docs-only). Branch `auto/api-grid-plan` off `origin/main` (b421330).
Date: 2026-06-26. Owner: lead engineer.

Goal: drive provider utilization toward 100% of **entitled** endpoints — wire every
high-value unused/partial endpoint, fix the path bugs that silently discard entitled
data, and prefer the free/cheap source on every shared signal. This is the master "use
everything" plan; the new page it feeds is specced separately in
`docs/BLACKOUT_GRID_SPEC.md`.

## Governing rules (carry from CLAUDE.md / standing memory)

- **Cache-reader rule.** Any per-user or high-fanout feature reads Redis snapshots
  written by a single cluster-wide writer (cron / WS), never per-request UW REST. UW is
  **2 RPS cluster-wide**; Polygon/Massive has no limiter but still costs the 40-RPS cluster
  budget. New panels/tools MUST be cache-readers.
- **Free-first.** When two providers expose the same signal, prefer the one that does NOT
  spend the scarce UW 2-RPS budget. Massive `/fed/v1/*` macro and Massive options data are
  free relative to UW; use them as primary, demote UW to fallback.
- **Cross-tool access (STANDING).** Every entitled dataset must be reachable by every
  surface — Largo tool, Night's Watch, SPX desk, Night Hawk, Grid. A dataset confined to
  one consumer is a gap, not "done".
- **Catalog flag ≠ entitlement.** `uw-docs-catalog.ts` `blackout` is stale. Real usage =
  wrapper exists AND `run-tool.ts` dispatches it. Real entitlement = live probe 200. Both
  were re-probed for this plan.
- **No grey.** Semantic tokens only: emerald=bullish, `#ff5c78`/`#ff2d55`=bear, sky=neutral,
  gold=highlight. Never `text-grey/zinc/neutral` on `#040407`.

## Headline wins (do these first — biggest value per hour)

1. **Fix the 4 silent path bugs** (≈1 line each, all unlock entitled data being thrown away today):
   - `fetchUwEtfInOutflow` — `/api/etf/` → `/api/etfs/{ticker}/in-outflow` (404→200). Institutional ETF creation/redemption flow, never once returned data.
   - `fetchUwEtfTide` — points at a dead `/api/etf/{t}/tide` (404). Repoint to `/api/market/{ticker}/etf-tide` (200) → per-ETF SPY/QQQ tide, a clean 0DTE proxy. Both Largo `get_etf_flow` and Night Hawk market-wide silently got null.
   - `fetchRelatedTickers` — `/v3/reference/tickers/{t}/related` (404) → `/v1/related-companies/{ticker}` (200). Resurrects Largo's always-empty peer set.
   - Benzinga **analyst channel name** — `analyst-ratings` (hyphen, 0 results) → `analyst ratings,price target,upgrades,downgrades,analyst color`. Restores Largo's free, unlimited analyst path (currently dead on main; fix lives on a branch — see Merge section).
2. **Subscribe the RPS-free UW WS channels we already pay for**: `gex`, `net_flow`, `news`
   (and optionally `lit_trades`/`price`/`contract_screener`). Only 5 of 14 channels are
   joined. These are **zero incremental RPS** and remove polling cost + latency. `gex`
   closes #104, `net_flow` closes #98, `news` powers the Grid News panel.
3. **Wire the volatility cluster (UW, all probed 200, no wrappers):** `variance-risk-premium`
   (VRP rank — the single best unused vol signal: rich vs cheap premium), `volatility/anomaly`
   + `anomaly/top`, `volatility/character` + `character/top`. Feeds the desk vol panel, Night
   Hawk candidate selection, and Largo.
4. **Adopt Massive `/fed/v1/*` macro as primary** (`treasury-yields` full curve,
   `inflation` CPI/PCE, `inflation-expectations`) — richer than UW's single scalar AND frees
   the UW budget. Demote UW `/api/economy/*` to fallback.
5. **Native Massive options tape + single-contract snapshot** — `/v3/trades/{occ}` (REST) +
   the WS `T.` trades channel + `/v3/snapshot/options/{u}/{contract}`. Gives true last-trade
   NW marks (not quote-mid), a watchdog that separates quoteless from tradeless, and a
   cheaper enrichment path for ≤2-strike buckets that also carries `break_even_price`.
6. **Stop discarding fields already in payloads** — chain `day.volume` + `break_even_price`
   (zero extra HTTP), and the 9 redundant indicator recomputes in `fetchPolygonMtfTechnicals`
   (compute ema20/rsi14 locally from bars already in hand; ~5-6 fewer REST calls/ticker on a
   multi-consumer hot path).
7. **Lift financials out of Night Hawk jail** — the entitled 18 ratios + 3 statements +
   fundamental signals (Massive `/stocks/financials/v1/*`) are consumed ONLY by Night Hawk.
   Add a Largo `get_company_financials` tool and feed FundamentalSignals into Night's Watch
   verdict + SPX desk. This is the largest cross-tool-access gap.

---

## Provider 1 — Massive / Polygon (core market data)

Single Massive plan key behind the Polygon-shaped API (`polygon.ts`, `polygon-largo.ts`,
`polygon-options-gex.ts`, `options-snapshot.ts`). No per-call limiter, but counts against the
40-RPS cluster cap.

| Endpoint | Status | Value | Wiring action |
|---|---|---|---|
| OPTIONS Trades REST `/v3/trades/{occ}` | unused-entitled (probe 200) | high | Add `fetchPolygonOptionTrades(occ,{ts.gte,limit})` in `polygon-largo.ts`; Largo `get_option_trades` tool; feed NW position-detail per-contract tape (real prints). Reduces UW full-tape dependence. |
| OPTIONS WS `T.` trades channel (`socket.massive.com/options`) | unused-entitled | high | In `OptionsSocketShard.sendSubscribe` also emit `T.`+occ; `onTrade` → `writeMarkThrough` last-trade marks. Gate behind `OPTIONS_WS_ENABLED`. True last-trade NW P&L; watchdog separates quoteless vs tradeless. Mind `OPTIONS_WS_MAX_CONNS=1` (T+Q doubles per-shard weight). |
| OPTIONS single-contract snapshot `/v3/snapshot/options/{u}/{contract}` | unused-entitled (probe 200) | high | Add `fetchSingleContractSnapshot(u,occ)`; use in NW enrichment when an (underlying,expiry) bucket has ≤2 held strikes (cheaper, carries `break_even_price` + `day.volume`). Keep unified `/v3/snapshot` batch for many-strike buckets. `polygon-options-gex.ts:46` already TODO'd this. |
| OPTIONS chain discarded fields `break_even_price` + `day.volume` | partial | high | Extend `ChainContract` (`polygon-options-gex.ts:22-35`) with `day:{close?,volume?}` + `break_even_price?`; optional volume-weighted GEX-wall overlay (toggle; OI is convention but 1-day lagged); surface break-even on NW cards. Zero extra HTTP. |
| REFERENCE Conditions `/v3/reference/conditions` | unused-entitled (probe 200) | high | `fetchConditions(asset_class)` long-TTL cached → code→{name,exclude} map; apply wherever `/v3/trades` is consumed to drop odd-lot/canceled/late prints. Prereq for trustworthy native-tape flow. |
| REFERENCE Related companies `/v1/related-companies/{t}` | **BUG / unused-entitled** | medium | **Fix** `fetchRelatedTickers` (`polygon-largo.ts:356`) from `/v3/reference/tickers/{t}/related` (404) to `/v1/related-companies/{ticker}` (200, map `results[].ticker`). Resurrects dead Largo peer set. |
| REFERENCE Ticker events `/vX/reference/tickers/{t}/events` | unused-entitled (probe 200 stock) | medium | Optional `fetchTickerEvents(ticker)` for Largo profile (ticker-change/corp-action flags). Lower priority than dividends/splits. |
| CORPORATE Dividends `/v3/reference/dividends` | used | medium | Optional: enrich Night Hawk dossier with ex-div proximity (assignment-risk for short calls). No new endpoint. |
| CORPORATE Splits `/v3/reference/splits` | used | medium | Used. For Task #9: read split/adjustment to set `shares_per_contract` in GEX math instead of hardcoded ×100 (adjusted contracts corrupt notional). |
| OPTIONS indicators sma/ema/rsi/macd on `O:` tickers | unused-entitled (probe 200) | medium | Low priority (niche). Optional timespan-aware indicator overlay on held NW contracts. Skip unless a surface asks. |
| INDICATORS recompute — `fetchPolygonMtfTechnicals` 9 redundant calls | partial | medium | `polygon-largo.ts:222-241`: compute ema20/rsi14 for daily/hourly/15m locally (`ma-math.ts` `emaFromCloses`/`rsiFromCloses`) from bars already fetched; keep server calls only for ema50/ema200/macd. Cuts ~5-6 REST/ticker on a hot path. |
| STOCKS Trades REST `/v3/trades/{ticker}` | unused-entitled | low | No consumer; equities tape isn't a surface. Leave; revisit if an equity T&S view is built. |
| STOCKS/OPTIONS Quotes REST `/v3/quotes/{ticker}` (NBBO history) | partial | low | `/v2/last/nbbo` covers the use case. Historical quote stream has no consumer. None. |
| INDICES trades/quotes `/v3/{trades,quotes}/I:SPX` | **unentitled-403** | low | Correctly avoided (plan exposes snapshot+aggs+indicators only). Document 403 so nobody re-adds an index tape. |
| AGGREGATES sec/min/hour/day/week/range + grouped + prev | used | high | Strong coverage. No "second" timespan (no sub-minute need). None. |
| SNAPSHOTS stocks/indices/chain/unified `/v3/snapshot` | used | high | Full coverage. Single-contract variant is the only gap (above). |
| REFERENCE tickers/details/search/types + contracts | used | medium | `types` ref unused (skippable). `/v3/reference/exchanges` (200, unused) — pull cached alongside `/v3/trades` to label exchange ids in a tape view. |
| MARKET STATUS now / upcoming(holidays) | used | medium | Complete (holidays consumed via `upcoming`). None. |
| REFERENCE IPOs `/vX/reference/ipos` | used | low | Watch for `/vX`→`/v3` GA path migration. None. |
| STOCKS+ short-interest/short-volume/float/ratios/Benzinga news | used | medium | `/vX/reference/financials` (200, full TTM statements) unused — we use lighter ratios. Optional `fetchPolygonFinancials` for Largo `get_financials` real line-items (revenue/EPS/margins). |

### Massive Partners (Fed macro, Benzinga, FX/crypto)

| Endpoint | Status | Value | Wiring action |
|---|---|---|---|
| `/fed/v1/treasury-yields` | unused-entitled (200) | high | Add `fetchMassiveTreasuryYields()` in `polygon.ts` (`/fed/v1/treasury-yields?sort=date.desc&limit=2`). Full daily curve. Surface 2s/10s/30s + 2s10s slope as rates-regime input to `spx-desk.ts` + Largo. Prefer over UW economy treasury-yield to free UW budget. |
| `/fed/v1/inflation` (CPI+PCE) | unused-entitled (200) | high | `fetchMassiveInflation()`; feed CPI/PCE-core latest-vs-prior into `spx-macro-window.ts` / `macro-events.ts` catalyst layer + Largo economy tool. No UW cost. |
| `/fed/v1/inflation-expectations` | unused-entitled (200) | medium | Optional: fold 5y/10y breakeven into the same rates-regime helper. Lower priority than yields + CPI/PCE. |
| Benzinga news `/benzinga/v2/news` | used | high | Entitled, market-wide + `channels.any_of` verified. Add `fetchBenzingaChannelFeed(channels,limit)` market-wide wrapper (Grid backbone). Currently consumed per-ticker only. |
| Forex aggs `/v2/aggs/.../C:EURUSD/{prev,range}` | unused-entitled (200 EOD) | medium | Daily-only (real-time FX 403). Optional DXY-proxy / EURUSD daily-change tile. Do NOT build a live FX feed. |
| Crypto aggs `/v2/aggs/.../X:BTCUSD/{prev,range}` | unused-entitled (200 EOD) | low | Daily-only. Optional BTC-daily-change risk chip. Low relevance to 0DTE/options. |
| Forex/Crypto REAL-TIME snapshots + last_quote | **unentitled-403** | low | Upgrade-only. Don't build live FX/crypto tick features. |
| Benzinga structured calendars `/benzinga/v1/{earnings,ratings,analyst-insights}` | **unentitled-403** | medium | Upgrade-only. `fetchBenzingaEarnings/AnalystRatings` filter the entitled v2 **news** feed by channel (work) — the dedicated v1 calendars are not on plan. |

---

## Provider 2 — Unusual Whales (full REST + WS surface)

~95% of the entitled REST surface is already reachable by Largo (97 `fetchUw*` wrappers,
97 dispatched in `run-tool.ts`). The path-string diff overcounts gaps (provider uses path
variants). Real gaps = the path bugs + the vol cluster + volume-price-levels + 9 unused WS
channels.

| Endpoint / channel | Status | Value | Wiring action |
|---|---|---|---|
| `/api/etfs/{t}/in-outflow` | **BUG / partial** | high | Fix `unusual-whales.ts:1247` `/api/etf/` → `/api/etfs/${etf}/in-outflow`. Unlocks institutional ETF creation/redemption flow for Largo `get_etf_flow`. Never returned data. |
| `/api/market/{t}/etf-tide` | **BUG / partial** | high | Repoint `fetchUwEtfTide` (`:1250-1255`) from dead `/api/etf/{t}/tide` (404) to `/api/market/${etf}/etf-tide` (200). Per-ETF SPY/QQQ/IWM tide = clean 0DTE proxy. Both `get_etf_flow` and `market-wide.ts:158` silently got null (and burned a call on a 404). If repoint not viable, delete the dead call. |
| `/api/stock/{t}/volatility/variance-risk-premium` | unused-entitled (200) | high | Add `fetchUwVarianceRiskPremium(t)` (cache-reader, ~1h TTL) → latest rank + risk_premium. Largo `get_variance_risk_premium`; surface VRP rank on desk vol panel + Night Hawk premium buy/sell decisions. **Single best unused vol signal.** |
| `/api/stock/{t}/volatility/anomaly` + `/api/volatility/anomaly/top` | unused-entitled (200) | high | `fetchUwVolatilityAnomaly(t)` + `fetchUwTopVolatilityAnomalies({direction,limit})` (~5-10min TTL). Wire top-anomalies into Night Hawk candidate inputs + Largo tool. **`anomaly/top` MUST pass `direction` (short_vol\|long_vol) or it 422s.** |
| `/api/stock/{t}/volatility/character` + `/character/top` | unused-entitled (200) | medium | `fetchUwVolatilityCharacter(t)` + `fetchUwTopVolatilityCharacter({direction,limit})`. Surface hurst/half-life regime tag in NW position context + Largo. `character/top` needs `direction`. Lower priority than VRP/anomaly. |
| `/api/stock/{t}/stock-volume-price-levels` (Off/Lit) | unused-entitled (200) | high | `fetchUwStockVolumePriceLevels(t)` (~1-2min TTL): per-level {price,lit_vol,off_vol}. Compute VPOC + high-volume nodes for SPX/Heatmaps chart; Largo `get_volume_profile`. Distinct from wrapped `fetchUwOptionPriceLevels`. Complements GEX walls with traded-volume levels. |
| `/api/volatility/vix-term-structure` | **unentitled-403** (vol add-on) | medium | Do NOT wire (only vol-cluster endpoint not entitled; per-ticker `/volatility/term-structure` IS 200 & wrapped). Buy add-on or source VIX TS from Polygon/CBOE. Mark `blackout=false` in catalog notes. |
| WS `/api/socket/gex` | unused-entitled | high | Add `gex` to `UW_WS_CHANNELS`; subscribe in `initUwSocket`; `gexStore` mirroring `tideStore`; fold into pulse SSE (#95); cross-validate vs Polygon/Massive GEX (#105). RPS-free live GEX. Closes #104. Single shared socket. |
| WS `/api/socket/net_flow` | unused-entitled | high | Add `net_flow`; subscribe per-ticker (`net_flow:SPX/SPY`); `netFlowStore`; fold into pulse SSE. Real-time net call/put premium by expiry without polling. Closes #98. |
| WS `/api/socket/news` | unused-entitled | medium→high (Grid) | Add `news`; `newsStore`; SSE to Grid News panel. Push headlines (incl `is_trump_ts`) at 0 incremental RPS. Highest-leverage RPS-free upgrade for the Grid. |
| WS `option_trades` / `lit_trades` / `price` / `contract_screener` / `custom_alerts` | unused-entitled | medium | `option_trades`: only for a full-tape product (bandwidth heavy). `lit_trades`+`price`: wire if desk needs live lit volume+spot without Polygon. `contract_screener`: push replacement for polled `fetchUwScreenerOptionContracts`. `custom_alerts`: skip unless mirroring UW alert configs. **Prioritize gex + net_flow + news first.** |
| `/api/economy/{indicator}` | used | medium | Demote to FALLBACK behind Massive `/fed/v1/*` (richer + frees UW budget). |
| `/api/market/economic-calendar` | used | high | Well wired (`macro-events.ts:350`). Enrich by joining Massive `/fed` reads (show prevailing data point next to each print). |
| `/api/etfs/{t}/{holdings,exposure}` | used | medium | Working. After in-outflow fix, Largo ETF tool returns holdings+exposure+in-outflow. |
| `/api/market/fda-calendar` | used (ticker-scoped) | medium | Add market-wide `fetchUwFdaCalendarMarket(limit)` for the Grid Catalyst panel. |
| `/api/seasonality/{t}/monthly` + `/market` | used | medium | Entitled and used. None. |
| `/api/congress/unusual-trades` + `/api/calendar/ipo` | unused-entitled | low | Phase-2 Catalysts strip (IPO tile + unusual-congress badge). Defer until core panels ship. |
| Non-entitled categories (crypto/forex/commodities/private-markets/…) | **unentitled-403 / out-of-scope** | low | No action. RE-EVALUATE by probe a few open-but-unwired: group-flow greek-flow (already wired), intel sliding/window, unusual-trades stats — could enrich Largo cheaply. |
| Catalog `blackout` flag stale | unknown | medium | Regenerate `uw-docs-catalog.ts` with a live-probe pass recording actual HTTP status (200/403/422) + a `wrapperFn` field per path so future gap diffs are wrapper-based, not string-based. |

---

## Provider 3 — Company financials (Massive `/stocks/financials/v1/*`, entitled, NOT Benzinga)

All probed 200: ratios, income-statements, balance-sheets, cash-flow-statements. Built +
wired on a branch (`fetchPolygonFinancialRatios` 18 fields, `fetchPolygonIncomeStatements/
BalanceSheets/CashFlowStatements`, `computeFundamentalSignals`), consumed by Night Hawk
`dossier.ts` + `scorer.ts`.

| Item | Status | Value | Action |
|---|---|---|---|
| 18 ratios + 3 statements + fundamental signals | used (branch only) | high | Lands with the merge (below). Run `node --test src/lib/nighthawk/financials-enrichment.test.ts` (node:test file; vitest invocation errored on harness, not logic). |
| **RESIDUAL: financials confined to Night Hawk** | unused-entitled (cross-tool) | high | Add Largo `get_company_financials` tool (tool-def + dispatch) reading the same fetchers; feed `FundamentalSignals` into NW verdict (earnings-risk + margin/FCF health) + position-detail; optional desk fundamentals chip. **Biggest remaining "use every endpoint" gap.** |

---

## Merge-state reframe (BLOCKER for several "landed" claims)

The premise that the channel fix / PT wiring / financials enrichment **landed on main is
FALSE.** Main HEAD still has the buggy hyphenated `analyst-ratings` channel and **none** of
`fetchPolygonIncomeStatements` / `fetchBenzingaPriceTarget` / `computeFundamentalSignals`.
All of it lives on `auto/nighthawk-benzinga-catalysts` (31 ahead, 0 behind, NOT merged).

**Stacked sibling branches (not a clean stack — don't merge one and assume the rest):**
- `auto/nighthawk-benzinga-catalysts` — channel fix `35d4442` + financials wired into dossier/scorer `6fa8a6f` + folds in `auto/financials-enrichment`.
- `auto/largo-benzinga-channels` — Benzinga channel MENU in Largo `get_news` (`25aa1ce`) — NOT in catalysts.
- `auto/benzinga-ui-exposure` — Benzinga news UI on desk/HELIX/Night Hawk (`d974bc7`) — NOT in catalysts.
- `auto/benzinga-price-targets` (18-ahead), `auto/financials-enrichment` (19-ahead, folded into catalysts).

**Reconcile path:** base = catalysts; merge `largo-benzinga-channels` (`25aa1ce`) + `benzinga-ui-exposure` (`d974bc7`) on top; resolve overlap; single PR to main. **Ship the one-line channel fix to main NOW** (highest value, lowest risk) even ahead of the full merge — it restores Largo's free analyst path.

**Benzinga residuals after merge:**
- ~20 entitled news channels still unconsumed (guidance, m&a, offerings, buybacks, after-hours center, movers, options, insider trades, short sellers, fda). Wire into Night Hawk evening-plays catalyst tagging + desk "why is X moving" rail. Zero incremental cost (same `/benzinga/v2/news`).
- PT wiring is a **text-parse proxy** (`parsePriceTargetFromText`), not structured — label as "parsed/estimated"; structured PT is 403 (plan upgrade).
- 8 structured Benzinga v1 endpoints are 403 (News-only plan): `{ratings, consensus-ratings, earnings, analysts, analyst-insights, bulls-bears-say, guidance, firms}`. No structured EPS/rev surprise%/BMO-AMC. Earnings cross-source is headline-only. Paths: (1) upgrade plan (priority earnings + consensus-ratings — no proxy), (2) keep headline-parse + UW earnings-calendar cross-source, label numbers "parsed".

---

## Prioritized, FREE-FIRST build order

Effort: S ≈ ≤1 line / minutes · M ≈ a wrapper + 1 consumer · L ≈ new store/cron/multi-consumer.

### Tier 0 — Path-bug fixes (free, unlocks entitled data already paid for)
1. **(S)** Benzinga analyst channel name → main now. Restores Largo free analyst path. _Feeds: Largo `get_analyst_ratings`, Grid Analyst Actions._
2. **(S)** `fetchUwEtfInOutflow` plural path. _Feeds: Largo `get_etf_flow`, Grid Sector/ETF._
3. **(S)** `fetchUwEtfTide` → `/api/market/{t}/etf-tide`. _Feeds: desk SPY-tide 0DTE proxy, Largo, Night Hawk market-wide._
4. **(S)** `fetchRelatedTickers` → `/v1/related-companies/{t}`. _Feeds: Largo `get_company_profile` peer set._

### Tier 1 — RPS-free WS channels we already pay for (free, removes polling)
5. **(L)** WS `gex` → `gexStore` + pulse SSE + cross-validate. Closes #104. _Feeds: desk, Heatmaps, Grid._
6. **(L)** WS `net_flow:SPX/SPY` → `netFlowStore` + pulse SSE. Closes #98. _Feeds: desk structural lane, Grid Positioning._
7. **(L)** WS `news` → `newsStore` + SSE. _Feeds: Grid News panel (live). Highest-leverage Grid upgrade._

### Tier 2 — Free Massive sources that displace UW budget
8. **(M)** `fetchMassiveTreasuryYields()` + 2s10s slope → rates regime. Demote UW economy. _Feeds: desk, Largo, Grid Econ._
9. **(M)** `fetchMassiveInflation()` CPI/PCE → macro window. _Feeds: macro-events, desk, Largo._
10. **(S)** `fetchMassiveInflationExpectations()` 5y/10y breakeven (optional, same helper).

### Tier 3 — Zero-extra-HTTP field rescues + recompute cut
11. **(S)** Extend `ChainContract` with `day.volume` + `break_even_price`; surface break-even on NW cards. _Feeds: NW, option-chain-prompt._
12. **(M)** Local ema20/rsi14 in `fetchPolygonMtfTechnicals`; keep server calls only for ema50/200/macd. Saves ~5-6 REST/ticker. _Feeds: Largo technicals, NW, Night Hawk._

### Tier 4 — UW high-value unused (cheap, cache-reader)
13. **(M)** `fetchUwVarianceRiskPremium` + Largo tool + desk VRP chip. _Best unused vol signal._
14. **(M)** `fetchUwTopVolatilityAnomalies` (`direction` required) + `fetchUwVolatilityAnomaly` → Night Hawk candidates + Largo.
15. **(M)** `fetchUwStockVolumePriceLevels` → VPOC overlay for desk/Heatmaps + Largo `get_volume_profile`.
16. **(M)** `fetchUwVolatilityCharacter` + top → regime tag in NW + Largo (lower priority).

### Tier 5 — Cross-tool access (merge + fan-out)
17. **(L)** Merge the reconciled Benzinga/financials branch stack (see Merge section).
18. **(M)** Largo `get_company_financials` + feed FundamentalSignals into NW verdict + desk. _Closes the biggest cross-tool gap._
19. **(M)** Wire unconsumed Benzinga channels (guidance/m&a/after-hours/movers) into Night Hawk + desk rail.

### Tier 6 — Native Massive options tape (latency/quality, heavier)
20. **(M)** `fetchPolygonOptionTrades` + Largo `get_option_trades` + NW per-contract tape.
21. **(M)** `fetchConditions` map (prereq) to filter non-bona-fide prints in tape flow.
22. **(L)** WS `T.` trades channel → last-trade NW marks + watchdog quoteless/tradeless split (gate `OPTIONS_WS_ENABLED`, mind `OPTIONS_WS_MAX_CONNS=1`).
23. **(M)** `fetchSingleContractSnapshot` for ≤2-strike NW buckets (carries break-even + day.volume).

### Tier 7 — Optional / low priority
24. `fetchPolygonFinancials` (`/vX/reference/financials` full statements) for Largo `get_financials`.
25. `/v3/reference/exchanges` cached labels for any tape view; `fetchTickerEvents`; option-contract TA; ex-div proximity flag; DXY/BTC daily chips; congress unusual-trades + IPO Phase-2 strip.

### Do NOT wire (document the 403s)
- `/v3/{trades,quotes}/I:SPX` (index tick tape — plan excludes).
- UW `/api/volatility/vix-term-structure` (vol add-on required).
- Massive real-time FX/crypto snapshots + `/v1/last_quote/currencies` (live tier not on plan).
- Benzinga v1 structured `{ratings, consensus-ratings, earnings, analysts, analyst-insights, bulls-bears-say, guidance, firms}` (News-only plan).

---

## Coverage scorecard (target = 100% of entitled)

- Massive/Polygon core: ~90% entitled used. Gaps = options trades REST+WS, single-contract snapshot, conditions, the related-companies bug, 2 discarded chain fields, indicator recompute. **All wireable.**
- Massive partners: macro `/fed/v1/*` (3 endpoints) + market-wide Benzinga channel feed are the live gaps; FX/crypto real-time + Benzinga v1 calendars are 403 (upgrade-only).
- UW REST: ~95% reachable. Gaps = 2 path bugs + vol cluster (VRP/anomaly/character) + volume-price-levels.
- UW WS: 5/14 channels joined. Wire `gex`/`net_flow`/`news` (free) for the biggest jump; `vix-term-structure` is the only vol endpoint not entitled.
- Financials: entitled + built but Night-Hawk-only — fan out to Largo/NW/desk.

After Tiers 0-5, entitled utilization for the trading-relevant surface reaches ~100% with
no incremental UW RPS (free WS + free Massive sources + bug fixes carry most of the value).
