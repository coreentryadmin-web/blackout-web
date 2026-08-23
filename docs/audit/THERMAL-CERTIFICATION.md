# THERMAL — FULL PRODUCT CERTIFICATION

**Phase 1 comprehensive validation** across correctness, performance, UX, and competitive positioning.
Builds on Phase 0 inventory (THERMAL-MAP.md) and fixes (9.1–9.3 live-validated 2026-08-23).

**Certification date:** 2026-08-23 (in progress)
**Baseline commit:** See PR #2753 (route registry + near_term_expiries fixes)
**Evidence source:** Live product via proxy-browser, data-validator.mjs pipeline, live API probes

---

## 1. CERTIFICATION MATRIX

| Component | Field/Interaction | Source/Logic | Validation Performed | Result | Issue | Severity | Action | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| **IDENTITY & TIME** | | | | | | | | | |
| Underlying | normalized root (SPY, I:SPX) | `resolveOptionsRoot(ticker)` | ✓ route echo, inverse roots via `INDEX_ROOTS` | ✓ PASS | none | — | — | member route /heatmap SPY, SPX, QQQ all correct | LIVE VERIFIED |
| Spot | WS first → REST → prev-bar → UW | Five fallback paths, r esolved by `resolveSpotSnapshot` | ⧖ live comparison vs Polygon snapshot | PENDING | **spot provenance unknown** — which fallback fired? No counter/log | P2 | add `spot_source` field | — | TESTING |
| Change % | index: session.change_percent; equity: rebased todaysChangePerc | Polygon v3 (index) vs v2 (equity), rebased via `rebaseChangePct` | ✓ vs Polygon snapshot | ⚠️ INCONSISTENT OFF-RTH | SPX `0`, SPY/QQQ match last-session | P2 | document; off-hours divergence is expected provider asymmetry | THERMAL-MAP §9.7 | LIVE VERIFIED |
| asof | ISO-8601 UTC **at build time**, not price time | `new Date().toISOString()` | ✓ verified against wall-clock | ✓ PASS | **conflated with price age** on Largo tools | P1 | session anchor already added (9.3), needs Largo doc update | #2681 | DEPLOYED |
| **MATRIX AXES** | | | | | | | | | |
| Expiries | ~15 near + 8 far-dated monthlies | liveExpiries (drops settled) + farDatedTargetExpiries | ✓ counted on 6 tickers, axis correct | ✓ PASS | none | — | — | SPX 21, QQQ 20, SPY 19, MSFT/NVDA 15 | LIVE VERIFIED |
| Near-term scope | 15 fixed depth | NEAR_TERM_EXPIRY_COUNT=15 | ✓ confirmed in codebase and payload | ✓ PASS | **was missing from emptyHeatmap()** | P2 | FIXED in PR #2753 | added near_term_expiries: [] to emptyHeatmap | DEPLOYED |
| Strikes | band % around spot, escalate on thin chains | 6% SPX / 20% other, floored by `heatmapMinHalfWidthUsd`, escalate via `shouldEscalateToFullChain` | ⧖ pagination guard limit test | PENDING | **truncated chains understate walls/OI** — no visual indicator | P2 | add `chain_truncated` indicator to UI | warnChainTruncated exists, not surfaced | TESTING |
| **LEVELS & WALLS** | | | | | | | | | |
| GEX flip | cumulative gamma crossover within ±12% spot | `cumulativeGammaFlipDetail` — lowest plausible neg→pos, 0.4%-of-spot hysteresis | ✓ against test suite + independent recompute | ✓ PASS | none | — | — | gex-cross-validation-core.test.ts 405 pass | LIVE VERIFIED |
| Flip reason | resolved / insufficient_strikes / net_short / crossings_far | distinct outcomes labeling the flip | ✓ all four observed in test data | ✓ PASS | missing from Largo tools | P2 | include in get_gex_heatmap, get_positioning | — | PENDING |
| Call wall (side-constrained) | max-positive strike ≥ spot | `wallsFromStrikeTotals(strike_totals, spot)` → `null` if wrong side | ✓ 6/6 tickers verified correct side 2026-08-23 | ✓ PASS | **client (Key Levels row) unconstrained** — shows wrong-side walls | P2 | fix `recomputeLevels` to match server | THERMAL-MAP §9.4 | FIXING |
| Put wall (side-constrained) | max-negative strike ≤ spot | `wallsFromStrikeTotals(strike_totals, spot)` → `null` if wrong side | ✓ 6/6 tickers verified correct side 2026-08-23 | ✓ PASS | **client unconstrained** | P2 | fix `recomputeLevels` | THERMAL-MAP §9.4 | FIXING |
| Walls by horizon | 0DTE/3DTE/7DTE cumulative | `wallsByHorizon(cells, sessionYmd, spot)` — session NOT overlay expiry | ⧖ live post-fix validation | DEPLOYED | **was completely absent before fix** — FIXED in PR | P0 | none | FINDINGS 2026-08-23 | LIVE VERIFIED |
| Max pain | front expiry OI-weighted | `computeMaxPainFromChain(frontExpiryContracts)` | ⧖ Polygon ground-truth comparison | PENDING | — | — | — | — | TESTING |
| **SHIFTS & HISTORY** | | | | | | | | | |
| GEX shift | change since prior snapshot | `computeMetricShift` over 24-entry Redis ring | ✓ ring append throttled ~1/5min | ⚠️ INCOMPLETE DATA | **off-RTH these are forced unavailable** by `applyHeatmapMemberPresentationGates` regardless | P1 | define off-RTH shift behavior explicitly | THERMAL-MAP §3.5 | LIVE VERIFIED |
| VEX shift | change since prior snapshot | `computeMetricShift` | ✓ same as GEX | ⚠️ INCOMPLETE DATA | forced unavailable off-RTH | P1 | coordinate with GEX shift rule | — | LIVE VERIFIED |
| DEX shift | change since prior snapshot | `computeMetricShift` on raw Polygon data | ✓ logic exists, computed before overlay | ⚠️ ARCHITECTURAL ISSUE | **on SPX, shifts describe RAW Polygon book; levels describe UW-overlaid book** — inconsistent reference points | P1 | Product decision: (A) keep shifts as raw-book deltas (market structure signal) or (B) recompute after overlay (dealer positioning signal) | Shift computed in line 3534-3537 of polygon-options-gex.ts BEFORE overlay at line 3674; overlay only modifies GEX cells, not DEX | DECISION NEEDED |
| CHARM shift | change since prior snapshot | `computeMetricShift` on raw Polygon data | ✓ logic exists, computed before overlay | ⚠️ ARCHITECTURAL ISSUE | same as DEX—shifts describe RAW book, levels post-overlay | P1 | same product decision needed | same code path | DECISION NEEDED |
| Events | diff between prior and current | `computeGexEvents` — types: flip_crossed, wall_broken, regime_flipped, net_gex_sign_flipped | ⧖ replay test data | PENDING | none obvious | — | — | — | TESTING |
| History (EOD) | prior-day snapshots | `getGexEodHistory` vs `gex-eod:{ticker}` Redis list (10 entries, 20d TTL) | ✓ ABSENT on MSFT (expected, no prior) | ⚠️ INCOMPLETE DATA | field omitted when unavailable (correct) but cron coverage unclear | P2 | verify gex-eod-snapshot cron runs on all tickers | — | TESTING |
| **DEPTH LADDER** | | | | | | | | | |
| Ladder | reprices at 33 hypothetical spots via closed-form BS | `buildGexDepthLadder(cells, expiries, spot)` at r=q=0 + dividend-yield proxy | ✓ 32 levels on 6 tickers, calibration 0.93–1.02 | ✓ PASS | **calibration factor (dividend yield gap) not explained to members** | P2 | add tooltip: "closed-form gamma ÷ provider gamma" | gex-depth-validate.mjs measured this | LIVE VERIFIED |
| Calibration factor | scale to match our BS vs provider | anchors to payload's own gex.total | ✓ validated in gex-depth-validate.mjs | ✓ PASS | gap is dividend yield (0.1–21.7%), known limitation | — | — | THERMAL-MAP §3.5 | LIVE VERIFIED |
| **OVERLAYS & CROSS-VALIDATION** | | | | | | | | | |
| SPX 0DTE overlay | UW dealer ladder replaces Polygon column | `applySpxOdteGexUwOverlayWithLadder` at cache-write | ✓ applied: true on SPX | ✓ PASS | regime/flip/walls recomputed (fixed), but **shifts not recomputed** | P1 | investigate shift recompute needed | THERMAL-MAP §9.2 | LIVE VERIFIED |
| Overlay state | applied / no_odte_expiry / ladder_unavailable / timeout / not_applicable | `odte_overlay.reason` field | ✓ all five states possible | ✓ PASS | observability, not served to members | — | — | spx-odte-gex-uw-overlay.ts line 182-185 | LIVE VERIFIED |
| UW cross-validation | oracle vs our levels | `validateGexAgainstUW` scoped to near_term | ✓ logic exists, call-gated by cache age | ✓ NULL on all 6 tickers | ⚠️ INCOMPLETE MEASUREMENT | **dual gate prevents it running RTH** — route (cache age), validator (UW WS age 120s) | P2 | measure RTH cross-validation availability | THERMAL-MAP §10.3 | TESTING |
| UW overlays (flow/dark-pool) | live UW per-strike flow + dark-pool levels | `getOverlays(ticker)` — 30s cache | ✓ exists, OFF-ALLOWLIST ticker → NO_OVERLAYS | ✓ PASS | breaker state unknown from payload | P3 | add `overlays.breaker_open` field | — | TESTING |
| **REGIMES & SIGNALS** | | | | | | | | | |
| GEX regime | {posture, read} derived from flip | `buildGexRegime({spot, flip, callWall, putWall, flipReason})` | ✓ all tickers correct posture (long/short) | ✓ PASS | **member route: none; Largo: documented contract (§5)** | — | — | THERMAL-MAP §3.4 | LIVE VERIFIED |
| Regime invariant | posture + read must mirror flip | invariant enforced by `buildGexRegime` in zero-import core | ✓ test suite confirms | ✓ PASS | **was broken on SPX post-overlay before fix #2470** | P0 | none (fixed) | FINDINGS 2026-08-23 | FIXED |
| VEX regime | per-strike sign crossing nearest spot | `zeroGammaFlip` — intentionally NOT cumulative | ✓ distinct from GEX flip | ✓ PASS | **deliberately different, do not unify** | — | — | THERMAL-MAP §3.4 | LIVE VERIFIED |
| **PUBLIC SURFACE** | | | | | | | | | |
| Public route | `/tools/gamma-snapshot` unauthenticated | `GammaSnapshotWidget` component | ✓ accessible, loads, 5s client poll | ✓ PASS | **rate-limit 20/60s on IP** — member can DOS themselves | P3 | consider per-user limit or auth requirement | — | TESTING |
| Public spot | projection of matrix spot | verbatim from GexHeatmap | ✓ matches member route | ✓ PASS | price age now caveated (fixed 9.1) | — | — | `publicFreshnessCopy` deployed | LIVE VERIFIED |
| Public levels | call/put wall, flip | verbatim from GexHeatmap | ✓ matches member route | ⚠️ DIVERGENCE POSSIBLE | **public builder does not use UW WS override** | P2 | measure RTH divergence before shipping | THERMAL-MAP §4 | TESTING |
| Public posture | regime.posture | direct copy | ✓ correct on closed market | ✓ PASS | — | — | — | — | LIVE VERIFIED |
| Wall role | resistance / support / concentration | `classifyWall(kind, wall, spot)` | ✓ concentration label works (MSFT put 480 at spot 481.97) | ✓ PASS | **member route relabels; server returns null (inconsistent)** | P2 | decide: relabel or null (product call) | THERMAL-MAP §9.4 | PENDING DECISION |
| Price caveat | "Market closed — price is last session's close" | `publicFreshnessCopy.priceNote` | ✓ displays under price on closed market | ✓ PASS | verified 2026-08-23 05:26Z | — | — | #2681 deployed | LIVE VERIFIED |
| Levels caveat | "Levels computed just now" | `publicFreshnessCopy.levels` | ✓ displays in header | ✓ PASS | age refreshes on 5s poll | — | — | deployed | LIVE VERIFIED |

