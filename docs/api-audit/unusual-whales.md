# Unusual Whales API Audit
Last updated: 2026-06-29 (automated)
Plan tier: **Advanced** (`UW_PLAN_TIER = "advanced"`) — real-time options chain, flow, GEX, lit/dark pool, vol analytics, WebSocket streaming.

## Summary

Source of truth: the auto-generated OpenAPI catalog at [`src/lib/uw-docs-catalog.ts`](../../src/lib/uw-docs-catalog.ts)
(generated from `https://api.unusualwhales.com/api/openapi`, reachable & current as of this run) cross-checked
**line-by-line against the actual call sites** in [`src/lib/providers/unusual-whales.ts`](../../src/lib/providers/unusual-whales.ts)
and [`src/lib/ws/uw-socket.ts`](../../src/lib/ws/uw-socket.ts).

| Surface | Available | Used (code-verified) | Unused |
|---|---:|---:|---:|
| **REST endpoints** | 172 | **105** | 67 |
| **WebSocket data channels** | 13 | **6** | 7 |
| **TOTAL** | 185 | **111** | 74 |

- REST coverage: **61%** of the documented surface is wired.
- WebSocket coverage: **46%** of streaming channels are subscribed.
- We are one of the heaviest UW integrations imaginable — flow, GEX, dark/lit pool, tide, greeks,
  vol analytics, congress, insiders, institutions, earnings, fundamentals, screeners, predictions,
  seasonality and economy are all consumed.

### ⚠️ Two correctness findings surfaced by this audit

1. **The catalog's `blackout` (used) flag is stale** — it reports 103 used but the code actually calls
   **105 code-verified REST paths**, plus 11 endpoints are wired in code yet flagged `blackout:false`.
   Re-run `node scripts/generate-uw-docs-catalog.mjs` to refresh. Stale entries:
   `spot-exposures` (per-1min), `economy/{indicator}`, both `group-flow/.../greek-flow`,
   all four `predictions/*` (insiders/smart-money/unusual/whales), `stock/{ticker}/earnings`,
   `historical-risk-reversal-skew`, `option/stock-price-levels`.

