# BLACKOUT THERMAL — THE MAP

**Phase 0 deliverable** of the Thermal owner lane (`docs/agents/briefs/thermal.md`), which gates
every fix PR on it. This is the living inventory: for each field a member or Largo sees — what it
is, where it comes from, how it is calculated, what generated it, when it last updated, what units,
what makes it unavailable, how we know it is correct, and where else it is consumed.

Everything below was read out of the code at `9b20b63c` or **measured live on 2026-08-22** against
production. Nothing is carried over from another document without re-checking it. Where provenance
could not be established the entry says **UNKNOWN** rather than guessing.

> Companion files, all still authoritative for their own subject:
> `docs/audit/LARGO-PRODUCT-CONTRACT.md` (the ten-point contract), `docs/audit/SYNTHETIC-ORDER-BOOK.md`
> (the depth ladder), `CLAUDE.md` (audit tooling + environment realities), `AGENTS.md`.

---

## 1. Coordinates

| Area | Where |
|---|---|
| Member route | `/heatmap` → `src/app/(site)/heatmap/page.tsx` → `ThermalPageShell` → `Heatmap` → `GexHeatmap.tsx` (4,530 lines) |
| Public route | `/tools/gamma-snapshot` → `src/app/(marketing)/tools/gamma-snapshot/page.tsx` → `GammaSnapshotWidget` — **unauthenticated, 5s client poll** |
| Public API | `/api/public/gex-snapshot` — IP rate-limited 20/60s, ticker allowlist SPX/SPY/QQQ |
| Member APIs | `/api/market/gex-heatmap` (single), `…/batch` (compare grid), `…/explain` (LLM narrative), `/api/market/gex-positioning`, `/api/market/gex-matrix-deltas` (SSE) |
| Admin API | `/api/admin/gex/health` → `src/lib/admin-gex-health.ts` |
| Core engine | `src/lib/providers/polygon-options-gex.ts` (4,602 lines) — the matrix build |
| Pure level math | `src/lib/providers/gex-cross-validation-core.ts` (zero imports, shared with the SPX 0DTE overlay) |
| Canonical read | `src/lib/providers/gex-positioning.ts` — strict cache-reader, "the ONE source every other tool consumes" |
| Depth ladder | `src/lib/gex-depth.ts` + `serializeGexDepthLadder`/`buildDepthBlockForExpiries` in the engine |
| Cell format/colour | `src/lib/gex-heatmap-display.ts` (shared with the SPX Slayer left rail) |
| Feature libs | `src/features/thermal/lib/` (13 files) · components `src/features/thermal/components/` (12 files) |
| Crons | `heatmap-warm`, `gex-alerts`, `gex-eod-snapshot`, `thermal-discord` (+ `thermal-discord?breach_only=1`) |
| Largo tools | `get_positioning`, `get_gex_heatmap`, `get_gex_matrix_changes`, `get_thermal_compare`, `get_wall_dynamics`, `get_gex_regime_events` (= `THERMAL_ENGINE_TOOL_NAMES`), plus `get_helix_thermal_compare` (shared boundary with Helix) |

**The GEX core is shared with Vector.** `polygon-options-gex.ts`, `gex-cross-validation-core.ts` and
`gex-depth.ts` back Vector's `/api/market/vector/{gex-heatmap,gex-ladder}` as well as Thermal. Any
change to the build, the wall scan or the flip is a two-product change.

### `get_gex` is NOT a Thermal tool — the charter's tool list is wrong here

The lane brief lists `get_gex` as Thermal-owned. `tool-defs.ts:995-1006` documents, verified against
`run-tool.ts`'s case bodies, that **none of `get_gex`'s three branches read Thermal's matrix**: for
SPX/I:SPX at today's expiry it reads SPX Slayer's live desk; otherwise `fetchPolygonOdteGexRows` →
`fetchPolygonOdteDeskBundle`, a separate spot-keyed 0DTE bundle; failing that, ad-hoc UW
spot-exposure calls. It is excluded from `THERMAL_ENGINE_TOOL_NAMES` for exactly this reason. The
tool the brief means is `get_gex_heatmap`. `get_gex_heatmap`'s own description already carries the
warning ("NOT the same as get_gex").

Conversely the brief omits two tools that ARE in the Thermal cohort: `get_positioning` (the canonical
`getGexPositioning` read) and `get_wall_dynamics`.

### Test baseline

Node 20 (`/opt/node20/bin`, v20.20.2), `node --import tsx --experimental-test-module-mocks --test`,
34 Thermal/GEX test files: **405 pass / 0 fail** at `9b20b63c` on 2026-08-22. Note this container
shipped Node 20 pre-installed but with **no `node_modules`** — `npm ci` (547 packages) was required
first, and without it ~6 files fail as dependency noise. Running these files with plain
`npx tsx --test` (no `--experimental-test-module-mocks`) fails 6 of them; that flag is not optional.

---

## 2. The serve model — read this before any freshness question

Thermal is not one payload. It is a **matrix lane**, an **overlay lane**, a **cross-check lane** and
a **client re-scope** rendering into one screen, each with its own age. Most correctness questions
about Thermal are really "which lane am I looking at".