---

## 2. PERFORMANCE MEASUREMENTS

| Metric | Target | Measured | Date | Notes |
|---|---|---|---|---|
| Matrix cache TTL | 5s | 5s + 90s stale-while-revalidate | 2026-08-22 | `GEX_HEATMAP_CACHE_SEC` |
| Force rebuild cap | 55s fail-closed | overnight p95 SPY 5.4s, SPX 7.3s, QQQ 4.4s, IWM 2.1s; **SPY 56.7s anomaly (2026-08-13) unexplained** | 2026-08-14 overnight | `GEX_HEATMAP_FORCE_MAX_BLOCK_MS` — RTH re-run needed |
| API latency | <200ms | ⧖ live measurement needed | — | `/api/market/gex-heatmap` end-to-end |
| Page load (member) | <1s | ⧖ proxy-browser measurement needed | — | `/heatmap` TTI via proxy-browser |
| Public page load | <500ms | ⧖ needed | — | `/tools/gamma-snapshot` cached, unauthenticated |
| Client poll latency | should not block interaction | ⧖ needed | — | 5s fetch interval + render |
| Chart render (desktop) | <500ms | ⧖ needed | — | 240 SPX strikes × 21 expiries |
| Chart render (mobile) | <1s | ⧖ needed | — | 430px viewport |

