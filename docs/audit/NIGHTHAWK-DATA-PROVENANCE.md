# Night Hawk 0DTE — Data Provenance Map

**What this is.** A complete, code-grounded map of every data source the live 0DTE "Night Hawk"
board consumes: which upstream serves it (Unusual Whales vs Polygon/Massive), which transport
(REST vs WebSocket vs Postgres vs Redis), whether it's actually ingested, whether its freshness is
tracked, and whether it's an official value or a proxy. Built 2026-07-25 from a seven-way source
sweep of `src/lib/**`. Line refs are `src/lib/...` unless noted.

**Why it exists.** So a market-open surprise ("this field isn't provided / is empty / is stale and
we're trading on it anyway") is caught here, on paper, instead of at 09:30 live. Read §0 first.

---

## 0. TL;DR + the market-open DANGER list

**Two upstreams, two transports each:**

| | REST | WebSocket (server-side ECS only) |
|---|---|---|
| **Unusual Whales** (`api.unusualwhales.com`, Bearer) | ~26 endpoints: market-wide context, per-candidate dossier, earnings, macro-ish. **Rate-limited to ~2 rps**, per-hunt budget 12 live calls. | 1 multiplexed socket, 10 channels (flow, tide, dark-pool, halts, GEX-strike, price…). Flow reaches the scan **through Postgres**, not the socket. |
| **Polygon / Massive** (`api.massive.com`, `apiKey` query) | The numeric spine: option chain+greeks, `/v3/snapshot`, option trades, minute bars, grouped-daily, Benzinga news, Fed macro, indicators. | 3 clusters: `socket.massive.com/{indices,stocks,options}` — SPX/VIX regime, all-stock spot + SPY LULD halt, per-contract live marks. |

**The client never holds a socket.** All WS run server-side on ECS (WS upgrades are blocked at the
proxy); the browser gets data via **SSE** (live marks, 1s) + **SWR REST polling** (the board).

**The commit spine mostly fails *closed*** (missing bias / VIX / macro / governor / quote → it
**holds** = safe). The real exposure is the handful of paths that **fail *open*** — commit on the
*absence* of data — plus dormant staleness checks. Those are the market-open punch list:

### 🔴 DANGER — paths that can COMMIT on absent/garbage data

| # | Gap | Trigger | What commits wrongly | Smallest fix | Status |
|---|---|---|---|---|---|
| **D1** | **Earnings gate fails OPEN** (`scan.ts:523-533`, `gates.ts:598-607`) — `readGridEarnings()` miss/timeout → empty map; G-11 only blocks when earnings `!= null`. | earnings snapshot cron cold, or the 2.5s read times out at a busy open | fresh 0DTE on a name **reporting today** (pre/after-hours) | distinguish "fetched: none" from "fetch failed/empty" → pass `earningsUnavailable`, fail closed (mirror the existing VIX/macro `*Unavailable` pattern) | **queued → WS-A** |
| **D2** | **Halt/LULD fails OPEN on the board** (`scan.ts:543-546`) — board passes `{failClosedOnStale:false}`, so a cold/dead halt socket → empty store → no hold. (The desk default *does* fail closed.) | UW halt socket not yet connected post-deploy, or dies mid-session | fresh 0DTE on a **halted / LULD-paused** underlying | flip board read to `failClosedOnStale:true` (the cross-channel `isUwHaltSourceStale` proxy already prevents the old false-empty), or gate behind WS-21 source-health | **queued → WS-B** |
| **D3** | **Option-quote staleness never checked** (`plan.ts:176-177`, `scan.ts:689-690`) — `OptionSnapshot` drops `last_quote.last_updated`, so `quoteAgeMs` is never plumbed and the WS-04 `stale` predicate is **dead code in prod**. | thin 0DTE contract, last quote minutes old but structurally valid (bid<ask, mark in band) | entry/stop/target pinned to a **phantom mark**; grades off an unfillable price | map the snapshot's quote timestamp → `buildContractPlan({quoteAgeMs})`; predicate activates with zero further change | **queued → WS-C (WS-25-adjacent)** |
| D4 | GEX "wall in your path" veto **silently no-ops** on a FLOW setup when the GEX ladder is cold (`cortex-gate.ts:147-165`, `gex-walls.ts:82-91`) — veto-blind HOLD needs *both* veto sources blind; a FLOW setup always has flow, so an absent wall just drops the veto. | early/thin session, loud flow + unformed GEX ladder | a long straight into an unseen dominant call wall | *by design* (hard gates are the floor); if tightening, require a live gex read for index/high-notional commits else HOLD | by-design (documented) |
| D5 | VIX `couldBlock` narrowing (`gates.ts:481`) — a missing VIX doesn't block a tape-aligned index/ETF or a ≥75 score. | — | **nothing** — a present VIX wouldn't block those either | none needed (not a true fail-open) | non-issue |

**The reassuring half — "empty at 09:30" is usually NORMAL, not broken.** G-2 hard-blocks *every*
fresh commit before **10:00 ET** (`gates.ts:76,340`), which masks the whole cold-start warm-up.
An empty board 09:30–10:00 is by design. GEX walls and multi-day flow accumulation are **not**
cold — they seed off prior-session OI/history. The thing to actually watch Monday is the *opposite*:
a board that **prints while the halt or earnings feed is cold** (D1/D2) — that's the anomaly.

---

## 1. Topology — transports & where each runs

- **Boot:** `ensureDataSockets()` (`ws/init-data-sockets.ts:45`) starts UW + all 3 Massive sockets +
  the flow-event bridge. It runs **only on the Node.js runtime**, deliberately not from
  `instrumentation.ts` (edge-bundle contamination guard, `instrumentation.ts:36-44`). The dedicated
  **market-worker** (`deploy/market-worker.mjs`, `PROCESS_ROLE=ingest`, `EAGER_DATA_SOCKETS=1`) GETs
  `/api/worker/boot` to force it up; on the 8 web tasks it lazy-boots on first `/api/market/*` hit.
- **Single-writer:** each socket is **leader-locked** in Redis (`SETNX`, 25s TTL, 10s renew, fenced
  tokens) because both UW and Massive allow only 1 live WS per API key (per asset class). One replica
  holds each socket; the rest read its Redis/Postgres write-through.
- **Server → browser boundary (SSE + SWR):** the browser opens no WS. Board → **SWR REST**
  (`GET /api/market/zerodte/board`, Redis snapshot `zerodte:board:snapshot:v1`, `no-store`). Open-play
  live marks → **SSE** (`/api/market/zerodte/marks/stream`, 1s) with SWR REST fallback.

---

## 2. Unusual Whales — REST

Base `https://api.unusualwhales.com` (`UW_API_BASE`), `Authorization: Bearer ${UW_API_KEY}` +
`UW-CLIENT-API-ID`. All calls funnel `uwGet` → `throttleUwCoalesced` → `uwGetSafe`
(`unusual-whales.ts:136/321`). **Limiter:** token bucket **~2 rps** (`UW_MAX_RPS`), concurrency 3,
300ms spacing, breaker opens after 8×429/60s → 45s pause; **hunt budget** caps a Night Hawk hunt to
**12 genuine live UW calls** (`uw-hunt-budget.ts`), everything else served from Redis (pre-warmed by
the `uw-cache-refresh` cron). Consumers: market-wide context (`market-wide.ts`), per-candidate
dossier (`dossier.ts`), Cortex earnings veto (`cortex/fetch.ts`), 0DTE earnings gate
(`zerodte/earnings.ts`), flow-ingest cron (`flow-ingest.ts`).

| fn (file:line) | endpoint | data | 0DTE consumer | cache |
|---|---|---|---|---|
| `fetchMarketFlowAlertRows` (`unusual-whales.ts:721`) | `/api/option-trades/flow-alerts` | market flow alerts (premium, strike, expiry, side, sweep) | flow-ingest cron; market-wide; dossier | 15s + Redis + 30m stale |
| `fetchUwMarketTide` (`:536`) | `/api/market/market-tide` | net call/put premium, bias | market-wide | 180s/300s |
| `fetchUwSectorTide` (`:1467`) / `fetchUwEtfTide` (`:1593`) | `/api/market/{sector}/sector-tide`, `/{etf}/etf-tide` | sector/ETF tide | market-wide sector watch | 180/300s |
| `fetchUwTickerFlowAlerts` (`:1322`) | `/api/stock/{ticker}/flow-alerts` | per-ticker flow | market-wide index tickers | on-demand |
| `fetchUwMarketTopNetImpact` (`:1554`) | `/api/market/top-net-impact` | top net-premium tickers | market-wide | 300s |
| `fetchUwMarketOiChange` (`:1562`) | `/api/market/oi-change` | market OI-change | market-wide | 300s |
| `fetchUwUnusualTrades` (`:1537`) | `/api/unusual-trades/recent` | recent unusual trades | market-wide | 120s |
| `fetchUwMarketTotalOptionsVolume` (`:2145`) | `/api/market/total-options-volume` | total options vol | market-wide | on-demand |
| `fetchUwGroupGreekFlow` (`:2100`) | `/api/group-flow/{group}/greek-flow` (mag7) | net delta/gamma bias | market-wide | 180s |
| `fetchUwEconomyIndicator` (`:2082`) | `/api/economy/{gdp\|cpi\|unemployment}` | macro series | market-wide | 3600s |
| `fetchUwEarningsPremarket/Afterhours` (`:2163/2168`) | `/api/earnings/{premarket\|afterhours}` | earnings names | market-wide **+ 0DTE G-11 gate** | on-demand |
| `fetchUwPredictionsConsensus` (`:1934`) | `/api/predictions/{insiders\|smart-money\|unusual\|whales}` | prediction consensus | market-wide; dossier | on-demand |
| `fetchUwScreenerStocks` (`:1529`) | `/api/screener/stocks` | screener confirm | dossier | 600s |
| `fetchUwCongressTrades` (`:1483`) / `…Unusual` (`:2229`) | `/api/congress/recent-trades` | congress trades | dossier | 1800s |
| `fetchUwIvRank` (`:577`) | `/api/stock/{t}/volatility/stats` | iv_rank (EOD) | dossier | 3600s |
| `fetchUwDarkPool` (`:871`) | `/api/darkpool/{ticker}` | dark-pool prints | dossier | 120s |
| `fetchUwOiChange` (`:1354`) | `/api/stock/{t}/oi-change` | intraday OI by strike | dossier | on-demand |
| `fetchUwIvTermStructure` (`:1370`) | `/api/stock/{t}/volatility/term-structure` (+fallback) | IV term curve | dossier | on-demand |
| `fetchUwRealizedVol` (`:1650`) / `fetchUwRiskReversalSkew` (`:1655`) | `/api/stock/{t}/volatility/realized`, `/historical-risk-reversal-skew` | RV, RR-skew | dossier | on-demand |
| `fetchUwFlowPerExpiry` (`:1505`) | `/api/stock/{t}/flow-per-expiry` | flow by expiry | dossier | 120s |
| `fetchUwInsiderTransactions` (`:1663`) / `fetchUwInstitutionOwnership` (`:2283`) | `/api/insider/transactions`, `/api/institution/{t}/ownership` | insider / institutional | dossier | on-demand |
| `fetchUwGreekFlow` (`:1967`) | `/api/stock/{t}/greek-flow` | net delta/gamma | dossier | on-demand |
| `fetchUwFdaCalendar` (`:1671`) | `/api/market/fda-calendar` | FDA catalysts | dossier | 1800s |
| `fetchUwOptionChains` (`:2196`) | `/api/stock/{t}/option-chains` | chain expiries (fallback after Polygon) | option-chain prompt | on-demand |
| `fetchUwTickerNextEarnings` (`:2185`) | `/api/earnings/{ticker}` | next earnings date | Cortex veto | 1h |

> UW GEX endpoints (`fetchUwOdteGexLadder` etc.) exist but feed the **SPX desk / Largo**, *not* the
> Night Hawk positioning path — Night Hawk gets GEX from **Polygon** (see §7-E). Not double-counted.

---

## 3. Unusual Whales — WebSocket

One multiplexed socket `wss://api.unusualwhales.com/socket?token=${UW_API_KEY}` (`ws/uw-socket.ts:102`),
server-side, leader-locked (`uw:ws:leader`). 10 channels (`UW_WS_CHANNELS`):

| channel | data | lands | 0DTE consumer | freshness |
|---|---|---|---|---|
| `flow_alerts` | option flow alerts (premium/strike/expiry/side/sweep/score) | **Postgres `flow_alerts`** via `persistAndPublishFlowAlert` + SSE | **PRIMARY discovery input** (via DB, §6); fires out-of-band `warmZeroDteBoard` | stall watchdog 75s RTH |
| `option_trades` (`SPX,SPY`) | option tape prints; **re-persisted as flow** | `optionTradesStore` + `flow_alerts` | secondary flow source | 120s |
| `trading_halts` | halt events (symbol, type, active) | `tradingHaltsStore.halts` | **0DTE halt gate G-11** (fail-closed helper; board opts out — see D2) | event-only; freshest-across-channels proxy; 30m expiry |
| `gex_strike_expiry` (`SPX` + dynamic) | per-strike/expiry GEX (call/put gamma OI, net_gex) | `gexStrikeExpiryByTicker` | **GEX wall override** during RTH (5s WS vs 15s REST) | 60s; idle-prune 120s |
| `price` (`SPX,SPY`) | spot ticks | `priceByTicker` | tape-aligned spot; keeps socket alive 24/7 | 75s/300s |
| `market_tide` | net call/put premium | `tideStore`→Redis | desk tide/bias | 180s |
| `net_flow` (`SPX,SPY,QQQ,IWM`) | per-ticker call/put/net | `netFlowStore` | net-prem velocity | delivery-stamped |
| `off_lit_trades` | dark-pool prints | `darkPoolStore`→Redis | desk dark-pool | 120s |
| `interval_flow` | per-strike intraday call/put | `intervalFlowByTicker` | desk overlay | delivery-stamped |
| `lit_trades` (`SPY`) | lit prints | `litTradesStore` | lit/dark ratio | delivery-stamped |

**Flow → scan is via Postgres, not the socket:** `flow_alerts` frame → `insertFlowAlert`
(`flow-persist.ts:153`) → the scan reads it back with `fetchRecentFlows` (`db.ts:2121`). The socket's
only scan-facing job is keeping that table warm. A material print debounce-fires `warmZeroDteBoard`
(`uw-socket.ts:1275`) so the scan reacts to tape, not just the 5-min clock.

---

## 4. Polygon / Massive — REST

Base `https://api.massive.com` (`POLYGON_API_BASE`; audit scripts self-default to `api.polygon.io`),
`apiKey` query param. One funnel `polygonTrackedFetch` (`polygon-rate-limiter.ts:330`): token bucket
~150 rps (effectively uncapped on Advanced), concurrency 48, breaker 5×429→60s pause. Benzinga + Fed
macro ride the **same** Polygon key.

| fn (file:line) | endpoint | data | 0DTE consumer | cache |
|---|---|---|---|---|
| `fetchChainBand`/`fetchPolygonAtmOptionsChain` (`polygon-options-gex.ts:2796/2975`) | `/v3/snapshot/options/{underlying}` | per-contract greeks, IV, OI, `last_quote{bid,ask}`, `last_trade`, `underlying_asset` | GEX walls, chain, positioning bundle (nighthawk) | Redis `polygon:odte_gex_bundle` 15s |
| `fetchOptionsUnifiedSnapshot` (`options-snapshot.ts:301`) | `/v3/snapshot` (`ticker.any_of`, ≤250) | per-OCC greeks/IV/OI/`last_quote{bid,ask,bid_size,ask_size}` | **contract plan + live-mark REST fallback** | `nw:optsnap:{occ}` 120s |
| `fetchHeatmapBand` (`:1345`) | `/v3/snapshot/options/{underlying}` | full chain for GEX/VEX/DEX matrix | pin-discovery, cortex | cron-warmed `gex-heatmap:{root}` |
| `fetchPolygonOiByExpiry` (`:3201`) | `/v3/reference/options/contracts` | OI by expiry | expiry discovery | on-demand |
| `fetchTradesForContract` (`option-trades.ts:264`) | `/v3/trades/{occ}` | price/size/`sip_timestamp`(ns) | flow-verifier, gex-intraday-adjust | `option-trades:` ~30s |
| `fetchAggBars` (`polygon-largo.ts:41`) | `/v2/aggs/ticker/{sym}/range/{m}/{span}/{from}/{to}` | OHLCV bars | **intraday bias, VIX, grading**; technicals | per-stage `withServerCache` (3/10min) |
| `fetchPolygonOptionBars` (`:462`) | `/v2/aggs/ticker/O:{occ}/…` | option OHLCV | **plan grading** | on-demand |
| `fetchIndexSnapshot(s)` (`polygon.ts:380/417`) | `/v3/snapshot/indices` | index value, session close/change | GEX spot, market-wide | on-demand |
| `fetchStockSnapshot(s)` (`polygon.ts:130`) | `/v2/snapshot/locale/us/markets/stocks/tickers/{sym}` | day OHLC, prevDay, lastTrade | GEX spot, gap proxy | on-demand |
| `fetchDailyMarketSummary` (`polygon.ts:231`) | `/v2/aggs/grouped/locale/us/market/stocks/{date}` | whole-market OHLCV (~12k) | **banger scan**, breadth | daily |
| `fetchMarketMovers` (`polygon.ts:327`) | `/v2/snapshot/.../{gainers,losers}` | top movers | market-wide | on-demand |
| `fetchPolygon{Macd,Rsi,Ema,Sma}` (`polygon-largo.ts:88+`) | `/v1/indicators/{macd,rsi,ema,sma}/{sym}` | server-side indicators | nighthawk technicals | on-demand |
| `fetchMarketStatusNow` (`polygon.ts:1411`) | `/v1/marketstatus/now` | RTH gating | scan gate | 60s |
| `fetchTickerNews`/`fetchMarketCatalysts` (`polygon-news.ts:150/170`) | `/benzinga/v2/news` | catalysts/news | dossier synthesis | 2min |
| `fetchPolygonMacroBackdrop` (`polygon-macro.ts:145`) | `/fed/v1/{treasury-yields,inflation}` | macro backdrop | synthesis | 1h |
| reference/fundamentals (`polygon.ts:824+`, `largo:152+`) | `/v3/reference/*`, `/stocks/v1/*`, `/stocks/financials/v1/*` | details, short-interest, financials | dossier | 1h |

> **No REST halt/LULD endpoint exists** — halt/band state reaches the app only via the Massive
> stocks WS (§5). `fetchIndexMinuteBars`/`fetchStockMinuteBars` (`polygon.ts:732/742`) are byte-identical
> duplicates (cleanup note, not a bug).

---

## 5. Polygon / Massive — WebSocket

Three server-side clusters on `socket.massive.com`, each leader-locked, auth `{"action":"auth","params":POLYGON_API_KEY}`.

| cluster / URL | channels | symbols | data | lands | 0DTE consumer |
|---|---|---|---|---|---|
| **indices** `…/indices` (`ws/polygon-socket.ts:27`) | `A.*` (1s agg), `V.*` (tick) | `I:SPX,I:VIX,I:VIX9D,I:VIX3M,I:TICK,I:TRIN,I:ADD` | OHLC / value ticks | `indexStore` + Redis `spx:pulse:snapshot` | SPX/VIX regime, pulse SSE, SPX candle |
| **stocks** `…/stocks` (`stocks-socket.ts:22`) | `A.*` (all-stock, ~8k), `LULD.{T}` (default `SPY`) | every US stock; SPY | agg `c,v`; LULD band/indicator | `stock-candle-store`; `luldHaltsStore` | banger/discovery spot; **SPY LULD → 0DTE halt gate G-11** (SPY halt proxies SPX/SPXW) |
| **options** `…/options` (`options-socket.ts:53`, env-gated) | `Q.{OCC}` (NBBO), `T.{OCC}` (trade) | held + 0DTE active/setup OCCs, ≤1000 | bid/ask, trade price | `optionMarks` + Redis `nw:optmark:{OCC}` (15s) | **0DTE live-marks lane** → SSE |

**Live marks (two-tier, `live-marks.ts`):** Tier-1 options WS mark (mid-of-bid/ask, 2.5s fresh
window, cross-replica via Redis); Tier-2 **REST `/v3/snapshot` fallback** for any OCC without a fresh
WS tick — and this is the tier that carries **greeks** (Δ Γ Θ V IV), which the WS does not. A WS
failure silently degrades to REST; never breaks valuation. Staleness bars: WS-fresh 2.5s, engine-exit
mark ≤5s, protective latch ≤30s.

**Halts:** LULD frame → `normalizeLuldWsMessages` (`polygon-luld.ts:27`) → indicator 3/5/6=halt,
4=reopen → `luldHaltsStore` (30m self-expiry) → merged with UW halts in `uw-socket.ts:1027` → 0DTE
G-11 (`scan.ts:541`). LULD de-risks the UW halt SPOF (stale only when *both* down).

---

## 6. Pipeline binding — scan-stage → source/transport

Entry: cron `warmZeroDteBoard` (`scan.ts:1214`) + member-poll, both → `scanZeroDteBoard` (`scan.ts:182`).

| stage | provider | transport | freshness |
|---|---|---|---|
| candidate discovery / flow tape | UW | **Postgres** `fetchRecentFlows` (`db.ts:2121`, 7h, max_dte 1) | table kept warm by UW WS worker |
| multi-day accumulation | UW | Postgres (120h window) | spans prior sessions — not cold at open |
| underlying spot & SPY bias | Polygon | **REST now** `fetchAggBars` | `zerodte:intraday:*` 3min; G-1 fails closed >15min |
| option chain + contract pick | Polygon | **REST now** `/v3/snapshot` (2.5s soft-deadline) | uncached per scan |
| GEX walls / pin / regime | Polygon **+ UW-WS override** | **Redis composite** `vector:full-state:*` (Polygon base) + UW-WS ladder override RTH | 15min cache; WS override live |
| greeks & live mark (open plays) | Polygon + Massive options WS | **WS-first via Redis `nw:optmark`, REST fallback** | 1s poll; WS 2.5s fresh |
| VIX / regime (G-4) | Polygon | REST now `fetchAggBars("I:VIX",day)` | `zerodte:vix-open` 10min |
| macro (G-7) | Polygon/Benzinga + curated fallback | REST now `macroEventsOnDateLive` | `zerodte:macro` 10min |
| earnings (G-11) | UW | cached read `readGridEarnings` (cron-warmed) | market-wide snapshot |
| halts (G-11) | UW + Massive LULD | **in-memory-from-WS** (synchronous) | live store per replica |
| grading | Polygon | **REST now** `fetchAggBars` minute/day | per grade pass, 10min throttle |

**Boundaries:** live-via-REST = spot/VIX/chain/greeks/macro/grading. Postgres = flow tape + ledger +
open Slayer play. Redis-warm = option marks, vector-full-state composite, board snapshot. In-memory-WS
= UW halts, GEX override, option marks. **Grading is pure Polygon REST against the frozen ledger row**
(no UW, no WS).

---

## 7. Field-by-field consumption ledger

Legend: **ingested** Y/N · **fresh** = TRACKED+CHECKED / BLIND · **basis** = official / PROXY.

### A. Evidence-gate + raw-score (UW flow print, `board.ts deriveZeroDteSetups`)
`premium`(Y/kept/official), `ask_pct`(Y/BLIND/official→aggression), `option_type`, `alert_rule`(sweep),
`fill_price`(Y/BLIND→`flow_avg_fill`), `open_interest`(Y/BLIND, T-1 settle), `strike`, `expiry/dte`
(date-checked), **`underlying_price`(Y / BLIND, not aged vs now / PROXY — UW alert-embedded spot, not
a live quote)** → drives `no_underlying_price` fail-closed + moneyness gates, `alerted_at`(spike).
Computed: `otm_pct`, `side_dominance`, `score`. `flow_quality` populated but **not gated** (evidence
only).

### B. Intraday edge (Polygon minute bars)
`intraday.{vwap,last,or_break,trend_5m}`(Y / `last_bar_ms` carried) → G-10; **`bias`(SPY)(Y /
TRACKED+CHECKED via `biasAsOfMs` + `MARKET_BIAS_MAX_AGE_MS` 15min, G-1 fail-closed / PROXY — SPY = "the
market")**; `market_aligned`; time-of-day nudge.

### C. Contract plan (Polygon `/v3/snapshot`)
`bid/ask/mark`(Y / **BLIND** / official·mark=midpoint) → G-9; `bidSize/askSize`(Y/BLIND) → WS-04
`thin_size` (**enforced**); **`quoteAgeMs`(N — DROPPED at mapper `options-snapshot.ts:82-121`; raw
`last_quote.last_updated` exists at `:42`) → `plan_quote_stale` DORMANT**; `flow_avg_fill`(Y/BLIND /
PROXY — smart-money's fill, floored up to `markAtFlag` for achievability); `entry/stop/target`
(−50/+100 rules); `time_stop_et=15:30`(PROXY for settlement); `quote_invalid_reason`(fail-closed
malformed-book verdict, age branch dormant).

### D. Hard-gate stack (`ZeroDteGateInput`)
`vixDayOpen`(Y / day-OPEN, cached 10min / **PROXY — not intraday VIX**) → G-4; `vixUnavailable`
(fail-closed signal); `macroEvents`(official calendar) + `macroUnavailable`(fail-closed) → G-7;
`governor`(Postgres ledger + Redis stops / official) → G-5, null → `gate_context_unavailable`;
`slayerLive`/`nighthawkTake`(Postgres, recency-bounded) → G-6; **`earnings`(UW / today-match /
official) → G-11 — but see D1 fail-open**; **`halted`(UW / `failClosedOnStale:false`) → G-11 — see
D2**; `confluence.confirmations` → G-12; `intradayConflict` → G-10; `nowEtMinutes` → G-2 (10:00);
`requireHealthySource`/`sourceHealth` (**default OFF** — WS-21 no-op unless
`ZERODTE_REQUIRE_HEALTHY_SOURCE=1`).

### E. Cortex layer (survivors only, `failClosedOnVetoBlind:true`)
gex-walls (Polygon / **TRACKED — `asOf` + 15min half-life decay** / VETO-capable), flow-quality (UW /
`asOf` / VETO-capable), plus wall-trend/darkpool/vex-charm/catalyst-news/sector-breadth (support/oppose
only). **Veto-blind firewall:** both veto sources absent → HOLD; total Cortex outage → ABSTAIN
(commits on hard gates alone). See D4.

### F. Condor branch (dormant unless `ZERODTE_CONDOR=1`, PIN origin, SPX/NDX)
`regime.*` off GEX; 4-leg `bid/ask`(BLIND, same quote-age gap; conservative shorts@bid/wings@ask =
PROXY for realized credit); `condor_range_break` = spot-distance heuristic (PROXY for a Cortex
gex-walls "range-intact" read); `est_win_rate` = SPY/QQQ/IWM table applied to any root (PROXY, capped 97).

### G. Feature vector — persisted, **consumed by nothing**
`buildSetupFeatureVector` flat row (evidence/dossier/flow-quality/regime/technicals/`vix`/`spy_bias`/
`confluence`/`direction_owner`/`merge_policy_version`…). Every field `null` when its source wasn't
threaded (never fabricated). Keystone for future probability/kNN/Kelly layers only.

### Dormant / dead in prod
`quoteAgeMs` + `plan_quote_stale` (D3); WS-21 `source_recovering` (flag OFF); condor branch (flag OFF);
`confluence.score/tier`, `flow_quality`, `flow_accumulation`, per-directional condor geometry, feature
vector — all populated but gated/graded by nothing (calibration only).

### Proxies standing in for official values
15:30 close ↔ settlement (`plan.ts:366`); `flow_avg_fill` ↔ achievable member entry; SPY read ↔ "the
market"; day-open `I:VIX` ↔ vol regime; conservative condor credit ↔ realized credit;
`condor_range_break` ↔ Cortex range read; `est_win_rate` ETF table ↔ per-root WR.

---

## 8. Market-open readiness — NORMAL-empty vs BROKEN

**Master mask:** G-2 blocks all fresh commits before **10:00 ET**. Empty board 09:30–10:00 = by design.

- **Genuinely warming (empty at 09:30, fills by ~09:35–10:00):** SPY bias/VWAP/opening-range (needs
  RTH bars); VIX day-open bar (can lag minutes). Both hold their gates **closed** while empty — safe.
- **NOT cold (populated at 09:30):** GEX walls/pin (prior-settle OI, intraday-volume blended);
  multi-day flow accumulation (120h window); prior-session OHLC; macro calendar (curated fallback).
- **Cold *and* fail-open (the watch items):** halt store + earnings snapshot — emptiness is
  indistinguishable from "nothing to report" and is **not** masked past 10:00 if the feed never warms.
  These are D1/D2.

**Operator rule of thumb:** empty board before 10:00 = normal; empty after 10:00 with a live tape =
fail-closed gates correctly holding; a board that **prints while halts/earnings are cold** = the real
red flag.

---

## 9. Operational constraints for Monday

- **UW ~2 rps + 12-call hunt budget.** Live per-candidate dossier datums that are *uncached*
  (oi-change, term-structure, realized-vol, skew, greek-flow, insider, institution) are the ones the
  hunt budget bounds; if the `uw-cache-refresh` cron is cold, market-wide/dossier degrade to
  empty/cached rather than blocking. Confirm that cron is firing pre-open.
- **Polygon effectively uncapped** (Advanced) — the numeric spine (spot/chain/greeks/VIX/grading) is
  the resilient part.
- **One leader replica per socket.** A post-deploy window where the leader hasn't re-acquired = the
  cold-halt-store case (D2). Prefer deploying well before the open.
- **Board snapshot** (`zerodte:board:snapshot:v1`) is SWR — a member sees the last snapshot until the
  next cron tick refreshes it.

---

## 10. Remediation hooks

D1–D3 are folded into the master remediation chain as pre-market hardening (all strictly *safer* —
they can only withhold a commit, never add one). They mirror the existing `vix_unavailable` /
`macro_unavailable` fail-closed pattern. Because they touch what commits, they land tested + on
branches and are **deploy-risky (explicit go before prod)**, not auto-merged into the live commit path.
See `docs/audit/FINDINGS.md` and the WS ledger.
