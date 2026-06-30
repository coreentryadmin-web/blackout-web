# BlackOut Grid — Deep End-to-End Audit
Last updated: 2026-06-30 00:35 ET (automated run)
Market status: **CLOSED** (overnight — Tue 2026-06-30 00:35 ET; RTH panels show last-session data, `grid-warm` cron correctly idle)

## Overall Health: **PASS** (with 1 × P1 data-quality + several P2 cleanups)

Every one of the 12 board panels is wired to a real upstream, returns HTTP 200, and serves
non-fabricated live data. **Zero empty panels. Zero mock/placeholder data.** The `grid` tool is
launched (`LAUNCHED_TOOLS = heatmap,nighthawk,largo,grid`), so `/api/grid/*` is reachable by premium
users and the cron Bearer. All probes below were run live against the apex host with `Bearer CRON_SECRET`.

The architecture is a clean cache-reader: the `grid-warm` cron is the single cluster-wide writer
(`grid:*` Redis keys), and every `/api/grid/*` route reads the snapshot with a single-flight
read-time fallback (`uwCacheGet`) so panels still populate even when the cron is idle (as it is
overnight). That fallback is why every panel returned fresh data at 00:35 ET despite the warmer
being off — confirmed by the ≈0-min `as_of` on the cold panels.

## Panel Status (live probe @ 00:35 ET, market closed)
| Panel | API Endpoint | Provider | Status | Count | Freshness | Issues |
|---|---|---|---|---|---|---|
| Market Pulse | /api/market/spx/merged | SPX desk | 200 | merged payload | live | none |
| Unified News | /api/market/news (+ BenzingaNewsRail) | Polygon/Benzinga | 200 | 15 articles | today | `source: null` on items (cosmetic) |
| Notable Flow | HELIX `fetchFlows` + SSE | HELIX flow plane | 200 | live tape | live/SSE | none (reuses HELIX, no new ingest) |
| Analyst Actions | /api/grid/analysts | Polygon/Benzinga analyst channel | 200 | 50 actions | today | classifier coarse (many → `other`) |
| GEX Regime | /api/market/gex-positioning?ticker=SPX | Massive options chain | 200 | spot/flip/walls | live (00:31Z) | none |
| Top Movers | /api/grid/movers | Polygon snapshot | 200 | 12 gain / 12 lose | last session | micro-cap dominated (see Quality) |
| Earnings Radar | /api/grid/earnings | UW pre/after-hours | 200 | 3 items | today | **EPS + name null on all rows (P1)** |
| Dark Pool | /api/grid/dark-pool | UW dark pool recent | 200 | 40 prints | last session | `side` always `unknown` (field map) |
| Congress | /api/grid/congress | UW congress trades | 200 | 24 trades | filed thru 06-16 | `party` shows chamber not R/D |
| Economic Calendar | /api/grid/economy | UW macro indicators | 200 | 7 indicators | data thru 05-01 | indicator readings, not a fwd calendar |
| Sector Heat | /api/market/heatmap | Polygon sector ETFs | 200 | 11 sectors | live | none |
| Catalysts | /api/grid/catalysts | Polygon/Benzinga channels | 200 | 20 items | today | **not pre-warmed by cron (P2)** |

Endpoints exercised but **not mounted on the board** (orphans): `/api/grid/sectors` →
`GridSectorsPanel` (board uses `/api/market/heatmap` for sector heat instead).

## Empty Panels (P0 — Every Empty Panel = Wasted Feature)
**None.** No panel returned `available: false` and no panel returned 0 items. The Grid is fully
wired end-to-end. (Note: the skill's assumed endpoint names — `/api/grid/news`, `/api/grid/flows`,
`/api/grid/analyst` — do not exist; News reuses `/api/market/news`, Flow reuses the HELIX plane, and
the analyst route is `/api/grid/analysts`. None of those are bugs, just naming.)

## Data Quality Spot Check
Sampled one live record per panel (00:35 ET):