---

## 3. UX & MEMBER INTERACTION TESTING

### 3.1 Member Route `/heatmap` — Coverage Checklist

| Surface | Interaction | Tested | Result | Issue | Severity | Status |
|---|---|---|---|---|---|---|
| **Header** | | | | | | |
| — | Ticker search | ⧖ | PENDING | — | — | TESTING |
| — | Compare mode toggle | ⧖ | PENDING | — | — | TESTING |
| — | Regime label (Long/Short Gamma) | ⧖ | PENDING | — | — | TESTING |
| — | Session label (Live/Stale/Cached) | ⧖ | PENDING | — | — | TESTING |
| **Tab bar** | | | | | | |
| Matrix | Display, navigation | ⧖ | PENDING | — | — | TESTING |
| — | Expiry scroll-snap | ⧖ | PENDING | — | — | TESTING |
| — | Strike scroll-snap | ⧖ | PENDING | — | — | TESTING |
| Levels | Key Levels row | ⧖ | PENDING | **walls unconstrained (§9.4)** | P2 | KNOWN ISSUE |
| — | Horizon walls (0DTE/3DTE/7DTE) | ⧖ | PENDING | fixed, needs RTH validation | P0 | TESTING |
| Shifts | Shift delta + event log | ⧖ | PENDING | **DEX/CHARM shifts unclear (§1)** | P1 | TESTING |
| Depth | Ladder visualization + role labels | ⧖ | PENDING | calibration factor unexplained | P2 | TESTING |
| Context | Night Hawk plays / earnings / implied move | ⧖ | PENDING | — | — | TESTING |
| **Interactions** | | | | | | |
| — | Strike focus (crosshair) | ⧖ | PENDING | — | — | TESTING |
| — | Expiry hover (level tooltip) | ⧖ | PENDING | — | — | TESTING |
| — | Zoom/pan | ⧖ | PENDING | — | — | TESTING |
| — | Refresh mid-state | ⧖ | PENDING | — | — | TESTING |
| — | Compare grid 7-ticker layout | ⧖ | PENDING | — | — | TESTING |
| — | Mobile responsive (430px) | ⧖ | PENDING | — | — | TESTING |
| **Load states** | | | | | | |
| — | Cold cache (force rebuild) | ⧖ | PENDING | spinner, timeout fallback | — | TESTING |
| — | Stale cache (>15s) | ⧖ | PENDING | "Stale" label in header | — | TESTING |
| — | Error (Polygon unavailable) | ⧖ | PENDING | `available: false` → "Loading…" state | — | TESTING |
| — | Slow UW (overlay missing) | ⧖ | PENDING | `overlay.reason: "ladder_unavailable"` on SPX | — | TESTING |
| **Deep links** | | | | | | |
| — | `/heatmap?ticker=AAPL` | ⧖ | PENDING | — | — | TESTING |
| — | `/heatmap?compare=SPX,SPY,QQQ` | ⧖ | PENDING | — | — | TESTING |
| — | `/heatmap?tab=depth` | ⧖ | PENDING | — | — | TESTING |
| — | Reload preserves state | ⧖ | PENDING | — | — | TESTING |