| Lane | Built by | TTL / cadence | Cache | Read path |
|---|---|---|---|---|
| Matrix (GEX/VEX/DEX/CHARM cells, levels, depth, shift, events, history) | `buildGexHeatmapUncached` | `GEX_HEATMAP_CACHE_SEC` **5s** (SPX: `SPX_GEX_HEATMAP_CACHE_SEC`, also 5s) | in-memory `cachedHeatmaps` (≤500 keys) + Redis `gex-heatmap:{root}` | `fetchGexHeatmap` (may build) / `readGexHeatmapSnapshot` (never builds) |
| Overlays (HELIX flow-per-strike, dark-pool levels) | route-level `getOverlays` | **30s** | in-memory + Redis `gex-overlay:{ticker}` | `/api/market/gex-heatmap` only |
| Cross-validation (UW oracle vs our levels) | `validateGexAgainstUW` | request-time, **skipped when the matrix cache is fresh** | — | `/api/market/gex-heatmap`, `getGexPositioning` |
| Night Hawk context | `getNightHawkContext` | 60s | in-memory | `/api/market/gex-heatmap` |
| Public snapshot | `buildPublicGexSnapshot` | **5s** | Redis `public-gex-snapshot:{ticker}` | `/api/public/gex-snapshot` |
| Largo narrative | `/api/market/gex-heatmap/explain` | **180s** | in-memory + Redis | Anthropic call on miss |

**Stale-while-revalidate, and then some.** `GEX_HEATMAP_MAX_STALE_SEC` is 90s; the Redis key TTL is
derived from it. Past that, `pickStaleHeatmapForHandoff` returns `withinStale ?? any` — the `?? any`
branch serves a matrix of **unbounded age** rather than nothing. The member route is a pure
cache-reader (`loadHeatmapCacheReaderOnly` → `readGexHeatmapSnapshot`) and schedules a background
warm instead of blocking.

Measured 2026-08-22 23:21Z, live production, one authenticated read per ticker:

| Ticker | `asof` age | expiries | near-term | strikes |
|---|---|---|---|---|
| SPX | 26s | 21 | 15 | 240 |
| NVDA | 16s | 15 | 15 | 68 |
| SPY | 285s | 19 | 15 | 268 |
| QQQ | 290s | 20 | 15 | 299 |
| MSFT | **6,040s (1h41m)** | 15 | 15 | 65 |
| AAPL | **6,252s (1h44m)** | 15 | 15 | 121 |

Two matrices ~1.7 hours old were served with `available: true` and no staleness field in the payload
beyond `asof`. That is the designed behaviour (never block a member on a cold chain build) and the
Thermal UI does surface it — `thermalLayerFreshness` reads `asof` and paints `live` under 12s,
`stale` under 15s, `cached` beyond. **Largo's `get_gex_heatmap` does not**: see §5.