- **Analysts** ✅ real — `"Watching Biodexa Pharmaceuticals; Zacks Small-Cap Research Gives Stock $10 Price Valuation"` (BDRX, 2026-06-29T18:08Z). *Caveat:* classifier tagged this price-target story as `other`; the `classifyAnalystAction` regex misses Zacks/"$N valuation" phrasings, so many genuine PT/rating items fall into `other`. Data is real and fresh; the action label is coarse.
- **Catalysts** ✅ real — `"To The Moon, Alice"` (SPCX, type `ipo`, 2026-06-29T21:47Z). Benzinga, today.
- **Congress** ✅ real — Matthew Robert Van Epps, TPR sell, `$15,001 – $50,000`, filed 2026-06-16, chamber `house`. Real disclosure. *Caveat:* `party` field carries the chamber (`house`/`senate`), not the political party.
- **Economy** ✅ real — CPI 335.123 vs prior 333.02 (+0.63%, as-of 2026-05-01) with a 4-month `rows` history; all 7 indicators present (CPI, UNEMPLOYMENT, GDP, FED-FUNDS, RETAIL-SALES, PAYROLLS, TREASURY-YIELD). *Caveat:* this is a **macro-indicator readings** panel (latest vs prior values), not a forward "Economic Calendar" with release dates / consensus / ET times — the board labels it "Economic Calendar" but the content is trailing indicator levels.
- **Earnings** ⚠️ **degraded** — 3 rows (AVAV, CNXC, ELTP) all `afterhours`, but `name: ""`, `eps_estimate: null`, `eps_actual: null`, `surprise_pct: null` on **every** row. Tickers are real but the panel shows no company name and no EPS data. Either the UW pre/after-hours endpoint isn't returning `eps_estimate`/`name` for these rows, or the field mapping in `shapeEarningsRows` is missing the live field names. **P1 — verify on a real reporting day during RTH.**
- **Dark Pool** ✅ real-ish — MUU, premium $102,366, size 99 @ $1,034, `side: unknown`, executed 2026-06-29T23:59:59Z. Real off-lit print but `side` never resolves (always `unknown` → the `r.side`/`r.direction` field isn't present in the UW payload), and notionals skew small.
- **Movers** ✅ real — DMC +694.17% @ $28.59 (gainer), FAMI −77.62% @ $0.275 (loser). Real Polygon snapshot but, being %-sorted, the list is dominated by micro-cap / penny-stock extremes rather than liquid large-caps.
- **News** ✅ real — `"Trading Halt: Halted at 7:50:00 p.m. ET …"` (TRNR, 2026-06-29T23:50Z). Fresh. `source: null` on the item (cosmetic — rail doesn't render source).
- **GEX** ✅ real & live — SPX spot 7440.43, flip 7435.99, call_wall 7450, put_wall 7350, net_gex 6.18B, asof 2026-06-30T00:31Z.
- **Sectors** ✅ real — Technology (XLK) +2.37% — but via the orphaned `/api/grid/sectors`; the board renders sector heat from `/api/market/heatmap`.

## Data Sources
| Panel | Provider | Endpoint / Feed | Warmed by grid-warm? |
|---|---|---|---|
| Market Pulse | SPX desk | /api/market/spx/merged | no (SPX desk owns it) |
| Unified News | Polygon/Benzinga | fetchBenzingaNews → /api/market/news | no (market/news warm) |
| Notable Flow | HELIX | fetchFlows + SSE | no (HELIX plane) |
| Analyst Actions | Polygon/Benzinga (analyst channels) | grid:analysts | **yes** |
| GEX Regime | Massive options chain | /api/market/gex-positioning | no (heatmap-warm) |
| Top Movers | Polygon | grid:movers | **yes** |
| Earnings | UW pre/after-hours | grid:earnings | **yes** |
| Dark Pool | UW | grid:dark-pool | **yes** |
| Congress | UW | grid:congress:v5 | **yes** |
| Economy | UW macro indicators | grid:economy:v2 | **yes** |
| Sector Heat | Polygon sector ETFs | /api/market/heatmap | no (market heatmap) |
| Catalysts | Polygon/Benzinga (catalyst channels) | grid:catalysts | **NO ← gap** |
| (orphan) Sectors | Polygon | grid:sectors | yes (but unconsumed) |

## Unused / Orphaned Endpoints
- **`/api/grid/sectors` + `GridSectorsPanel` + `warmGridSectors`** — fully built and warmed every
  cron cycle, but the board mounts `GridSectorHeatmapPanel` (`/api/market/heatmap`) for sector heat.
  `GridSectorsPanel` is imported nowhere. `warmGridSectors` burns one Polygon `fetchSectorPerformance`
  call per 2-min cycle that nothing reads. Either mount `GridSectorsPanel` or drop the warm + route.
- The skill cross-references a "Polygon Benzinga audit" for endpoint-coverage gaps. Benzinga feeds
  already power News, Analysts, and Catalysts. No additional entitled Benzinga channel is unmapped
  on the Grid; the per-ticker Catalysts path even uses a dedicated `fetchBenzingaCatalysts`.

## Grid Warm Cron
- **Service:** `grid-warm` — `scripts/hit-cron.mjs /api/cron/grid-warm`, `cronSchedule = */2 11-21 * * 1-5`.
- **Cadence:** every 2 min during the 11–21 UTC band; route self-skips outside 9:30–16:00 ET via DST-aware `inMarketHours`. `stale_after_min: 15` in the watchdog registry.
- **Running now:** **No (correctly skipped)** — it's 00:35 ET, market closed. Verified by the skip path; panels still serve via read-time fallback.
- **Panels warmed:** 7 of 8 cacheable panels — `warmGridAnalysts, warmGridDarkPool, warmGridEarnings, warmGridCongress, warmGridEconomy, warmGridSectors, warmGridMovers`.
- **Gap:** **`warmGridCatalysts` is NOT in the cron's `Promise.allSettled` array** (`src/app/api/cron/grid-warm/route.ts:66-74`). Catalysts is therefore never pre-warmed — every TTL expiry (300s) during RTH makes the first viewer eat the Benzinga round-trip, which violates the cache-reader "single cluster-wide writer" promise for that one panel. It still serves data (read-fallback), so not user-visible, but it's an architectural inconsistency.
- **Partial-warm note:** Movers + Sectors are warmed but at market close return last-session values (expected). `warmGridSectors` output is unconsumed (orphan, above).

## Recommendations
**P0 — Empty panels needing wiring:** none. Grid is fully wired.

**P1 — Stale / low-quality data:**
1. **Earnings panel shows tickers with null EPS + null company name.** Investigate `shapeEarningsRows`
   (`src/lib/providers/grid.ts:185-207`) vs the live UW `earnings/premarket` & `earnings/afterhours`
   payload field names — `eps_estimate`/`name` are coming back null for all rows. Verify on a real
   reporting morning during RTH; if the endpoint genuinely omits estimates for these rows, surface a
   clearer "estimate pending" state rather than a blank EPS, or pull estimates from the per-ticker
   earnings history path that already maps `street_mean_est`.

**P2 — Cleanups / enhancements:**
2. **Add `warmGridCatalysts()` to the `grid-warm` cron array** so Catalysts honors the cache-reader
   rule like the other 7 panels.
3. **Resolve the orphaned Sector path** — either mount `GridSectorsPanel` (`/api/grid/sectors`) on the
   board or delete the route + `warmGridSectors` + component so the cron stops making an unread
   Polygon call every 2 min.
4. **Field-mapping polish:** Dark-pool `side` resolves to `unknown` for every print (map the actual
   UW direction field); Congress `party` carries the chamber, not R/D; News items have `source: null`.
   All cosmetic but each is a small "looks unfinished" tell.
5. **Analyst classifier coverage** — `classifyAnalystAction` drops Zacks/price-valuation phrasings into
   `other`; broaden the regex so genuine PT/rating actions are labeled (improves the panel's signal).
6. **Economy panel naming** — board labels it "Economic Calendar" but it renders trailing indicator
   levels (CPI/GDP/PAYROLLS values), not a forward release calendar with consensus + ET times. Either
   rename to "Macro Indicators" or add an actual events calendar (UW `economic-calendar` feed) for the
   FOMC/CPI/NFP forward dates the skill expects.
7. **Movers quality** — the %-sorted Polygon snapshot is all micro-caps; consider a liquidity / price
   floor so the panel surfaces tradable large-cap movers.

## Probe Method (reproducibility)
- Host: `https://blackouttrades.com` (apex — `www` strips the `Authorization` header → 401).
- Auth: `Bearer CRON_SECRET` pulled live via `railway variables --service blackout-web --json`
  (local `.env.local` secret is stale). `grid` is in `LAUNCHED_TOOLS`, so `requireToolApi("grid")`
  passes for premium/cron callers.
- No secrets are printed in this report.