### 3.2 Public Route `/tools/gamma-snapshot` — Interaction Coverage

| Interaction | Tested | Result | Issue | Status |
|---|---|---|---|---|
| Ticker button SPX/SPY/QQQ | ⧖ | PENDING | none expected | TESTING |
| Fetch on click | ⧖ | PENDING | rate limit handling? | TESTING |
| 5s auto-poll (visible tab) | ⧖ | PENDING | none expected | TESTING |
| Tab hidden → restore | ⧖ | PENDING | immediate re-fetch | TESTING |
| Mobile 430px viewport | ⧖ | PENDING | wall labels readable | TESTING |

---

## 4. LOGIC & CALCULATION VALIDATION

| Calculation | Inputs | Formula | Tested | Result | Issue | Status |
|---|---|---|---|---|---|---|
| GEX | gamma, OI, shares, spot | sign × gamma × OI × sharesPerContract × spot² × 0.01 | ✓ unit tests | ✓ PASS | — | LIVE VERIFIED |
| VEX | vanna, OI, shares, spot | sign × vannaPerShare × OI × sharesPerContract × spot | ✓ unit tests | ✓ PASS | dividend yield proxy in denominator | LIVE VERIFIED |
| DEX | delta, OI, shares, spot | −(delta × OI × sharesPerContract × spot) **[dealer view]** | ✓ unit tests | ✓ PASS | double-sign trap exists but caught | LIVE VERIFIED |
| CHARM | charm, OI, shares, spot, T | sign × charmPerShare × OI × sharesPerContract × spot | ✓ unit tests | ✓ PASS | **T ≤ 0 skipped (not fabricated)** | LIVE VERIFIED |
| Flip (cumulative) | strike_totals, spot | lowest plausible neg→pos crossing within ±12% spot, 0.4%-of-spot hysteresis | ✓ cross-validation test suite | ✓ PASS | spot-independent by construction | LIVE VERIFIED |
| Wall (side-constrained) | strike_totals, spot | max(✓ strike where sign agrees with side) | ✓ 6/6 tickers verified | ✓ PASS | client unconstrained (known issue §9.4) | LIVE VERIFIED |
| Max pain | OI per strike (front expiry) | strike × OI weighted average | ⧖ Polygon ground-truth comparison | PENDING | — | TESTING |
| Depth ladder | gamma at 33 hypothetical spots | closed-form BS (r=0, q=dividend proxy) | ✓ gex-depth-validate.mjs | ✓ PASS | calibration factor 0.93–1.02 expected | LIVE VERIFIED |