2. **7 code paths do NOT match any documented OpenAPI path** — these likely 404/403 and are silently
   swallowed by `uwGetSafe` (returns `null`, callers fall back). See
   [Path Discrepancies](#path-discrepancies-verify) below. Three look like real bugs.

---

## Path Discrepancies (VERIFY)

These paths are called in code but are **not present in the documented OpenAPI**. Because `uwGetSafe`
swallows 403/404 → `null`, a wrong path degrades silently to "no data" rather than erroring loudly.
Worth a live probe (do not log the key).

| Code path | File | Documented path | Verdict |
|---|---|---|---|
| `/api/shorts/screener` | [unusual-whales.ts:1141](../../src/lib/providers/unusual-whales.ts) (`fetchUwShortScreener`) | `/api/short_screener` | **Likely bug** — wrong path; short screener probably returns nothing |
| `/api/etf/{ticker}/in-outflow` | [unusual-whales.ts:1255](../../src/lib/providers/unusual-whales.ts) (`fetchUwEtfInOutflow`) | `/api/etfs/{ticker}/in-outflow` (plural) | **Likely bug** — singular `etf` path is undocumented |
| `/api/etf/{ticker}/tide` | [unusual-whales.ts:1261](../../src/lib/providers/unusual-whales.ts) (`fetchUwEtfTide`) | `/api/market/{ticker}/etf-tide` | **Likely bug** — path does not exist; use `market/{ticker}/etf-tide` |
| `/api/screener/contracts` | [unusual-whales.ts:1279](../../src/lib/providers/unusual-whales.ts) (`fetchUwScreenerContracts`) | `/api/screener/option-contracts` | Verify — may be a legacy alias |
| `/api/unusual-trades/recent` | [unusual-whales.ts:1182](../../src/lib/providers/unusual-whales.ts) (`fetchUwUnusualTrades`) | not documented (congress unusual-trades only) | Verify — may be undocumented-but-live |
| `/api/stock/{ticker}/earnings-dates` | [unusual-whales.ts:1839](../../src/lib/providers/unusual-whales.ts) (`fetchUwTickerNextEarnings`) | not documented | Verify — may be undocumented-but-live |
| `/api/stock/{ticker}/implied-volatility-term-structure` | [unusual-whales.ts:1021](../../src/lib/providers/unusual-whales.ts) (`fetchUwIvTermStructure` fallback) | `/api/stock/{ticker}/volatility/term-structure` | OK — tried only as a fallback after the documented path |

Also: `fetchUwInstitutionActivity` ([unusual-whales.ts:1919](../../src/lib/providers/unusual-whales.ts))
calls the **deprecated** `/api/institution/{name}/activity`; a non-deprecated
`/api/institution/{name}/activity/v2` exists and should be preferred.

---

## REST Endpoints — by section

Legend: ✅ USED (code-verified) · ⬜ UNUSED · 🔶 used in code but catalog flag stale · 🗑 deprecated

### GEX / Greeks
| Endpoint | Status | Notes |
|---|---|---|
| `/api/stock/{ticker}/gex-levels` | ✅ | `fetchUwGexLevels` |
| `/api/stock/{ticker}/greek-exposure/expiry` | ✅ | `fetchUwGreekExposureExpiry` |
| `/api/stock/{ticker}/greek-exposure/strike` | ✅ | `fetchUwGreekExposureStrike` (GEX ladder fallback) |
| `/api/stock/{ticker}/greek-flow` + `/{expiry}` | ✅ | `fetchUwGreekFlow` |
| `/api/stock/{ticker}/spot-exposures` | 🔶 | `fetchUwSpotExposures` — catalog flag stale |
| `/api/stock/{ticker}/spot-exposures/strike` | ✅ | `fetchUwSpotExposuresByStrike` |
| `/api/stock/{ticker}/spot-exposures/expiry-strike` | ✅ | 0DTE GEX — primary SPX GEX ladder |
| `/api/stock/{ticker}/spot-exposures/{expiry}/strike` 🗑 | ✅ | `fetchUwSpotExposuresByExpiry` — uses deprecated variant |
| `/api/stock/{ticker}/greek-exposure` | ⬜ | **HIGH-VALUE** cumulative net greek exposure (see below) |
| `/api/stock/{ticker}/greek-exposure/strike-expiry` | ⬜ | **HIGH-VALUE** multi-expiry GEX ladder (see below) |

### Option Trades / Flow
| Endpoint | Status | Notes |
|---|---|---|
| `/api/option-trades/flow-alerts` | ✅ | HELIX tape primary (`fetchMarketFlowAlertRows`) |
| `/api/stock/{ticker}/flow-alerts` | ✅ | per-ticker flow |
| `/api/stock/{ticker}/flow-recent` | ✅ | `fetchUwFlowRecent` |
| `/api/stock/{ticker}/flow-per-strike` + `-intraday` | ✅ | 0DTE flow tilt |
| `/api/stock/{ticker}/flow-per-expiry` | ✅ | `fetchUwFlowPerExpiry` |
| `/api/net-flow/expiry` | ✅ | `fetchUwNetFlowExpiry` |
| `/api/option-trades/flow-alerts/{id}` | ⬜ | single-alert drill-down (see below) |
| `/api/option-trades/full-tape/{date}` | ⬜ | full historical tape (heavy; backtest only) |
| `/api/option-trades/exchange-breakdown/{date}` | ⬜ | exchange/trade-code mix |
| `/api/option-trades/optionable-tickers` | ⬜ | universe list (see below) |

### Option Contracts / Chains / OI / Greeks
| Endpoint | Status | Notes |
|---|---|---|
| `/api/stock/{ticker}/option-contracts` | ✅ | live NBBO chain |
| `/api/stock/{ticker}/option-chains` | ✅ | `fetchUwOptionChains` |
| `/api/stock/{ticker}/atm-chains` | ✅ | `fetchUwAtmChains` |
| `/api/stock/{ticker}/greeks` | ✅ | `fetchUwGreeksByStrike` |
| `/api/stock/{ticker}/oi-change` / `oi-per-strike` / `oi-per-expiry` | ✅ | OI suite |
| `/api/stock/{ticker}/options-volume` / `option/volume-oi-expiry` | ✅ | volume suite |
| `/api/stock/{ticker}/expiry-breakdown` | ✅ | `fetchUwExpiryBreakdown` |
| `/api/stock/{ticker}/max-pain` | ✅ | `fetchUwMaxPain` |
| `/api/stock/{ticker}/nope` | ✅ | `fetchUwNope` |
| `/api/option-contract/{id}/flow` / `intraday` / `volume-profile` | ✅ | per-contract suite |
| `/api/option-contract/{id}/historic` | ⬜ | historical per-contract series (backtest) |
| `/api/stock/{ticker}/option/stock-price-levels` | 🔶 | `fetchUwOptionPriceLevels` — flag stale |

### Volatility
| Endpoint | Status | Notes |
|---|---|---|
| `/api/stock/{ticker}/volatility/stats` | ✅ | IV rank |
| `/api/stock/{ticker}/volatility/realized` | ✅ | realized vol |
| `/api/stock/{ticker}/volatility/term-structure` | ✅ | IV term structure |
| `/api/stock/{ticker}/iv-rank` / `interpolated-iv` | ✅ | IV suite |
| `/api/stock/{ticker}/historical-risk-reversal-skew` | 🔶 | `fetchUwRiskReversalSkew` — flag stale |
| `/api/stock/{ticker}/volatility/anomaly` | ⬜ | **HIGH-VALUE** vol anomaly score (see below) |
| `/api/stock/{ticker}/volatility/character` | ⬜ | **HIGH-VALUE** vol regime classifier (see below) |
| `/api/stock/{ticker}/volatility/variance-risk-premium` | ⬜ | VRP — option richness signal |
| `/api/volatility/anomaly/top` | ⬜ | **HIGH-VALUE** market-wide vol-anomaly screener |
| `/api/volatility/character/top` | ⬜ | market-wide vol-regime screener |
| `/api/volatility/vix-term-structure` | ⬜ | **HIGH-VALUE** VIX term structure / contango (see below) |

### Market / Tide
| Endpoint | Status | Notes |
|---|---|---|
| `/api/market/market-tide` | ✅ | SPX desk tide |
| `/api/market/{sector}/sector-tide` | ✅ | sector tide |
| `/api/market/oi-change` / `top-net-impact` / `total-options-volume` | ✅ | market suite |
| `/api/market/correlations` / `sector-etfs` / `movers` | ✅ | market suite |
| `/api/market/economic-calendar` / `fda-calendar` | ✅ | macro/FDA |
| `/api/market/{ticker}/etf-tide` | ⬜ | ETF tide (code calls wrong path — see discrepancies) |
| `/api/market/insider-buy-sells` | ⬜ | market-wide insider net |

### Dark / Lit pool
| Endpoint | Status | Notes |
|---|---|---|
| `/api/darkpool/{ticker}` / `/api/darkpool/recent` | ✅ | dark pool prints |
| `/api/lit-flow/{ticker}` / `/api/lit-flow/recent` | ✅ | lit flow |
| `/api/stock/{ticker}/stock-volume-price-levels` | ⬜ | off/lit price-level histogram (see below) |

### Congress / Insiders / Institutions
| Endpoint | Status | Notes |
|---|---|---|
| `/api/congress/recent-trades` / `late-reports` / `politicians` / `unusual-trades` | ✅ | congress suite |
| `/api/insider/transactions` / `{ticker}` / `{sector}/sector-flow` | ✅ | insider suite |
| `/api/stock/{ticker}/insider-buy-sells` | 🔶 | flag stale |
| `/api/institution/{name}/activity` 🗑 / `holdings`, `{ticker}/ownership`, `institutions/latest_filings` | ✅ | institution suite (activity uses deprecated path) |
| `/api/congress/congress-trader` | ⬜ | reports grouped by trader |
| `/api/congress/unusual-trades/by-tickers` / `chart-data` / `stats` | ⬜ | congress unusual-trade analytics |
| `/api/institution/{name}/activity/v2` | ⬜ | **non-deprecated** activity — should replace v1 |
| `/api/institution/{name}/sectors` / `/api/institutions` | ⬜ | sector exposure + directory |
| `/api/politician-portfolios/*` (5) | ⬜ | richer politician portfolio API (newer than `/congress`) |

### Earnings / Fundamentals / Companies
| Endpoint | Status | Notes |
|---|---|---|
| `/api/earnings/premarket` / `afterhours` / `{ticker}` | ✅ | earnings calendar |
| `/api/stock/{ticker}/earnings` | 🔶 | flag stale |
| `/api/stock/{ticker}/financials` / `income-statements` / `balance-sheets` / `cash-flows` | ✅ | fundamentals (mostly @deprecated in favor of Polygon) |
| `/api/stock/{ticker}/fundamental-breakdown` | ✅ | `fetchUwFundamentalBreakdown` |
| `/api/companies/{ticker}/profile` / `dividends` / `splits` / `earnings-estimates` | ✅ | companies suite |
| `/api/companies/{ticker}/transcripts/{quarter}` | ⬜ | **earnings call transcripts** (see below) |

### Screeners / Predictions / Seasonality / Shorts / ETF / Economy
| Endpoint | Status | Notes |
|---|---|---|
| `/api/screener/stocks` / `option-contracts` / `analysts` | ✅ | screeners |
| `/api/screener/contracts` | ✅ | **path discrepancy** — see above |
| `/api/predictions/insiders` / `smart-money` / `unusual` / `whales` | 🔶 | all 4 used (`fetchUwPredictionsConsensus`); flags stale |
| `/api/predictions/market/*`, `search-users`, `user/{id}` | ⬜ | per-market depth (liquidity/positions) |
| `/api/seasonality/market` / `{ticker}/monthly` | ✅ | seasonality |
| `/api/seasonality/{month}/performers` / `{ticker}/year-month` | ⬜ | extra seasonality cuts |
| `/api/shorts/{ticker}/data` / `ftds` / `volume-and-ratio` / `volumes-by-exchange` / `interest-float/v2` | ✅ | shorts suite |
| `/api/shorts/screener` | ✅ | **path discrepancy** (`/api/short_screener`) — see above |
| `/api/etfs/{ticker}/exposure` / `holdings` / `info` / `weights` | ✅ | ETF reference |
| `/api/etfs/{ticker}/in-outflow` | ⬜ | code calls singular `/api/etf/...` (bug) |
| `/api/economy/{indicator}` | 🔶 | `fetchUwEconomyIndicator`; flag stale |
| `/api/group-flow/{flow_group}/greek-flow` + `/{expiry}` | 🔶 | `fetchUwGroupGreekFlow`; flags stale |
| `/api/stock/{ticker}/technical-indicator/{function}` / `ohlc/{candle_size}` / `info` / `ownership` / `stock-state` | ✅ | misc (several @deprecated for Polygon) |
| `/api/stock/{ticker}/net-prem-ticks` | ✅ | velocity radar |

### Entirely-unused sections (no BlackOut consumer today)
| Section | Endpoints | Relevance |
|---|---|---|
| **Crypto** | `crypto/whale-transactions`, `whales/recent`, `{pair}/ohlc`, `{pair}/state` | LOW — not in product scope |
| **Digital Currencies** | `history`, `intraday` | LOW |
| **Forex** | `history`, `intraday`, `rate` | LOW |
| **Commodities** | `commodities/{name}` | LOW |
| **Private Markets** | 9 endpoints | LOW — not in scope |
| **Intel** | `analytics/sliding`, `analytics/window`, `calendar/ipo`, `companies/listings` | **MED–HIGH** — see below |
| **Stock-directory** | `ticker-exchanges` | LOW (reference) |
| **Alerts** | `/api/alerts`, `/api/alerts/configuration` | LOW (UW-side user alert configs) |

---

## WebSocket Channels

Subscribed via the singleton multiplex in [`src/lib/ws/uw-socket.ts`](../../src/lib/ws/uw-socket.ts);
channel list in [`src/lib/live-api-integrations.ts:7`](../../src/lib/live-api-integrations.ts).

| Channel | Status | Consumer |
|---|---|---|
| `flow_alerts` | ✅ | HELIX tape writer (`persistAndPublishFlowAlert`) |
| `market_tide` | ✅ | `tideStore` → SPX desk |
| `off_lit_trades` | ✅ | `darkPoolStore` (dark pool live) |
| `interval_flow` | ✅ | `intervalFlowStore` (strike-level intraday) |
| `trading_halts` | ✅ | `tradingHaltsStore` → desk fail-closed gate |
| `net_flow` | ✅ | `netFlowStore` (SPX net premium) |
| `gex` | ⬜ | **HIGH-VALUE — live streaming GEX** (see below) |
| `price` | ⬜ | **HIGH-VALUE — live underlying spot** (see below) |
| `news` | ⬜ | **HIGH-VALUE — live news → Grid + event-aware desk** (see below) |
| `option_trades` | ⬜ | raw unfiltered trade stream (vs rule-filtered flow_alerts) |
| `lit_trades` | ⬜ | lit-exchange print stream (complements off_lit) |
| `contract_screener` | ⬜ | live contract screener stream |
| `custom_alerts` | ⬜ | UW-side user-configured alerts |

---

## High-Value Unused Endpoints

Ranked by impact on the trading platform.

### 1. `gex` WebSocket channel — live streaming GEX 🔥
- **Data:** real-time gamma-exposure updates pushed by UW (vs our current cycle-refresh REST pull of
  spot-exposures, and Massive/Polygon as primary).
- **Benefit:** Heat Maps + SPX desk gamma walls become *live* instead of refreshed per cron cycle; a
  second independent grounding source for the data-correctness cron and Night Hawk live-enforcement.
- **Complexity: LOW** — socket manager already multiplexes; add `"gex"` to `UW_WS_CHANNELS`, write a
  normalizer + `gexStore`, wire into `getGexPositioning` as a freshness overlay. GEX primary stays
  Massive (don't swap the source — overlay/cross-check only).

### 2. `price` WebSocket channel — live underlying spot 🔥
- **Data:** real-time underlying price ticks.
- **Benefit:** the index-spot anchor that several GEX/NW/Night-Hawk computations depend on (the prior
  index-spot fix) could be live-anchored rather than snapshot; tightens 0DTE wall accuracy.
- **Complexity: LOW** — one channel + store.

### 3. `news` WebSocket channel — live headlines 🔥
- **Data:** streaming market news headlines.
- **Benefit:** powers the BlackOut Grid news panel in real time and feeds the event-aware SPX desk
  (macro_events / macroHardBlock) with a live catalyst feed instead of polled REST headlines.
- **Complexity: LOW–MED** — channel + dedup + Grid wiring.

### 4. `/api/stock/{ticker}/greek-exposure/strike-expiry` — multi-expiry GEX ladder
- **Data:** cumulative greek exposure broken down by **both** strike and expiry.
- **Benefit:** Heat Maps could show a true term × strike GEX surface (today we lean on 0DTE
  `spot-exposures/expiry-strike`). Better for multi-day gamma positioning and Largo.
- **Complexity: LOW** — single `fetchUw*` wrapper + cache-reader, mirrors existing GEX fetchers.

### 5. Volatility analytics suite — `volatility/anomaly`, `volatility/character`, `vix-term-structure`, `anomaly/top`
- **Data:** per-ticker vol anomaly score, vol-regime character classifier, VIX term structure
  (contango/backwardation), and market-wide top-anomaly screeners.
- **Benefit:** a genuine volatility-regime lens for the SPX desk and Largo — VIX term structure
  contango/backwardation is a classic 0DTE risk gate; `anomaly/top` is a ready-made scanner for the Grid.
- **Complexity: LOW–MED** — straight REST wrappers; cache like the existing vol fetchers.

### 6. `/api/institution/{name}/activity/v2` — replace deprecated v1
- **Data:** non-deprecated institutional activity.
- **Benefit:** future-proofs the institution panel before UW removes v1; richer payload.
- **Complexity: LOW** — swap the path in `fetchUwInstitutionActivity`.

### 7. Intel: `/api/calendar/ipo` + `/api/companies/listings` + `/api/analytics/sliding|window`
- **Data:** IPO calendar, active/delisted securities universe, sliding/fixed-window flow analytics.
- **Benefit:** IPO calendar → Grid catalysts panel; listings → screener universe validation;
  analytics windows → a pre-aggregated signal feed (less client-side math).
- **Complexity: LOW** (calendar/listings) to **MED** (analytics — unknown shape, probe first).

### 8. `/api/companies/{ticker}/transcripts/{quarter}` — earnings call transcripts
- **Data:** full earnings-call transcript text.
- **Benefit:** feed to Largo / AI commentary for post-earnings catalyst analysis.
- **Complexity: MED** — large text payloads; cache aggressively, summarize via existing AI path.

### 9. `option_trades` + `lit_trades` WebSocket channels
- **Data:** raw unfiltered option trade stream + lit-exchange prints.
- **Benefit:** richer Velocity Radar / a true full tape; lit_trades complements the off_lit dark-pool feed.
- **Complexity: MED** — high message volume; needs sampling/throttle to respect the 2-RPS-equivalent
  budget and avoid drowning persistence. Implement behind a flag.

### 10. `/api/option-trades/flow-alerts/{id}` — single-alert drill-down
- **Data:** one flow alert by ID.
- **Benefit:** alert detail / permalink view in HELIX.
- **Complexity: LOW.**

---

## Implementation Recommendations (ranked)

**Do first — correctness fixes (this audit's findings):**
1. **Fix the 3 likely-broken paths** — `fetchUwShortScreener` (`/api/short_screener`),
   `fetchUwEtfInOutflow` & `fetchUwEtfTide` (`/api/etfs/...` and `/api/market/{ticker}/etf-tide`).
   These silently return `null` today. Probe live (no key logging) then correct.
2. **Verify** `/api/screener/contracts`, `/api/unusual-trades/recent`, `/api/stock/{ticker}/earnings-dates`
   against the live API; correct or document as undocumented-but-live.
3. **Regenerate the catalog** (`scripts/generate-uw-docs-catalog.mjs`) so the `blackout` flag stops
   undercounting (11 stale entries today).
4. **Migrate `fetchUwInstitutionActivity` to `/activity/v2`** before v1 is removed.

**Then — high-leverage net-new (cheap, big payoff):**
5. Add **`gex`**, **`price`**, **`news`** WebSocket channels (all LOW complexity, socket infra exists).
6. Add the **volatility analytics suite** (anomaly / character / VIX term structure) — strong desk signals.
7. Add **`greek-exposure/strike-expiry`** for a multi-expiry GEX surface in Heat Maps.

**Later — product expansion:**
8. IPO calendar + listings → Grid catalysts/universe.
9. Earnings-call transcripts → Largo AI.
10. `option_trades` / `lit_trades` streams behind a flag (volume/throttle care).

**Explicitly skip (out of product scope):** Crypto, Digital Currencies, Forex, Commodities,
Private Markets (24 endpoints total) — leave unused unless the product direction changes.