**Client poll + force.** The desk polls on `usePollIntervalMs` and requests `?force=1` when `asof`
is older than `MATRIX_FORCE_REFRESH_AGE_MS` (5s), throttled client-side at 5s and again
**server-side per ticker** at `FORCE_THROTTLE_MS` (5s). A force is capped at
`GEX_HEATMAP_FORCE_MAX_BLOCK_MS` (fail-closed 55s, chosen against the ALB's 120s idle timeout) and
falls back to the cached snapshot on timeout. `shouldForceBlankMatrixRefresh` restricts blank-column
auto-force to SPY/SPX/QQQ/IWM and only for the active column, so a 7-ticker sector compare grid
cannot fan out seven cold rebuilds.

---

## 3. Field inventory — the matrix payload

Type: `GexHeatmap` (`polygon-options-gex.ts:475`). Served by `/api/market/gex-heatmap` after
`roundFloats` → `applyHeatmapMemberPresentationGates` → `reconcileCellStrikeTotals` →
`reconcileStrikeTotal`.

### 3.1 Identity + time

| Field | What / units | Source → calculation | Unavailable when | Consumed by |
|---|---|---|---|---|
| `underlying` | normalized root, e.g. `SPY`, `SPX` | `resolveOptionsRoot(ticker)` — index tickers map to `I:*` options roots via `INDEX_ROOTS` | never (request echo) | everything |
| `spot` | underlying price, quote currency | `resolveSpotSnapshot(optionsRoot)`: **WS first** (`liveWsIndexSpot` / `liveWsStockSpot`, ≤`SPX_INDEX_WS_STALE_SEC` 120s) → cluster Redis index spot → REST snapshot (`/v3/snapshot/indices` for `I:*`, `/v2/snapshot/locale/us/…` for equities) → prev-day bar (`fetchSpotFromPrevBar`; `I:SPX` falls back to `SPY×10`) → UW `resolveSpotFromUwStockState` | all five fail → `emptyHeatmap(spot:0)`, negative-cached 10s | every downstream field, both pages, all six Largo tools |
| `change_pct` | signed day change, percent | index: `session.change_percent` from `/v3/snapshot/indices`; equity: `todaysChangePerc` from the v2 stock snapshot, **rebased** against the WS price via `rebaseChangePct` when a fresh WS tick exists | — (defaults to `0`) | Thermal header, `get_thermal_compare`, public payload, Discord card |
| `asof` | ISO-8601 UTC | `new Date().toISOString()` **at matrix build time** | never | freshness chips, `fmtAge` on the public widget, `get_gex_heatmap.asof` |
| `source` / `data_delay` | provenance | literals `"polygon"` / `POLYGON_OPTIONS_DATA_DELAY` = *"real-time (Massive Options Advanced plan)"* | never | display, Largo |

**`asof` is the age of the COMPUTATION, not of the price it models.** `get_thermal_compare` and
`get_helix_thermal_compare` say so explicitly in their tool descriptions. The public widget and
`get_gex_heatmap` do not — see §9.1 and §9.3.

**`spot` carries no provenance.** Five different resolution paths can produce it (live WS tick,
cluster Redis, REST snapshot, a *prior-session close* from the aggs prev-bar, or UW) and the payload
records which one **nowhere**. A prev-bar spot is a stale close wearing a current `asof`. **UNKNOWN:
how often the prev-bar or UW branch actually fires in production** — there is no counter or log line
distinguishing them.

### 3.2 The strike × expiry axes

| Field | What | Calculation | Notes |
|---|---|---|---|
| `expiries` | ascending expiry axis | the ~15 nearest live expiries (`liveExpiries` drops settled ones, keeping today's until the 16:00 ET close) **plus** a bounded set of 3rd-Friday monthly/quarterly OpEx columns out ~6 months (`farDatedTargetExpiries`, ≤`FAR_DATED_MAX_TARGETS` 8), merged by `resolveExpiryAxis` | measured: SPX 21, QQQ 20, SPY 19, single names 15 |
| `near_term_expiries` | the subset the LEVELS are summed over | `NEAR_TERM_EXPIRY_COUNT` = **15** | **auditors and clients must re-sum over this, not `expiries.slice(0,8)`** — the slice silently back-fills with far-dated columns when a name has <8 near dates (`resolveNearTermExpiriesForCrossValidation`) |
| `strikes` | descending, banded around spot | band is `SPX_HEATMAP_BAND_PCT` 6% for SPX, `DEFAULT_HEATMAP_BAND_PCT` 20% otherwise, floored by `heatmapMinHalfWidthUsd`; escalates to the full chain via `shouldEscalateToFullChain` on thin/low-priced names | pagination is capped by `OPTIONS_HEATMAP_PAGE_GUARD` / `OPTIONS_CHAIN_BAND_PAGE_GUARD`; a truncated chain emits `warnChainTruncated` and **understates walls/OI** |

### 3.3 The four metric blocks

All four are accumulated in **one chain pass** (`accumulateContract`), contract-deduped by
`gexContractDedupeKey`, skipping any contract with `oi === 0`, a non-call/put type, or
`expiry < todayEtYmd()`. `shares_per_contract` comes from the snapshot `details` (100 unless a
corporate action minted an adjusted contract).

| Block | Per-contract formula | Units | Sign convention |
|---|---|---|---|
| `gex` | `sign · gamma · oi · sharesPerContract · spot² · 0.01` | dealer $-gamma **per 1% move** (SpotGamma/Barchart scale) | calls `+1`, puts `−1` |
| `vex` | `sign · vannaPerShare(spot,K,T,σ,q) · oi · sharesPerContract · spot` | dealer $-vanna **per 1.00 change in σ** (= 100 vol points) | calls `+1`, puts `−1` |
| `dex` | `−(delta · oi · sharesPerContract · spot)` | dealer $-delta | **no call/put sign** — `delta` is already type-signed; the leading `−` makes it the dealer (counterparty) book. Double-signing pins DEX permanently positive |
| `charm` | `sign · charmPerShare(spot,K,T,σ,q) · oi · sharesPerContract · spot` | dealer $-charm **per year** of time-to-expiry (ACT/365) | calls `+1`, puts `−1` |

**The three scales are deliberately different and must not be aligned.** GEX is per-1%-move; VEX and
CHARM use the `× spot` notional convention. `vannaPerShare`/`charmPerShare` are closed-form
Black-Scholes at **r = 0**, q = the resolved dividend-yield proxy (`resolveHeatmapDividendYield`,
with `HEATMAP_DIVIDEND_YIELD_PROXY` mapping index roots to a proxy ETF). Contracts with no IV or
T ≤ 0 contribute 0 to VEX/CHARM and are skipped — never fabricated.

Per block: `cells` carry the **full near+far axis**; `strike_totals` and `total` sum the
**near-term subset only**. A far-only strike contributes 0 to `strike_totals`, so a $66B September
OpEx wall cannot swamp the actionable near-term levels — it still renders as a matrix column.

### 3.4 The levels

| Field | Calculation | Unavailable when | How we know it is correct |
|---|---|---|---|
| `gex.flip` | `cumulativeGammaFlipDetail(strike_totals, spot)` — cumulative net gamma summed from the bottom of the book, the **lowest** plausible neg→pos crossing within ±12% of spot, with 0.4%-of-spot hysteresis against the previous flip | see `flip_reason` | selection is spot-independent by construction (the fix for an 80-pt migration on a 0.2% SPX range, 2026-08-19). `gex-cross-validation-core.test.ts` covers it |
| `gex.flip_reason` | `resolved` / `insufficient_strikes` (data outage) / `net_short_everywhere` (no long-gamma region — a real read) / `crossings_far_from_spot` | — | **the field that stops an honest structural fact reading as an outage** |
| `gex.call_wall` / `put_wall` | `wallsFromStrikeTotals(strike_totals, spot)` — max-positive **above** spot, max-negative **below** spot | no qualifying strike on the correct side → `null`, never the wrong side | #2417 + the base-matrix follow-up. Measured 2026-08-22: all 6 tickers served walls on the correct side |
| `gex.walls_by_horizon` | `wallsByHorizon(cells, todayEtYmd(), spot)` — 0DTE/3DTE/7DTE cumulative | **see §9.2 — measured ABSENT on all 6 tickers** | — |
| `vex.flip`, `dex.zero_level`, `charm.zero_level` | `zeroGammaFlip` — per-strike sign crossing **nearest spot**, either direction. Deliberately NOT the cumulative gamma definition | <2 usable strikes | documented divergence from `gex.flip`; do not "unify" them |
| `vex.pos_wall` / `neg_wall` | `computeVexRegime` — max-positive / max-negative strike, **unconstrained by spot** | no non-zero strike | asymmetry with the GEX walls is deliberate: vanna walls are not resistance/support |
| `max_pain` | `computeMaxPainFromChain(frontExpiryContracts)` — **front expiry only** | front expiry has no contracts | max pain needs OI, not gamma, and cannot be summed across settlement dates |
| `max_pain_by_expiry` | the same question per expiry column | expiry has no contracts → `null` | precomputed server-side because the cells carry gamma, not OI |
| `gex.regime` | `buildGexRegime({spot, flip, callWall, putWall, flipReason})` | — | see the trace in §6 |

`GexRegime.flip` **mirrors `gex.flip` by construction** — posture and read are computed from the flip
passed in. That invariant is why `buildGexRegime` lives in the zero-import core module: the SPX 0DTE
overlay recomputes the flip and must be unable to leave a regime describing the pre-overlay book.

### 3.5 Derived / historical blocks

| Field | Source | Cadence | Unavailable when |
|---|---|---|---|
| `shift`, `vex_shift`, `dex_shift`, `charm_shift` | `computeMetricShift` over the `gex-history:{ticker}` Redis ring | ring appends on a **fresh compute only**, throttled ~1/5min, `GEX_HISTORY_MAX` 24 entries, `GEX_HISTORY_TTL_SEC` 3h | <2 usable snapshots → `{available:false, status:"collecting"}`; **and forced to that off-RTH by `applyHeatmapMemberPresentationGates`** regardless of what the cached compute produced |
| `events` | `computeGexEvents(ring, current)` — pure diff, types `flip_crossed` / `wall_broken` / `regime_flipped` / `net_gex_sign_flipped` | per fresh compute | **omitted** (not `[]`) on cold history, so "nothing crossed" is distinguishable from "no prior to diff" |
| `history_context` | `getGexEodHistory` over the `gex-eod:{ticker}` Redis list vs current | written once/day by the `gex-eod-snapshot` cron (`GEX_EOD_MAX` 10, TTL 20d) | no prior-day snapshot → field **omitted**. Measured: `sessions:1, prior:2026-08-21` on 5 of 6 tickers, ABSENT on MSFT |
| `depth`, `depth_by_scope` | `buildGexDepthLadder` — reprices the whole chain at ~33 hypothetical spots (closed-form BS, r=q=0, IV held fixed) and differences dealer delta | per fresh compute; **dropped entirely** by the rollover prune, because it holds no per-expiry breakdown to prune | build failure → field omitted. Measured: 32 levels, `calibration_factor` 0.93–1.02 on all 6 tickers |
| `gex.odte_overlay` | `applySpxOdteGexUwOverlay`, applied at **cache-write** for SPX only | per fresh compute | `{applied:false, reason}` on non-SPX / no 0DTE expiry / ladder unavailable / timeout. Measured SPX: `{applied:true}` |
| `cross_validation` | `validateGexAgainstUW` scoped to `near_term_expiries` | request-time | **skipped when the matrix cache is fresh** (`skipSlowEnrichment`) and for non-presets. Measured: `null` on all 6 tickers |
| `overlays`, `overlays_at` | `getOverlays` — UW flow-per-strike + dark-pool | 30s | off-allowlist ticker (`isHeatmapOverlayAllowed`) or UW breaker open (`isUwCircuitOpen`) → `NO_OVERLAYS`, never fabricated |

`depth.calibration_factor` is the scale applied to match the ladder's `netGammaAtSpot` to the
payload's own `gex.total`. Near 1.0 means our closed-form gamma and the provider's agree; the
documented raw disagreement is 0.1–1.7% on single names but 9.5–21.7% on SPY/QQQ/IWM, and **that gap
is the dividend yield the r=q=0 form does not model** — a known limitation, not a bug to fix.

---

## 4. Field inventory — the public page

`/tools/gamma-snapshot` is the only unauthenticated Thermal surface. `buildPublicGexSnapshot`
projects the matrix down to nine fields and adds two of its own.

| Field | From | Notes |
|---|---|---|
| `spot`, `change_pct`, `asof` | matrix, verbatim | |
| `call_wall`, `put_wall`, `flip` | `heatmap.gex.*`, verbatim | |
| `posture` | `heatmap.gex.regime.posture` | |
| `call_wall_role`, `put_wall_role` | `classifyWall(kind, wall, spot)` → `resistance` / `support` / `concentration` | the honest one-word claim when a wall sits on the far side of spot |
| `read` | `correctPublicRead(sanitizePublicRead(regime.read), …)` | sanitize drops vendor provenance, then correct drops wrong-side level claims |
| `available` | `false` + a warming string when the matrix is null | |

**What the public page does NOT get, deliberately**: the strike/expiry matrix, overlays, depth, shift,
events, history, cross-validation. That boundary is correct and should stay.

**What it does not inherit and arguably should**: the member route's UW-WS wall override and its
presentation gates. `/api/market/gex-heatmap` overrides `call_wall`/`put_wall` from the live UW
`gex_strike_expiry` ladder when fresh; `buildPublicGexSnapshot` calls `fetchGexHeatmap` directly and
does not. During RTH the two surfaces can therefore publish **different wall strikes for the same
ticker at the same instant**. Measured 2026-08-22 (WS idle, market closed) they agreed exactly —
SPX 7900/7600, posture `short` on both. **UNKNOWN: whether they diverge during RTH.** That is a
Phase 1 measurement, listed in §10.

---

## 5. Field inventory — the Largo boundary

| Tool | Reads | Time anchor | Freshness | Scope disclosed |
|---|---|---|---|---|
| `get_positioning` | `getGexPositioning` (cache-reader over the matrix) | `asof` (UTC ISO) | none | ✅ `near_term_expiries` |
| `get_gex_heatmap` | `fetchGexHeatmap` + `getGexPositioning` | `asof` (UTC ISO) | **none** | ⚠️ via `walls_by_horizon`, which is absent (§9.2) |
| `get_gex_matrix_changes` | current matrix vs the last warm snapshot | `asof` + `previous_asof` | implicit | n/a |
| `get_thermal_compare` | `getGexPositioning` per ticker, one frozen `now` | ✅ `as_of` (ET stamp) + `session_date` + `as_of_utc` | ✅ `market_session`, `et_time`, per-row `matrix_age_sec`, `freshness` | ✅ `expiry_scope` count + range |
| `get_helix_thermal_compare` | Helix tape + Thermal positioning | ✅ ET stamp + `session_date` | ✅ `thermal.freshness`, `thermal.age_seconds`, `thermal.matrix_session_date` | ✅ |
| `get_gex_regime_events` | Postgres `gex_regime_events` | per-row event `at` | n/a | n/a |
| `get_wall_dynamics` | `composeWallDynamicsRead` (Vector rail for single names) | UNKNOWN — not audited in this pass | UNKNOWN | UNKNOWN |

`get_positioning` and `get_gex_heatmap` are the two Thermal reads with **no ET session anchor, no
market-session phase, and no matrix age** — the exact gaps `get_thermal_compare` documents at length
and fixed for itself after measuring a 4.5-hour-old close served under a stamp that reads as "now".
See §9.3.

**`confidence` is correctly absent from every Thermal read.** Thermal has no calibrated confidence
to publish, and it publishes none. That is the contract's requirement (omission over fabrication),
and it is satisfied — this is a pass, recorded so a future change does not "helpfully" add one.

---

## 6. The trace — one regime classification, end to end

Real classification: **SPX, production, matrix built 2026-08-22T23:20:38.705Z**, read back at
23:21Z. Function named at every arrow.

```
INPUTS
  "SPX"
    → resolveOptionsRoot()            → { root: "SPX", optionsRoot: "I:SPX" }
    → resolveSpotSnapshot("I:SPX")
        → liveWsIndexSpot()           → null   (no WS tick within 120s — market closed)
        → readClusterIndexSpot()      → null
        → fetchIndexSnapshot("I:SPX") → { price: 7674.37, change_pct: 0 }
    → fetchHeatmapBand("I:SPX", 7674.37, "SPX")   ±6% band, paginated
    → resolveHeatmapDividendYield("SPX")          → q for the vanna/charm forms

FEATURES
  per contract → accumulateContract()
    → gexContractDedupeKey()          drop duplicates across the band + far-dated passes
    → filters: expiry >= todayEtYmd(), open_interest > 0, type ∈ {call,put}
    → GEX cell += sign · gamma · oi · sharesPerContract · spot² · 0.01
  → liveExpiries()                    drop settled columns
  → nearTermAxis = first 15           → farDatedTargetExpiries() → resolveExpiryAxis()
  → buildMetric()                     → cells (21 columns) · strike_totals (near-15) · total
                                        MEASURED: 240 strikes, total = −$20,822,103,896.93

CONDITIONS
  → cumulativeGammaFlipDetail(strike_totals, spot = 7674.37)
      cumulative sum bottom→top, record every neg→pos crossing
      MEASURED: crossings = 0
    → { flip: null, reason: "net_short_everywhere", nearestCrossing: null }

SCORE
  — none. Thermal's regime classification has NO scoring stage. Posture is a
    two-branch comparison, not a weighted model.

CONFIDENCE
  — none, and deliberately so. No confidence field is emitted anywhere in the
    Thermal payload (LARGO-PRODUCT-CONTRACT §confidence: omit when uncalibrated).

GATES
  → computeGexRegime(strike_totals, spot, flip, maxPain, flipReason)
      → wallsFromStrikeTotals(strike_totals, spot)   SIDE-CONSTRAINED
        MEASURED: callWall 7900 (above spot ✅), putWall 7600 (below spot ✅)
      → buildGexRegime({ spot, flip: null, callWall, putWall,
                         flipReason: "net_short_everywhere" })
          posture branch: flip == null AND reason == net_short_everywhere → "short"
          (had the reason been insufficient_strikes → null, honestly undetermined)
  → applySpxOdteGexUwOverlay()  at CACHE-WRITE, SPX only
        MEASURED: odte_overlay { applied: true, reason: "applied" }
  → route: applyHeatmapMemberPresentationGates()
        market not in cash RTH → shift.available forced false, narrative stripped
        MEASURED: shift { available: false, status: "collecting" }

DECISION
  gex.regime = {
    flip: null,
    posture: "short",
    read: "No gamma flip — dealers are net short gamma at EVERY strike, so there is
           no long-gamma region above spot 7,674.37 → short gamma: momentum / vol
           expansion, moves accelerate. Resistance 7,900, support 7,600."
  }

STATE TRANSITION
  → appendGexHistory(cacheKey, snapshot)   ring gex-history:SPX (≤24, ~5min throttle, 3h TTL)
  → computeGexEvents(ring, current)        MEASURED: [] (nothing crossed)
  → persistGexRegimeEvents("SPX", events)  fire-and-forget → Postgres gex_regime_events,
                                           cursor-throttled to DISTINCT transitions

OUTCOME — the same classification, fanned out
  /api/market/gex-heatmap      → Thermal desk         MEASURED posture "short", walls 7900/7600
  /api/public/gex-snapshot     → /tools/gamma-snapshot MEASURED (23:15Z) identical walls + posture
  getGexPositioning            → get_positioning, get_gex_heatmap, get_thermal_compare,
                                 get_helix_thermal_compare, get_ecosystem_context.gex_positioning
  /api/cron/thermal-discord    → Discord desk card + breach alerts
  /api/cron/gex-alerts         → web push (inert without GEX_ALERTS_PUSH + VAPID)
  /api/cron/gex-eod-snapshot   → gex-eod:SPX, tomorrow's history_context
```

The one thing worth staring at: **`posture: "short"` with `flip: null`**. Deriving posture only from
`spot >= flip` reported "undetermined" for six hours of a session in which SPX/SPY/QQQ were
unambiguously short-gamma (measured 2026-08-20). The `flipReason` branch is what makes a null flip a
regime rather than an outage — and `insufficient_strikes` still correctly yields `null`, because that
one *is* missing data.

---

## 7. Cron inventory

| Cron | Schedule (UTC) | Gate | Reads | Writes |
|---|---|---|---|---|
| `heatmap-warm` | `*/5 11-21 * * 1-5` + in-app leader ~20s | `inMarketHours` ET | builds the matrix for the sticky universe (static ∪ dynamic ≤100/14d, SPY/SPX/QQQ first) | the matrix cache |
| `gex-alerts` | `*/5 11-21 * * 1-5` | `GEX_ALERTS_PUSH` **and** `vapidConfigured()` — inert otherwise | cached matrix `events[]`, watchlist SPY/SPX/QQQ | web push + Redis dedup `gex-alert-sent:{ticker}:{type}:{etDate}` |
| `gex-eod-snapshot` | `10 20,21 * * 1-5` (both land at 16:10 ET, EDT and EST) | idempotent per ET day | cached matrix | `gex-eod:{ticker}` (10 days) |
| `thermal-discord` | `*/15 13-21 * * 1-5` | `isEtCashRth` unless `THERMAL_DISCORD_RTH_ONLY=0`; inert without `DISCORD_THERMAL_WEBHOOK_URL` | cached matrices for SPY/SPX/QQQ | Discord embed + matrix PNG; EOD recap ~16:05 ET |
| `thermal-discord` `?breach_only=1` | `*/5 13-20 * * 1-5` | same | same | breach alerts, per ticker+kind side dedup |

The dual-band `20,21` convention on `gex-eod-snapshot` is the DST-correct pattern (the off-offset
fire is a harmless idempotent no-op). `cron-dst-audit.mjs` has already cleared the Thermal crons in
both offsets; it found `x-autopost` and `banger-discovery` broken, not these.

**`thermal-discord` is absent from `src/lib/cron-registry.ts`.** So the staleness watchdog and
`bie/missed-alerts.ts` have no visibility into a cron that posts member-visible content and fires
breach alerts. It is not alone — `darkpool-discord`, `helix-discord-digest`, `nighthawk-edition` and
`x-engage` are also route-without-registry-entry — so this looks like a systemic gap in how Discord
crons were onboarded rather than a Thermal-specific omission. Flagged, not fixed: the registry is
shared, and widening it is a cross-lane change.

---

## 8. Two scopes, one screen — the divergence that is DESIGNED

This is the single most important thing to understand before calling a Thermal number wrong.

The server's authoritative levels are a **15-expiry near-term aggregate**. The Thermal desk defaults
its expiry scope to **one expiry** — `GexHeatmap.tsx` resolves the initial scope to `expiries[0]`,
not `"all"` — and re-derives flip, walls, net and max pain **client-side** from `gex.cells` for that
scope (`filterStrikeTotals` → `recomputeLevels`).

So the desk and the contract legitimately answer different questions at the same instant.
`gex-positioning.ts` records the measurement: on 2026-08-21, `/heatmap` scoped to one expiry showed
SPY **long gamma, flip 756, net GEX −$3.7B** while `getGexPositioning` showed **short, flip null,
net GEX −$10.98B**. Both correct for their scope.

The contract's answer is to **publish the scope** (`near_term_expiries`, `expiry_scope`,
`walls_by_horizon`) so an answer can name what it is quoting. That is the right answer and it should
not be "fixed" by forcing the two to agree.

**But the client re-scope is not a faithful mirror of the server's math.** `recomputeLevels` calls
`gexWallsFromStrikeTotals(totals)` — the **unconstrained** scan — while the server has called
`wallsFromStrikeTotals(totals, spot)` — **side-constrained** — since #2417 and its base-matrix
follow-up. See §9.4.

---

## 9. Findings opened while mapping

Recorded here, **not fixed** — Phase 0 gates fix PRs. Each gets its own branch, test and
`FINDINGS.md` entry when it is worked.

### 9.1 [P1, public surface] The public gamma snapshot presents a prior-session close as a live quote

`/tools/gamma-snapshot` renders `{ticker} Spot` beside `Updated {fmtAge(asof)}`, and the page copy
says it *"refreshes live every 5 seconds"*. `asof` is the **matrix build time**, so on a closed
market the widget rebuilds every 5s over unchanged data and prints **"Updated just now"** over the
last session's close, with no session label anywhere on the page.

**Measured 2026-08-22 23:15Z (Saturday, 19:15 ET), production:**

| Ticker | public `spot` | Polygon prev-session close (2026-08-21) | match |
|---|---|---|---|
| SPX | 7674.37 | 7674.37 | exact |
| SPY | 765.72 | 765.72 | exact |
| QQQ | 714.25 | 713.44 | +0.81 (a late-session print) |

`asof` on all three was within 20 seconds of the request. This is the "quote live presented over a
stale close" class the lane brief lists, on the one surface where a member context never gates it.
`get_thermal_compare` already solved exactly this for its own payload (`market_session`, `et_time`,
`session_date`) after measuring the same failure; the public page has no equivalent.

### 9.2 [P1, Largo boundary] `walls_by_horizon` is never set on a freshly-built matrix

`walls_by_horizon` exists to answer "where is the wall for the trade I am putting on today" — the
served aggregate is 15 expiries deep and measured 2.1% OTM on SPX where the front expiry's wall was
0.8% OTM. It is assigned in **exactly one place**: `prunePastExpiriesFromHeatmap`
(`polygon-options-gex.ts:1460`). That function early-returns the heatmap **unchanged** when
`heatmapHasPastExpiries` is false — and fresh builds already filter `expiry < today` at ingest, so it
is always false on a fresh build. `buildGexHeatmapUncached`'s own `gex: {…}` literal does not include
the field.

Net effect: the horizon walls appear only on a cached matrix that has survived an ET date rollover.

**Measured 2026-08-22, 6 tickers (SPY, SPX, QQQ, NVDA, MSFT, AAPL): `walls_by_horizon` ABSENT on all
six**, including two matrices 1.7 hours old. So `get_gex_heatmap.walls_by_horizon` is `null` in
practice, and the model is left with the aggregate and no way to name its scope — the precise
failure the field was added to prevent.

### 9.3 [P2, Largo boundary] `get_gex_heatmap` and `get_positioning` carry no session anchor and no freshness

Both publish a bare UTC `asof` and nothing else about time. `get_thermal_compare` and
`get_helix_thermal_compare` — reading the **same** `getGexPositioning` object — carry `as_of` as an ET
wall-clock stamp, `session_date`, `market_session`, `et_time`, `matrix_age_sec` and `freshness`,
because a UTC instant rolls its calendar date at 20:00 ET and a matrix age is not a price age.

Measured above: `get_gex_heatmap` on MSFT would have served a **6,040-second-old** matrix with
`asof` as its only time signal, and `spot: 483.49` — a 16:00 ET close — with nothing in the payload
saying the market was shut. Contract points 1 (time) and 2 (freshness).

### 9.4 [P2, member-facing] The client's scoped wall scan is unconstrained while the server's is side-constrained

`recomputeLevels` (`GexHeatmap.tsx:591`) calls `gexWallsFromStrikeTotals(totals)` with **no spot**,
so under the default single-expiry scope the Key Levels row can show a call wall below spot or a put
wall above it. The server stopped doing that: `computeGexRegime` calls
`wallsFromStrikeTotals(strike_totals, spot)` and returns `null` rather than a wrong-side level —
*"a call wall below spot is not a call wall, it is inverted"*, measured on MSFT (call_wall 480 at
spot 481.97) and AMZN (260 at 261.64).

The UI is aware of the case — `METRIC_HELP.callWallBelowSpot` / `putWallAboveSpot` relabel it as a
"concentration" rather than resistance/support — which is a defensible product choice. But it means
**the desk tile and every server consumer can print different numbers for the same named level at
the same instant**, and the two choices (relabel vs. null) were made independently rather than
decided once. This one needs a product call before a code change; it is written up here so the call
gets made deliberately.

*(Note the same wall-role vocabulary is already shared with the public page's `classifyWall` →
`concentration`, so "relabel" is the established convention on two of three surfaces and "null" on
the third.)*

### 9.5 [P3, Largo boundary] `route-registry.ts` points Largo at the wrong path for the Thermal matrix

```
{ path: "/api/market/heatmap",     …, description: "GEX/VEX/DEX/CHARM heatmap matrix (Thermal)." }
{ path: "/api/market/gex-heatmap", …, description: "GEX heatmap surface for a ticker." }
```

`/api/market/heatmap` serves **sector performance + top movers** (`fetchSectorPerformance`,
`fetchMarketMovers`) — no GEX, no VEX, no DEX, no CHARM, no ticker parameter. `/api/market/gex-heatmap`
is the Thermal matrix. These descriptions are ingested verbatim into the BIE knowledge base as the
`platform:routes` chunk (`routeRegistryKnowledgeText` → `storeKnowledge("doc","platform:routes",…)`),
so the retrieved manifest tells the model that the Thermal matrix lives at the path that does not
serve it.

Severity is P3, not P2, because of §9.6's mechanism: `callInternalApiRead` sends **no credential**,
so both paths are 401 to it anyway. What is actually broken here is the manifest the model reasons
from, not a read it can perform.

### 9.6 [P3, governance] `/api/market/gex-heatmap/explain` is classed `read` although it is an LLM cost route — and `call_internal_api` sends no credential

Two facts that only make sense together.

**The classification is wrong.** The registry's safety model says cost/LLM routes are listed
`class:"mutation"` so they are "documented AND denied" — `largo/query`, `spx/commentary`,
`nighthawk/hunt` and `nighthawk/play-explain` all are. Thermal's `explain` route calls `anthropicText`
and is registered `class:"read"`, described as *"Deterministic GEX-heatmap narrative."* By the
registry's own stated rule it belongs on the denied side, and its description asserts the opposite
of what it does.

**But nothing can currently reach it that way.** `callInternalApiRead` fetches with
`headers: { "x-bie-internal-read": "1", accept: "application/json" }` and **no cron bearer and no
session cookie** — and `x-bie-internal-read` is honoured by no route in the codebase (grep: one
occurrence, the sender). Every `/api/market/*` route behind `authorizeMarketDeskApi` /
`authorizePremiumDeskApi`, `explain` included, therefore answers 401. The misclassification is
latent, not live.

Which raises the larger question this pass did not answer: **is `call_internal_api` able to read the
market family at all?** If not, the "universal read-access tool" is 401-ing on the whole area while
reporting `ok:false` rather than anything a model can act on. That is a cross-lane question, logged
in §10, not a Thermal fix.

### 9.7 [P3, presentation] SPX serves `change_pct: 0` off-hours while SPY/QQQ serve the last session's move

**Measured 2026-08-22 23:21Z:** SPX `change_pct: 0`, SPY `0.41`, QQQ `0.47`.

Root cause is a provider asymmetry, verified directly against the upstream:

- `/v3/snapshot/indices?ticker=I:SPX` → `session.change_percent: 0`, because once the session closes
  Polygon rolls `previous_close` **forward** to equal `close` (both 7674.37).
- `/v2/snapshot/locale/us/markets/stocks/tickers/SPY` → `todaysChangePerc: 0.409…`, because that
  endpoint keeps `prevDay.c` at the session-before close (762.60) instead of rolling it forward.
  (`_rowToSnapshot` prefers `todaysChangePerc`, falling back to `(price − prevDay.c)/prevDay.c`.)

So the index path and the equity path answer **different questions** off-hours — "change since the
now-rolled-forward previous close" vs "the last session's change" — and the Thermal desk renders
them side by side in one compare strip as if they were the same measurement. `rebaseChangePct` does
not help: it re-measures against the same rolled-forward close. Neither number is a provider error;
the defect is that the pair is internally inconsistent and `0` reads as a measured "unchanged"
rather than "not measurable in this session".

---

## 10. What Phase 0 could not answer — the Phase 1 work list

1. **Do `/heatmap` and `/tools/gamma-snapshot` diverge during RTH?** The member route overrides
   `call_wall`/`put_wall` from the live UW WS ladder; the public builder does not. Off-hours (WS
   idle) they matched exactly. **Only measurable 09:30–16:00 ET.**
2. **The 56.7s SPY force-rebuild anomaly (2026-08-13) is still unexplained.** The overnight
   `gex-force-rebuild-timing.mjs` run (SPY p95 5.4s, SPX 7.3s, QQQ 4.4s, IWM 2.1s) is a **floor**.
   Re-run during RTH before touching `GEX_HEATMAP_FORCE_MAX_BLOCK_MS`.
3. **`cross_validation` was `null` on all six tickers.** `skipSlowEnrichment` disables it whenever
   the matrix cache is fresh — which is the normal case for the presets it is gated to. Does the UW
   cross-check ever actually run in production? If not, the Thermal "Cross-check" chip is
   permanently `offline` and the guard is decorative.
4. **How often does `spot` come from the prev-bar / UW fallback?** No provenance field, no counter.
   Until one exists, "the spot is stale" is unfalsifiable from the payload.
5. **`get_wall_dynamics`** was not audited in this pass — it routes to Vector's rail for single names
   and to the SPX live desk for SPX. Its time anchor and freshness fields are UNKNOWN.
6. **Truncation.** `largo-truncation-probe.mjs` has not been run against the six Thermal tools. Read
   the CONTROL line before trusting any COMPLETE.
7. **Pixels.** No Thermal UI harness exists in the interaction-audit style
   (`meridian-interaction-audit.mjs`). `depth-ladder-ui-audit.mjs` covers the Depth tab only, and
   nothing at all covers the public page at mobile 430 **logged out**.
8. **Can `call_internal_api` read the market family at all?** It sends no cron bearer and no session
   cookie, and `x-bie-internal-read` is honoured nowhere — so every tier-gated `/api/market/*` route
   should answer 401. Unmeasured. Cross-lane if confirmed (§9.6).
9. **Chain truncation is observable but not measured.** `warnChainTruncated` fires when a pagination
   guard is hit with `next_url` still set — walls and OI are then understated. Nobody has counted how
   often that happens per ticker.

---

## 11. Keeping this file honest

- Every number here carries the date it was measured. A number without one is a claim, not a fact.
- When a finding in §9 is fixed, edit the entry in place with the PR number and outcome — do not
  delete it; the measurement is the record of why the code looks the way it does.
- When a §10 item is answered, move the answer into the inventory and strike the item.
- If something here turns out wrong, correct it in place and say so out loud. A map that quietly
  reshapes itself is worse than no map.