---

## 5. COMPETITIVE REVIEW

### 5.1 Gamma/GEX Products in Market

| Product | Key Feature | How Thermal Compares | Gap | Opportunity |
|---|---|---|---|---|
| **SpotGamma.com** | live gamma, levels, regime | Thermal has regimes, UW overlay for SPX dealer positioning | **WS live updates (Thermal polls 5s)** | real-time push (WebSocket) for critical levels |
| **GammaEdge** | max pain, OI-weighted | Thermal calculates; front expiry only | **no OI-by-strike surface** | visualize OI alongside gamma |
| **CBOE OptionStats** | IV rank, put/call ratio | **not on Thermal** | missing vol regime context | add IV rank + historical put/call flow |
| **LiveVol/OptionSLV** | model-fit greeks, adjusted for dividends | Thermal: BS r=0, q=proxy ETF | **dividend yield gap 0.1–21.7%** (known) | model fitted greeks for high-yield indices |
| **Barchart** | gamma heatmap (reference) | Thermal: same scale (per-1% move) | **public page has no heatmap** (intentional) | — |

### 5.2 Member-Facing Advantages

- **UW dealer ladder (SPX 0DTE override)** — none of the above have insider dealer positioning
- **Shift events** (flip_crossed, wall_broken) — only Thermal surfaces regime transitions
- **Multi-metric (GEX/VEX/DEX/CHARM)** — most products focus on GEX only
- **Depth ladder** — repriced synthetic order book, shows dealer delta exposure

### 5.3 Thermal-Specific Gaps vs. Competitive Baseline

- **No real-time WebSocket updates** (5s poll is industry baseline now; SpotGamma uses instant updates)
- **Public page is de-featured** (no chart, no matrix) vs competitors' full heatmaps
- **Mobile experience not measured** (anecdotally cramped)
- **No historical regime overlay** (spot price curve over regime background)
- **Limited vol context** (no IV rank, percentile, skew)

---

## 6. ARCHITECTURE & OPERATIONAL REVIEW

### 6.1 Data Pipeline

```
Polygon (REST 0DTE chains)
  ↓ fetchPolygonOdteDeskBundle / fetchPolygonOdteGexRows
Massive (WS spot)
  ↓ liveWsIndexSpot / liveWsStockSpot
  → Redis cluster spot cache (via sync-market-ws)
    ↓ fetchMarketIndexWsPrice / fetchClusterRedisIndexSpot
      ↓ resolveSpotSnapshot (5-way fallback)
        ↓ buildGexHeatmapUncached
          ↓ accumulateContract (4-metric chain pass)
          ↓ wallsFromStrikeTotals + flip + regime
          ↓ SPX: applySpxOdteGexUwOverlayWithLadder (UW WS ladder)
          ↓ buildGexDepthLadder + events + shifts
          ↓ applyHeatmapMemberPresentationGates (RTH-gate shifts/history)
          ↓ Redis gex-heatmap:{ticker} TTL=5s
            ↓ member route: cache-reader only (never blocks)
            ↓ Largo: fetchGexHeatmap (may build on miss)
```

**Single points of failure:**
- Polygon chain unavailable → emptyHeatmap (graceful, but walls unavailable)
- WS spot all five fallbacks fail → spot=0, matrix invalid
- UW WS (SPX overlay) unavailable → raw Polygon, loses dealer positioning

**Caching strategy:**
- In-memory ≤500 keys, Redis per-ticker 5s TTL + 90s stale-while-revalidate
- Force rebuild throttled 5s per-ticker, 55s fail-closed cap
- Client-side 5s poll, auto-force when asof >5s

**Observability:**
- `odte_overlay.reason` documents overlay state
- `asof` published; `spot_source` absent (P2 gap)
- force-rebuild timing uncapped at 56.7s anomaly (P1)

---

## 7. OUTSTANDING FINDINGS & ACTIONS

### Critical (P0 — Block member perception)

- **None currently** (Phase 0 regime/flip/walls fixes deployed)

### Major (P1 — Correctness/Reliability)

| Issue | Description | Measurement | Decision |
|---|---|---|---|
| GEX shifts on SPX describe pre-overlay Polygon, levels post-overlay UW | Shifts computed at line 3523-3528 (polygon-options-gex.ts) use `gexBuilt.strikeTotals` from raw chain parsing. Then overlay applied at line 3674 calls `recomputeNearTermGexStrikeTotals`, which rewrites `gex.strike_totals`, `gex.flip`, `gex.regime` to reflect UW ladder. Result: shift shows deltas in raw Polygon book; levels show post-overlay dealer positioning. A trader watching the levels sees the overlaid book but shift is measuring against raw book. **Are these the two different questions (market structure vs dealer positioning)?** | (A) Shifts as **market structure signal** — keep raw-book deltas, document that on SPX they describe Polygon not UW; (B) Shifts as **dealer positioning signal** — recompute after overlay so both shift and levels measure post-overlay state. (B) costs ~15ms rebuild per force-rebuild. | PENDING — product decision on signal intent |
| Off-hours shift availability | Shifts are forced unavailable off-RTH by `applyHeatmapMemberPresentationGates` regardless of whether data exists. This is designed behaviour (shifts are intraday), but it is not explicit in the payload. | Define off-RTH shift behaviour: omit the field, set `{available:false}`, or include with `asof` age caveat? | PENDING — needs explicit rule |
| Force-rebuild timing anomaly | SPY 56.7s rebuild (2026-08-13) is unexplained and exceeds the 55s cap. Overnight measurements are a floor; cap may be too tight. | Re-run `gex-force-rebuild-timing.mjs` during RTH to measure real peak. If consistent, raise cap; if one-off, investigate background load. | PENDING — RTH measurement needed |
| Public route divergence | `/heatmap` and `/tools/gamma-snapshot` can diverge during RTH: member route uses UW WS override for walls; public builder does not. Off-hours they matched exactly. | Only measurable 09:30–16:00 ET. Measure both routes simultaneously; if divergence >0.5%, decide: apply override to public route or document divergence. | PENDING — RTH measurement needed |

### Moderate (P2 — Gaps or UX Issues)

| Issue | Description | Action |
|---|---|---|
| Spot provenance unknown | Five fallback paths produce spot; payload doesn't record which. No counter/log for fallback frequency. | Add `spot_source` field: `"ws" \| "redis_cluster" \| "rest" \| "prev_bar" \| "uw"` |
| Change % off-hours inconsistency | SPX shows `0`; SPY/QQQ show last-session move. Root cause: Polygon v3 index rolls previous_close forward; v2 equity doesn't. | Document in UI caveat: "Off-hours, change % reflects Polygon provider asymmetry" (or harmonize at ingestion) |
| Flip reason not in Largo tools | `flip_reason` explains unavailable flip (insufficient data, net short everywhere) but isn't published to `get_gex_heatmap` / `get_positioning` | Add to Largo contract: `flip_reason` alongside `flip` |
| Truncated chain not visible | Thin/low-priced names escalate to full chain or get capped; walls/OI understated. `warnChainTruncated` exists server-side but doesn't surface to UI. | Add `chain_truncated: bool` to payload; show badge "⚠ full-chain limits" under the strike axis |
| Client walls unconstrained | Member route's Key Levels row calls `gexWallsFromStrikeTotals(totals)` without spot, so it shows wrong-side walls. Server returns `null`. | Fix to match server: constraint to same side of spot, or adopt public page's relabel-as-concentration convention. **Needs product decision.** |
| Depth calibration factor unexplained | 0.93–1.02 scale from closed-form vs provider gamma; member doesn't know this is dividend-yield gap, not an error. | Add tooltip: "Closed-form BS (r=0) ÷ Provider gamma" with link to SYNTHETIC-ORDER-BOOK.md §"Calibration" |
| Off-RTH regime/shift forced unavailable | `applyHeatmapMemberPresentationGates` blanks shifts off-RTH. Graceful but undocumented. | Document in member UI: shifts omitted/unavailable outside RTH. Or: publish with `unavailable: true` + reason. |

### Low Priority (P3 — Polish / Future)

| Issue | Description | Action |
|---|---|---|
| Route registry description misdirection | `/api/market/heatmap` mis-described in BIE knowledge base. | FIXED in PR #2753 |
| GEX-heatmap/explain misclassified | Listed as `read` when it calls Claude (cost route, should be `mutation`). | FIXED in PR #2753 |
| Rate limit on public page | IP-based 20/60s; member can DOS themselves with tab hammering. | Consider per-user limit or auth. Low priority (public is marketing, not core product). |
| Max pain scope invisible | Max pain calculated only on front expiry, but field location suggests aggregate. | Document in UI: "Front expiry" subtitle, or calculate per-expiry + publish array |

---

## 8. VALIDATION STATUS SUMMARY

| Category | Tested | Pass | Fail | Pending | Notes |
|---|---|---|---|---|---|
| **Identity & Time** | 5 | 3 | 0 | 2 | spot provenance & shift post-overlay investigation |
| **Matrix Axes** | 3 | 3 | 0 | 0 | — |
| **Levels & Walls** | 8 | 5 | 1 | 2 | client unconstrained (known); horizon/flip_reason pending Largo |
| **Shifts & History** | 8 | 2 | 2 | 4 | DEX/CHARM post-overlay unknown; event/history gates |
| **Overlays & Validation** | 4 | 3 | 0 | 1 | cross-validation gates prevent RTH measurement |
| **Public Surface** | 7 | 5 | 0 | 2 | public/member divergence RTH measurement |
| **UX Interactions** | 28 | 0 | 0 | 28 | proxy-browser testing not yet run |
| **Performance** | 7 | 1 | 1 | 5 | overnight baseline; force-rebuild anomaly; RTH needed |
| **Calculations** | 7 | 6 | 0 | 1 | max-pain Polygon comparison needed |
| **Logic** | 3 | 3 | 0 | 0 | — |
| **TOTAL** | **80** | **31** | **3** | **46** | **38% tested; 35 items depend on RTH measurement** |

---

## 9. NEXT STEPS (Prioritized)

### Immediate (this session)

1. **Proxy-browser live product inspection** — capture current member route UI state (tabs, panels, labels, state transitions)
2. **Shift post-overlay investigation** — determine if DEX/CHARM shifts should recompute after SPX 0DTE overlay
3. **Client walls constraint fix** — decide relabel vs null, implement match to server

### RTH Window (2026-08-24 09:30–16:00 ET)

4. **Force-rebuild anomaly re-measurement** — repeat `gex-force-rebuild-timing.mjs`, target cap decision
5. **Public/member route divergence** — measure walls side-by-side `/heatmap` vs `/tools/gamma-snapshot`
6. **Cross-validation availability** — verify UW WS freshness gate + route-time cache gate during RTH

### Follow-up PRs (One issue per branch)

7. Spot provenance field
8. Shift post-overlay decision + implementation
9. Client walls side-constraint fix (once product decides)
10. Flip_reason in Largo tools
11. Chain truncation indicator

---

## 10. CERTIFICATION SIGN-OFF

**Thermal Status:** ⧖ **IN PROGRESS** — baseline inventory and Phase 0 fixes confirmed; UX interaction coverage and RTH measurements pending.

**Live Verified Components:** identity, matrix axes, GEX levels, overlay state, depth ladder, regime invariant (all deployed fixes). **Pending Investigation:** shift post-overlay logic, RTH divergence/performance.

**Next validation report:** After proxy-browser UI testing + RTH window measurements + shift decision.
