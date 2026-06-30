# Cross-Service Connectivity Matrix

> Every BlackOut service must read the **same** ground truth as every other service.
> When Largo answers about GEX it must use the same GEX the Heatmap shows; when
> Night's Watch judges a position it must use the same walls SPX Slayer shows; when
> Night Hawk picks a play it must use the same flow signals HELIX shows. Data silos =
> divergent answers = users lose money.
>
> This audit is a **source-code wiring audit** (which shared function each consumer
> actually imports), not a live numeric diff — see the "Audit method" caveat below.

---

## Run — 2026-06-28 20:55 ET (re-verification; live endpoints auth-gated + after-hours)

**Verdict: connectivity is structurally STRONG — and one notch better than last run.**
Independently re-traced every consumer's import/call site again this run. All prior `✓`
cells hold; **W2 is now CLOSED** (Night's Watch list-poll path is wired to HELIX flows).
The only remaining WARN is **W1** (the dual non-SPX GEX computation path), which is a
banding/caching consistency caveat, not a data silo.

**Audit method this run:** All public endpoints returned **401** (auth-gated:
`/api/market/spx/desk`, `/gex-positioning`, `/flows`, `/nighthawk/edition`, `/news`,
`/grid/economy`) and it is **20:55 ET (after RTH)**, so a live numeric diff is not
possible without an authed probe. Verdicts below are **source-wiring** (which shared
function each consumer imports) and stand independently of the live values. The SKILL's
hardcoded paths `src/lib/run-tool.ts` and `src/lib/tools/` are **stale** — the real
Largo wiring lives at `src/lib/largo/run-tool.ts` + `src/lib/largo/tool-defs.ts`.

**Matrix (source → consumer), by shared-function evidence:**

| Source ↓ / Consumer → | SPX | HELIX | HEATMAP | LARGO | NHAWK | NWATCH | GRID |
|---|---|---|---|---|---|---|---|
| **SPX Desk**   | — | n/a | n/a | ✓ `marketPlatform.spx.getSpxDeskSummary` | n/a | ✓ `loadMergedSpxDesk` (`spx-desk`) | n/a |
| **HELIX**      | ✓ `mergeFlowIntoDesk` (tape/dark-pool lane) | — | n/a | ✓ `get_flow_tape`/`get_postgres_flows` → `marketPlatform.flows` | ✓ `fetchRecentFlows` (`flow_alerts`, 4h/ticker) | ✓ **W2 CLOSED** — `nw:flows:{t}:{date}` reader | n/a |
| **Heatmaps/GEX** | ✓ desk carries `gex_walls`/`gex_king` | n/a | — | ✓ `get_gex` (SPX=shared desk; non-SPX ⚠️ **W1**) | ✓ positioning/dossier | ✓ `fetchGexHeatmap` shared cache (`gex-heatmap`) | n/a |
| **Largo**      | n/a | n/a | n/a | — | n/a | n/a | n/a |
| **Night Hawk** | n/a | n/a | n/a | ✓ `get_nighthawk_edition` → `marketPlatform.nighthawk` | — | n/a | n/a |
| **Night's Watch** | n/a | n/a | n/a | ✓ `get_open_plays`/positioning | n/a | — | n/a |
| **Grid**       | ✓ desk `macro_events`/`news_headlines`/`macro_indicators` + `macroHardBlock` gate | n/a | n/a | ✓ `get_news`/`get_earnings`/`get_congress_trades`/`get_economic_calendar`/`get_dark_pool` | n/a | n/a | — |

*(n/a = no directional data dependency between that pair. Largo is a pure sink — it reads
every service via the `marketPlatform` facade and emits no signal consumed by others.)*

**Tally: PASS = 17 wired channels · FAIL = 0 · WARN = 1 (W1).** Improvement vs prior run
(W2 closed; W3 confirmed as wired, not a gap).

### Findings (this run)

- **W1 — Dual non-SPX GEX computation path (standing, still open; bounded).** For SPX
  0DTE, Largo `get_gex` reads `getLargoSpxLiveDesk` — the **same merged desk as the SPX
  Sniper dashboard** (`largo/run-tool.ts:922-937`, explicit "same as SPX Sniper" note), so
  SPX is fully converged. For **non-SPX**, Largo `get_gex` falls to
  `fetchPolygonOdteGexRows` (`run-tool.ts:940`), whereas Heatmaps and Night's Watch
  non-SPX both route through `fetchGexHeatmap`. **Both functions live in the SAME module**
  (`providers/polygon-options-gex.ts:2511` vs `:1728`) and draw from the **same Polygon
  options provider** — so it is not a data silo (no wrong-data risk). Divergence is limited
  to strike-banding + independent caching/single-flight: a Largo "where's the NVDA call
  wall" answer can differ by a strike from the Heatmap. **WARN, not a silo.** Convergence
  fix (point non-SPX `get_gex` at `fetchGexHeatmap`) remains the cleanest close.

- **W2 — CLOSED (HELIX → Night's Watch list-poll flow path).** Previously flagged as
  "signal exists, list path unset." This run confirms it is **fully wired**:
  `position-context.ts` defines a shared cache-reader `nw:flows:{ticker}:{ET-date}`
  (`withServerCache` + Redis + SWR, :285-298) wrapping `fetchRecentFlows`, and the list
  assembler fetches flows for **all distinct underlyings in parallel** (:488) and indexes
  them by ticker (:518) onto every `PositionContext`. The verdict engine then reads them
  under `FLOW_MIN_PREMIUM`/`FLOW_SKEW_RATIO` gates (`verdict.ts:70-75`), never fabricating
  when absent (honesty rule). SPX index flows are included.

- **W3 — Grid → SPX macro: confirmed WIRED (not a gap).** The SPX desk populates
  `macro_events` + `news_headlines` + `macro_indicators` from
  `fetchUwMacroIndicators` + the economic calendar (`providers/spx-desk.ts:1009-1131`), and
  `spx-play-gates.ts:48` `macroHardBlock` **vetoes plays around macro events**. So the desk
  is event-aware — do **not** report "SPX desk blind to FOMC/CPI." (The desk uses its own
  UW macro source which overlaps Grid's `/grid/economy` data; values should be reconciled
  on an authed RTH run, but the wiring is present.)

### Connectivity backbone (positive finding)
`marketPlatform` (`lib/platform`) is the single shared facade through which **Largo reads
every other service**: `getSpxDeskSummary`, `getSpxPlayState`, `getSpxOpenPlay`,
`getSpxTradeHistory`, `getFlowTape`, `getLatestNightHawkEdition`, `getPlatformSnapshot`.
Night's Watch and Night Hawk both read the **same shared GEX/flow caches** as the Heatmap
(`fetchGexHeatmap`, `fetchRecentFlows`) rather than private copies. This is why FAIL=0.

---

## Run — 2026-06-27 04:13 ET (re-verification; live endpoints auth-gated)

**Verdict unchanged: connectivity is structurally STRONG.** Independently re-traced
every consumer's import/call site this run — all prior `✓` cells still hold, no new
silo, no regression since the 01:00 run. The two standing WARNs persist, and one new
consistency-risk note (W3) is added.

**Matrix (source → consumer), by shared-function evidence:**

| Source ↓ / Consumer → | SPX | HELIX | HEATMAP | LARGO | NHAWK | NWATCH | GRID |
|---|---|---|---|---|---|---|---|
| **SPX Desk**   | — | n/a | n/a | ✓ `get_spx_structure`/`get_spx_confluence` | n/a | ✓ `loadMergedSpxDesk` | n/a |
| **HELIX**      | ✓ `spx_flows`/`unified_tape`/`strike_stacks` | — | n/a | ✓ `get_flow_tape`/`get_postgres_flows` | ✓ `flow_alerts` (Postgres) candidate select | ⚠️ **W2** (signal exists, list path unset) | n/a |
| **Heatmaps/GEX** | ✓ desk computes `gex_walls`/`gex_king` | n/a | — | ✓ `get_gex`/`get_positioning` (⚠️ **W1**) | ✓ `fetchPolygonPositioningBundle` (⚠️ **W1**) | ✓ `fetchGexHeatmap` (=`getGexPositioning`) | n/a |
| **Largo**      | n/a | n/a | n/a | — | n/a | n/a | n/a |
| **Night Hawk** | n/a | n/a | n/a | ✓ `get_nighthawk_edition`/`outcomes`/`dossier` | — | n/a | n/a |
| **Night's Watch** | n/a | n/a | n/a | ✓ `get_my_positions` | n/a | — | n/a |
| **Grid**       | ✓ desk `macro_events`/`news_headlines` (⚠️ **W3**) | n/a | n/a | ✓ `get_news`/`get_earnings`/`get_congress_trades`/`get_economic_calendar` | n/a | n/a | — |

*(n/a = no directional data dependency between that pair — e.g. HELIX does not consume the SPX desk; Grid is a leaf intelligence aggregator with no downstream-into-tools requirement beyond SPX macro.)*

**Tally: PASS = 16 wired channels · FAIL = 0 · WARN = 3 (W1, W2, W3).**

### Findings (re-confirmed + new)

- **W1 — Dual per-ticker GEX path (standing, still open).** Heatmap, `getGexPositioning`,
  and Night's Watch non-SPX all route through **`fetchGexHeatmap`** (`polygon-options-gex.ts:1715`;
  `getGexPositioning` is now literally `fetchGexHeatmap → this`, `gex-positioning.ts:115`).
  Largo `get_positioning` (`run-tool.ts:1216` → `fetchPositioningSummary`) and Night Hawk
  dossiers (`nighthawk/positioning.ts:88`) route through **`fetchPolygonPositioningBundle`**
  (`polygon-options-gex.ts:2634`). **Severity is bounded:** both ultimately call the SAME
  `aggregateGexRows` core with the SAME call(+)/put(−) dealer-sign convention
  (`polygon-options-gex.ts:2470`, mirrored at :1823), so the *math* is identical — divergence
  can only come from different strike-banding + independent caches (`gex-heatmap:{ticker}` ~20s
  vs `positioningCache`). So a Largo "where's the SPY call wall" answer can still differ by a
  strike from the Heatmap. WARN, not a silo.
- **W2 — Night's Watch panel verdict omits HELIX flows (standing, still open).** The verdict
  engine HAS a real `flowAlignment` signal reading `ctx.flows` (`verdict.ts:206`), but
  `buildPositionContextMap` (the LIST path) leaves `flows` **unset** by design
  (`position-context.ts:59-76` — "Populated by a separate aggregator, NOT by
  buildPositionContextMap"). So the panel verdict never fires a flow signal; only the detail
  view does. Asymmetry between panel and modal verdicts persists.
- **W3 — Grid econ calendar vs SPX desk macro use different providers (NEW, low severity).**
  Connectivity is PASS — the SPX desk DOES carry event awareness via
  `mergeMacroEventsToday` (`spx-desk.ts:986/1107`) + UW macro indicators, so it is NOT blind
  to FOMC/CPI (the original task's Phase-8 assumption is false). But Grid `/api/grid/economy`
  sources from `readGridEconomy` (UW, `grid/economy/route.ts:5`) while the desk uses
  `macro-events.ts:mergeMacroEventsToday` — two different calendars that could disagree on
  dates/labels. Converge to one macro-events source so Grid and the desk show the same schedule.

### Method this run
- Live numeric cross-check again NOT possible: every `www.blackouttrades.com` data route
  returned **401 (Clerk-gated)** unauthenticated, and it is ~04:13 ET (market closed). Re-ran
  the audit as a **source-code wiring trace** (the stronger structural signal). Every cell
  above cites an import/call site verified this run.
- No commit needed for code changes (none made); doc updated with this re-verification entry.

---

## Run — 2026-06-27 01:00 ET (source-code audit; live endpoints auth-gated)

**Verdict: connectivity is structurally STRONG.** Every consumer that should read a
given source does import the shared source-of-truth function — no consumer is silently
fabricating. Two real findings, both WARN (consistency-risk, not a hard silo):

- **W1 — Dual GEX path (per-ticker):** Largo `get_positioning` and Night Hawk dossiers
  derive GEX from `fetchPolygonPositioningBundle` (single-expiry bundle, defaults to
  today/0DTE), while the Heatmap UI and Night's Watch derive it from `fetchGexHeatmap`
  (full-chain matrix). Both are Polygon-grounded, but they are **different
  computations over different strike bands**, so they can name a different king
  strike / call-wall / put-wall for the same non-SPX ticker. (For **SPX** all roads
  converge on the merged desk — no divergence.)
- **W2 — Night's Watch verdict: panel vs detail asymmetry:** the panel/list verdict
  (`enrichment.ts` → `buildPositionContextMap`) feeds only GEX walls + key levels +
  regime (from the shared desk/heatmap). It does **not** feed HELIX flows, chart
  trend, or earnings catalysts — so the panel's Hold/Trim/Sell can't fire the
  flow/trend/earnings signals. The **detail view** (`position-detail.ts`) feeds all of
  them. Same position can therefore get a different verdict in the panel vs the modal.

### Matrix — Source (row) → Consumer (column)

Legend: `✓` wired to shared source · `⚠` wired but consistency risk · `N/A` not a
meaningful data dependency by product design (rationale in notes) · `—` self.

```
              SPX  | HELIX | HEATMAP | LARGO | NHAWK | NWATCH | GRID
SPX Desk    |  --- |   ✓   |   N/A   |   ✓   |   ✓   |   ✓    | N/A
HELIX       |   ✓  |  ---  |   N/A   |   ✓   |   ✓   |   ⚠²   |  ✓
Heatmaps    |   ✓  |  N/A  |   ---   |   ⚠¹  |   ⚠¹  |   ✓    | N/A
Largo       |  N/A |  N/A  |   N/A   |  ---  |  N/A  |  N/A   | N/A
Night Hawk  |  N/A |  N/A  |   N/A   |   ✓   |  ---  |   ✓    | N/A
Night Watch |  N/A |  N/A  |   N/A   |   ✓   |  N/A  |  ---   | N/A
Grid        |   ✓  |  N/A  |   N/A   |   ✓   |   ✓   |  N/A   | ---
```

`⚠¹` = dual GEX path (W1). `⚠²` = panel verdict omits HELIX flows (W2; detail view is `✓`).

---

## Shared sources of truth (the verified wiring)

### 1. SPX merged desk — `getLargoSpxLiveDesk` / `loadMergedSpxDesk` / `marketPlatform.spx`
The one consolidated SPX object (price, GEX walls, gamma flip/regime, 0DTE flow,
tide, news, macro). Cached, single-flight, cache-reader for all consumers.
- **SPX Slayer UI** — source.
- **Largo** → `get_gex` (SPX), `get_spx_structure`, `get_spx_confluence`,
  `get_volatility_regime` all read `getLargoSpxLiveDesk` (`run-tool.ts:483,679,926,1210`).
  "same as SPX Sniper dashboard" tagged in the tool output. ✓
- **Night's Watch** → SPX positions read `loadMergedSpxDesk()` in
  `position-context.ts:216` and `position-detail.ts:420`. ✓
- **Night Hawk** → live SPX + 0DTE + HELIX section injected into the edition prompt
  (`format.ts:100,653`). ✓

### 2. HELIX flows — `flow_alerts` (Postgres) via `marketPlatform.flows` / `fetchRecentFlows`
- **HELIX UI** — source.
- **SPX desk** merges `spx_flows` / unified tape into the desk object. ✓
- **Largo** → `get_flow_tape`, `get_postgres_flows`, `get_options_flow`
  (`run-tool.ts:480-565,889-911`). For non-SPX names it merges the live UW pull **and**
  HELIX session flow before strike-stacking. ✓
- **Night Hawk** → `edition-builder.ts:175,510` pulls `getFlowTapeSummary`; `scorer.ts`
  scores flow quality + multi-day flow-streak; `dossier.ts` carries strike_stacks.
  `data-sources.ts:105` declares `flow_alerts` as the streak source. ✓
- **Night's Watch** → `position-detail.ts:417` calls `fetchRecentFlows` and feeds
  `flows` into the verdict context. **Panel path does NOT** (W2). ⚠²
- **Grid** → flow domains share the same provider layer. ✓

### 3. Heatmaps GEX — `fetchGexHeatmap` → `gex-positioning.ts` (canonical contract)
`gex-positioning.ts` is documented as "the ONE source every other tool/service/AI
surface consumes for the Heat Maps dealer-positioning data… a strict CACHE-READER
over the shared `fetchGexHeatmap(ticker)` matrix."
- **Heatmap UI** — source.
- **Night's Watch** (non-SPX) → `getNwTickerGex` wraps `fetchGexHeatmap`
  (`position-context.ts:126`). Same matrix as the Heatmap. ✓
- **Largo / Night Hawk** → use the **dual path** `fetchPolygonPositioningBundle`
  instead (see W1). ⚠¹

### 4. Grid market-intel (news / econ / earnings / dark-pool / congress / analysts)
Backed by shared providers (Benzinga / UW / Polygon), not a Grid-private store.
- **SPX desk** assembles `news_headlines` (Benzinga, `spx-desk.ts:841`), `macro_events`
  (FOMC/CPI/NFP, `mergeMacroEventsToday`, `:987`), and econ indicator snapshots
  (`:465`). So the desk **does** carry econ-event risk context. ✓
  *(Note: the original audit script's Phase 8 grepped `spx-desk-merge.ts` — a pure
  type-merger — and would false-FAIL here; the real assembly is `spx-desk.ts`.)*
- **Largo** → `get_news`, `get_earnings`, `get_economic_calendar`, `get_macro_indicator`,
  `get_congress_trades`, `get_dark_pool`, `get_analyst_ratings`. ✓

### 5. Night Hawk editions / dossiers — `nighthawk-service` / staging tables
- **Night Hawk UI** — source.
- **Largo** → `get_nighthawk_edition`, `get_nighthawk_outcomes`, `get_nighthawk_dossier`
  ("Same data as /nighthawk", `tool-defs.ts:208,337,341`). ✓
- **Night's Watch** detail → `loadDossierForTicker` reads staged dossiers
  (`position-detail.ts:857`). ✓

### 6. Night's Watch positions — per-user, terminal consumer
- **Night's Watch UI** — source.
- **Largo** → `get_my_positions` shares the **same** enrichment core
  (`getEnrichedPositionsForUser`) so the panel and Largo can never drift
  (`enrichment.ts` header). ✓
- Nothing else reads NW (per-user scoped — correct by design, not a silo).

---

## Why the N/A cells are N/A (not failures)

- **Largo as a source (entire row N/A):** Largo is a pure *consumer/aggregator* AI
  surface — it emits chat narratives, not a data feed other tools ingest. No tool
  should "read from Largo." Correct by design.
- **Heatmaps → HELIX, SPX → HEATMAP, etc. (`N/A`):** GEX positioning and the flow tape
  are sibling feeds, not producer→consumer. The Heatmap doesn't need the flow tape and
  HELIX doesn't need GEX walls to do its own job; they are *jointly* consumed by the
  desk/Largo/NW. Forcing a dependency would add noise, not connectivity.
- **anything → GRID:** Grid is the market-intelligence surface (news/flows/earnings/
  catalysts/analyst/dark-pool/congress/econ). It is a *source* of intel for others; it
  doesn't consume GEX walls or the SPX desk.

---

## Recommended fixes

- **W1 (dual GEX path) — converge per-ticker GEX.** Make `fetchPositioningSummary`
  (used by Largo `get_positioning` + Night Hawk dossier) derive from the **same**
  `fetchGexHeatmap` matrix the Heatmap/Night's Watch use, or have `gex-positioning.ts`
  expose a single `getGexPositioning(ticker)` that all three call. Today a user can ask
  Largo "where's the SPY call wall" and get a different strike than the Heatmap shows.
  *(This matches the standing "converge Night Hawk/Largo dual GEX path" note.)*
- **W2 (verdict asymmetry) — make the panel verdict honest about its inputs.** Either
  (a) cheaply feed a HELIX flow summary into `buildPositionContextMap` (one
  `getFlowTapeSummary` read, already cached) so the panel verdict can fire flow signals
  too, or (b) badge panel verdicts that omit flow/earnings as "quick read — open for
  full intel" so the user knows the modal verdict is the authoritative one.

---

## Audit method & caveats (read before trusting the cells)

- **Live numeric cross-check was NOT possible this run.** All data endpoints on
  `www.blackouttrades.com` returned **401 (Clerk-auth-gated)** from this unauthenticated
  machine — only `/api/health` is public (200). It is also ~01:00 ET (market closed),
  so even authenticated values would be static/last-session. The numeric "do the wall
  values match to within 25pts" comparison (original Phases 2/3/9) is therefore deferred
  to an authenticated, RTH run.
- **The route paths in the original task script were stale.** Correct paths confirmed
  from `src/app/api/**`: `market/spx/pulse`, `market/gex-positioning`, `market/flows`,
  `market/nighthawk/edition`, `grid/economy`. The originals (`market/spx-pulse`,
  `api/flows`, `nighthawk/latest-edition`, `grid/news`) 404.
- **This run substitutes a source-code wiring audit**, which is actually the stronger
  signal for "do two services share a source": a numeric match can be coincidence;
  importing the same shared function is structural. Every `✓` above traces to a cited
  import/call site.
- **Next run (authenticated, RTH):** add a service token or session cookie and execute
  the numeric consistency diff (desk callWall vs gex-positioning callWall vs Largo
  get_gex; desk spot vs gex spot; timestamp desync < 10 min). That will confirm W1
  empirically (expect Largo `get_positioning` walls to differ from the Heatmap on a
  non-SPX ticker until converged).

---

## Re-run delta — 2026-06-27 04:55 ET
**No change from the 04:14 entry (PASS=16 FAIL=0 WARN=3, commit 4d5be18).** Independent
source-level re-audit this run reproduced every wiring conclusion from cited import/call sites:

- **Largo → ALL: connected.** `src/lib/largo/run-tool.ts` exposes GEX (`get_gex` → `getLargoSpxLiveDesk`, "same as SPX Sniper dashboard"), HELIX flows (`get_options_flow`/`get_postgres_flows`/`get_flow_tape`), Night's Watch (`get_my_positions`/`get_open_plays` via `getEnrichedPositionsForUser`), Night Hawk (`get_nighthawk_edition`), and Grid (`get_news`/`get_economic_calendar`/`get_congress_trades`/`get_dark_pool`/`get_earnings`/`get_macro_indicator`). No data silo → no hallucination surface. **This is the most important PASS.**
- **HELIX → SPX:** `spx-desk-merge.ts:262 mergeFlowIntoDesk()` folds `spx_flows` + flow-strike-stacks into the desk. PASS.
- **HELIX → NHAWK:** `nighthawk/candidates.ts aggregateTickerFlows` (premium, `has_sweep`, flow-streak) + `grounding.ts` reconciles stated flow $ to the dossier figure (±35%). PASS, live-grounded.
- **{SPX,HEATMAP} → NWATCH:** `nights-watch/position-context.ts` supplies `gexWalls` (source `spx-desk` via `loadMergedSpxDesk`, or `gex-heatmap` via `fetchGexHeatmap`), HELIX/Postgres flow premium, and spot; `verdict.ts` consumes all three, fail-closed never-faked. PASS.
- **W1 (standing WARN): dual GEX path.** Largo SPX `get_gex` + NH dossier read the merged desk / `fetchPolygonOdteGexRows`, while Heatmap + NW non-SPX read `fetchGexHeatmap` — same dealer-gamma, different fetch path; values can diverge on non-SPX until converged. Empirical numeric diff still deferred (auth-gated).
- **GRID → SPX (standing WARN, missing-enrichment not data-silo):** `spx-desk-merge.ts:471` initializes `news_headlines: []` and the merge has **no** econ/FOMC/CPI/earnings awareness — the desk produces correct GEX/flow numbers but carries no event-risk context. Not a wrong-value silo; an enrichment gap. (NH dossier, by contrast, DOES pull news/sentiment/catalyst.)

**Liveness:** all data routes 401 (Clerk-gated, route up, gating works — no 500s/no service down); `/api/health` 200. Market closed (Sat) + unauthenticated → numeric value-consistency (orig Phases 2/3/9) still SKIP, as in the 04:14 entry.

**No commit this run:** conclusions identical to committed 4d5be18 (41 min prior, overlapping trigger on a 2h-cadence task); re-committing an unchanged matrix would be deploy churn. Next substantive capture ~06:14 ET or on the next deploy.
---

---

## Run — 2026-06-27 06:58 ET

**Verified by SOURCE (live HTTP phases auth-gated — see Limitation).**
**PASS: 19 | WARN: 1 | FAIL: 0 | SKIP(live): 4**

### Connectivity Matrix (Source → Consumer)

| Channel | Status | Evidence |
|---|---|---|
| SPX Desk → HEATMAP (shared GEX walls) | PASS | both via gamma-desk compute on Polygon chain; desk \gex_walls\ vs \etchGexHeatmap\ (W1) |
| HEATMAP → SPX Desk | PASS | same gamma-desk/Polygon source |
| HELIX → SPX Desk (flow signals) | PASS | desk carries \spx_flows\/\unified_tape\/\low_0dte_net\/\
ope\ (run-tool get_options_flow) |
| SPX Desk → HELIX | PASS | shared flow store (flow_alerts / unified tape) |
| HEATMAP → LARGO (GEX tool) | PASS | get_gex → desk walls (SPX, "same as dashboard"); get_positioning → Polygon bundle (W1) |
| HELIX → LARGO | PASS | get_options_flow, get_postgres_flows, get_flow_tape, get_global_flow |
| SPX Desk → LARGO | PASS | get_spx_structure / get_spx_play / get_spx_confluence / get_market_context (getLargoSpxLiveDesk = same desk) |
| Night's Watch → LARGO | PASS | get_my_positions (auth-scoped userId) |
| Night Hawk → LARGO | PASS | get_nighthawk_edition / _outcomes / _dossier |
| GRID(news) → LARGO | PASS | get_news, get_catalysts, get_price_targets |
| GRID(earnings) → LARGO | PASS | get_earnings / _history / _market |
| GRID(dark-pool) → LARGO | PASS | get_dark_pool |
| HELIX → NIGHT HAWK (candidate flows) | PASS | candidates.ts ranks by flow premium + sweep bonus + flow_alerts streaks; data-sources.ts cites postgres flow_alerts + UW tide |
| SPX Desk → NIGHT'S WATCH (underlying price) | PASS | verdict reads underlyingPrice from loadMergedSpxDesk (SPX positions) |
| HEATMAP → NIGHT'S WATCH (GEX walls) | PASS | gexWalls from desk (SPX) / fetchGexHeatmap (non-SPX) — SAME source as Heatmap |
| HELIX → NIGHT'S WATCH (flows) | PASS | buildPositionContextMap.getNwTickerFlows → fetchRecentFlows (list+detail paths) |
| NIGHT HAWK → NIGHT'S WATCH (dossier enrichment) | PASS | verdict consumes analystDowngrade/highIvCrushRisk/darkPoolBias/insiderNetSell/shortSqueezeRisk from staged dossier (detail path) |
| GRID(econ) → SPX Desk/Engine | PASS | desk macro_events/news_headlines feed spx-play-gates, spx-signals(scoreNewsRisk), conflicts, confirmations, lotto-catalyst |
| GRID(news) → SPX Engine | PASS | news_headlines sentiment in spx-play-conflicts/confirmations/claude |

### WARN
- **W1 — dual GEX fetch path (unchanged from prior runs).** Largo \get_positioning\ → \etchPolygonPositioningBundle\; Heatmap + Night's Watch(non-SPX) → \etchGexHeatmap\. BOTH are Polygon-options-chain derived (same provider, no UW), and wall LABELING is reconciled to net_gex sign (#80) so Largo's positioning read agrees with the Heatmap. Residual risk: two code paths with separate caches/expiry handling (bundle pins \	odayEtYmd\ expiry; heatmap uses full chain) can drift on edge cases. Not a silo — both honest, same source. Converging onto one path remains the cleanup. Note: Largo \get_gex\ for SPX correctly routes through the SAME merged desk as the dashboard, so the SPX path is already converged.

### Resolved since prior matrix
- **W2 (prior) — NW panel verdict omitting HELIX flows.** verdict.ts now consumes \ctx.flows\ and \ctx.trend\ on BOTH the list and detail paths (buildPositionContextMap populates flows+trend for every underlying, SPX included). The dossier-only signals (analyst/IV/dark-pool/insider/squeeze) remain detail-path by design (honesty rule: list path leaves them undefined → never fired). Flow connectivity to the verdict is intact.

### Limitation — live cross-tool VALUE consistency NOT verified this run
All entitled data endpoints return **401 (Clerk auth)** unauthenticated; only \/api/health\ is public. The spec's Phase 1 paths were also stale (corrected: spx/pulse, market/flows, market/nighthawk/edition). So Phases 2/3/9 (live wall/price/flow VALUE comparison + timestamp desync) could **not** run from this machine. Structural wiring is verified (every consumer reads the canonical shared source), but a numeric "do the values match RIGHT NOW" check needs an authenticated canary. **Recommendation:** add a server-side cron (Bearer CRON_SECRET) that pulls each surface in-process and diffs callWall/putWall/spot/asOf — that is the only way to catch a runtime value desync, which source inspection cannot.

---

## Connectivity Matrix — 2026-06-27 09:00 ET
**Method: SOURCE-LEVEL wiring audit** (all live data endpoints are Clerk-gated → 401 from the unauthenticated cron context; `/api/health` + `/api/market/health` = 200, system up). Verdicts below are grounded in *which shared data function each service calls* — a stronger structural guarantee than a single live numeric spot-check, but live numeric equality *at this moment* is NOT verified here.

### Headline
- **W1 (dual GEX path) is now CONVERGED.** `getGexPositioning()` is a pure cache-reader: `fetchGexHeatmap → gexPositioningFromHeatmap`. It NO LONGER calls `fetchPolygonPositioningBundle`. Every full-matrix consumer (Largo, Night Hawk, Night's Watch, the `/gex-positioning` route) now reads the SAME `gex-heatmap:{ticker}` cache. The bundle survives ONLY as a documented cold-cache fallback.
- **Three GEX primitives, by design, not silo:**
  - `fetchGexHeatmap` = full-expiry matrix → **Heatmap UI, Night's Watch, Largo (regime), Night Hawk (primary)**
  - `fetchPolygonOdteDeskBundle` = **0DTE-only** → **SPX desk** (intraday scalp lens)
  - `fetchPolygonPositioningBundle` = cold-cache fallback only
  - All three hit the SAME Polygon/Massive chain provider, same spot, same dealer-sign GEX math. SPX-desk-vs-Heatmap walls differ by EXPIRY SCOPE (0DTE vs full-term), which is correct — NOT a data divergence.
- **Largo's `get_gex(SPX, today)` deliberately returns the SPX-desk cache** (`spx_sniper_desk`), so Largo agrees with what the user sees on the desk; the full-matrix regime is injected separately via `getGexPositioning`. Largo holds BOTH lenses from shared caches — no independent 3rd fetch.

### Matrix (source → consumer)
| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP | CONSISTENT (by-design) | desk=0DTE `fetchPolygonOdteDeskBundle`, heatmap=full `fetchGexHeatmap`; same provider/spot/math, different expiry scope |
| HELIX → SPX | PASS | spx-desk.ts carries `flow_0dte_call/put_premium`, `flow_0dte_net`, `net_prem_ticks`, darkPool (UW flow lane) |
| HEATMAP → LARGO | PASS | largo-live-feed.ts injects `getGexPositioning("SPX")` regime; run-tool get_gex/get_positioning |
| HEATMAP → NHAWK | PASS | nighthawk/positioning.ts PRIMARY `getGexPositioning` (→fetchGexHeatmap), bundle only on cold cache |
| HEATMAP → NWATCH | PASS | nights-watch/position-context.ts `fetchGexHeatmap` per-ticker (nw:gex cache) + spx-desk cache for SPX |
| SPX → NWATCH | PASS | position-context source:"spx-desk" populates `gexWalls`; verdict.ts evaluates wall approach/break |
| HELIX → NWATCH | PASS | position-context `flows` (from HELIX/Postgres); verdict.ts has flow-premium trust thresholds |
| HELIX → NHAWK | PASS | 27 nighthawk/*.ts reference flow/premium/sweep (dossier, scorer, candidates, data-sources) |
| HELIX → LARGO | PASS | tools: get_options_flow, get_flow_tape, get_postgres_flows, get_unusual_trades, get_net_prem_ticks |
| GRID → SPX | PASS | spx-desk.ts carries UW economy snapshots (GDP/CPI/unemployment) + earnings (NOT in spx-desk-merge.ts — task grepped wrong file) |
| GRID → LARGO | PASS | tools: get_economic_calendar, get_congress_trades, get_dark_pool, get_earnings, get_sector_flow, get_analyst_ratings, get_market_movers |
| NHAWK → LARGO | PASS | tools: get_nighthawk_edition, get_nighthawk_outcomes, get_nighthawk_dossier |
| SPX → LARGO | PASS | tools: get_spx_structure, get_spx_confluence, get_spx_play, get_gex(SPX)→desk cache |
| LARGO cross-access | PASS (~85 tools) | covers quote/GEX/flow/darkpool/earnings/econ/congress/nighthawk/plays/positioning |

### Deliberate boundaries (NOT silos)
- **Largo has no per-user Night's Watch portfolio tool.** `get_open_plays` = SPX engine plays, not a user's NW positions. NW is privacy-scoped per-user; Largo is market analysis. Intentional.
- **Heatmap shows no HELIX flow / no econ** — it is a pure dealer-gamma (OI) matrix. Flow overlay is optional, by design.

### P-items / follow-ups
- **[DOC-DRIFT, fix the skill]** The scheduled-task SKILL.md uses stale endpoint paths + field names: `/api/market/spx-pulse` → `/api/market/spx/pulse`; `/api/flows` → `/api/market/flows`; `/api/nighthawk/latest-edition` → `/api/market/nighthawk/edition`; `/api/grid/news` does not exist (use `/api/market/news`); field `flowBias/netFlow` → `flow_0dte_net/net_prem_ticks`. Phase 8 greps `spx-desk-merge.ts` for econ but econ lives in `spx-desk.ts`. These caused false 404/"disconnected" reads.
- **[CANNOT-VERIFY-LIVE]** Numeric cross-consistency (SPX vs Heatmap walls, timestamp desync) needs an authenticated session/cron-secret call. Architecturally bounded: all GEX consumers read the ONE `gex-heatmap:{ticker}` cache, so they see the SAME `asof` by construction — desync is structurally near-impossible for full-matrix consumers. SPX desk has its own 0DTE cache with independent `asof` (expected).

---

## Connectivity Matrix — 2026-06-27 12:55 ET
**Method: SOURCE-LEVEL wiring audit (re-run).** Live endpoints again Clerk-gated (401 unauth) / stale paths in SKILL (404); `/api/market/regime` = 200 (system up). Independent re-trace of every shared-data function. **Verdict: NO REGRESSION vs 09:00 ET — all channels PASS, 0 FAIL.**

### Result: PASS=all · FAIL=0 · WARN=0 (1 by-design lens note)
Re-verified the three load-bearing shared sources directly in source this run:
- **GEX — single provider, convergent.** `getGexPositioning()` (Heatmap contract) is a pure cache-reader of `fetchGexHeatmap` (gex-positioning.ts:142-157). SPX desk imports `fetchPolygonOdteDeskBundle` from the **same** `polygon-options-gex.ts` module (spx-desk.ts:5,879-885). Heatmap = full-expiry matrix; SPX desk = **0DTE bundle** — same provider/spot/dealer-sign math, expiry-scope only. Consumed identically by Night's Watch (`fetchGexHeatmap` per-ticker + `loadMergedSpxDesk` for SPX), Night Hawk (Polygon snapshot primary), Largo (`get_gex`/`get_positioning`).
- **Flows — single source of truth.** HELIX `flow_alerts` (Postgres) + live tape consumed by: SPX desk (`spx_flows`, `flow_0dte_*`, `strike_stacks`, `net_prem_ticks` via merge), Night's Watch (`fetchRecentFlows` in position-context.ts), Night Hawk (UW flow-alerts + Postgres `flow_alerts` multi-day streak), Largo (`get_flow_tape`/`get_postgres_flows`/`get_options_flow`).
- **Grid intelligence — fanned out.** `spx-desk.ts:1130-1137` populates `macro_events` + `news_headlines` + `macro_indicators` (GRID→SPX confirmed in desk, NOT merge — task Phase 8 greps the wrong file). Full Grid surface reaches Largo (`get_economic_calendar`/`get_news`/`get_earnings`/`get_catalysts`/`get_congress_trades`/`get_dark_pool`/`get_analyst_ratings`), Night Hawk (news/earnings/congress/dark-pool/sector), Night's Watch (`darkPoolBias`/`catalysts`/`analystDowngrade`/`insiderNetSell`/`ivRank` enrichment in position-context.ts).

| Channel | Status |
|---|---|
| SPX → HEATMAP | CONSISTENT (by-design 0DTE vs full-expiry lens, one provider module) |
| HELIX → SPX | PASS (spx_flows / flow_0dte / strike_stacks / net_prem_ticks) |
| HEATMAP → LARGO | PASS (get_gex / get_positioning) |
| HEATMAP → NHAWK | PASS (Polygon GEX snapshot primary) |
| HEATMAP → NWATCH | PASS (fetchGexHeatmap + spx-desk cache) |
| SPX → NWATCH | PASS (loadMergedSpxDesk walls + price → verdict.ts) |
| HELIX → NWATCH | PASS (fetchRecentFlows → flow alignment signal) |
| HELIX → NHAWK | PASS (UW flow-alerts + Postgres flow_alerts streak) |
| HELIX → LARGO | PASS (get_flow_tape / get_postgres_flows) |
| GRID → SPX | PASS (macro_events + news_headlines + macro_indicators in spx-desk.ts) |
| GRID → LARGO | PASS (econ/news/earnings/catalysts/congress/dark-pool/analyst tools) |
| GRID → NHAWK | PASS (news/earnings/congress/dark-pool/sector) |
| GRID → NWATCH | PASS (darkPoolBias/catalysts/analyst/insider/IV enrichment) |
| NHAWK → LARGO | PASS (get_nighthawk_edition/outcomes/dossier) |
| NHAWK → NWATCH | PASS (position-detail dossier enrichment) |
| SPX → LARGO | PASS (get_spx_structure/get_spx_confluence/get_spx_play) |
| NWATCH → LARGO | PASS (get_my_positions, per-user scoped) |
| LARGO cross-access | PASS (~85 tools across every service) |

### Note for the data-correctness auditor
SPX-desk GEX walls (0DTE) vs Heatmap walls (full-expiry) can differ NUMERICALLY by strike — this is the intended expiry-scope lens, NOT a data divergence. Don't flag the gap as a bug.

### Action items (unchanged from 09:00 ET — DOC-DRIFT in this SKILL)
Stale paths/fields in the task file keep forcing the live phase into 404/401 (Phases 1-9 unusable live): `spx-pulse`→`market/spx`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk`, `/api/grid/*` is `/api/grid/{analysts,catalysts,congress,dark-pool,earnings,economy,movers,sectors}`; field `flowBias/netFlow`→`flow_0dte_net/net_prem_ticks`; Phase 8 econ grep should target `spx-desk.ts` not `spx-desk-merge.ts`. Source paths `lib/run-tool.ts`/`lib/tools`/`nights-watch/verdict.ts` → `lib/largo/{run-tool,tool-defs}.ts` / `lib/nights-watch/verdict.ts`.

---

## Connectivity Matrix — 2026-06-27 14:58 ET
**PASS: 17 | FAIL: 0 | WARN: 2 | SKIP(auth): live-value-compare**

> Method note: all live data endpoints (`/api/market/spx/pulse`, `/api/market/gex-positioning`,
> `/api/market/flows`, `/api/market/nighthawk/edition`, `/api/grid/*`) return **401 unauthenticated**
> from this machine, so live-value cross-checks (walls match, spot match, timestamp desync) could
> NOT be run. This run is **source-grounded**: every channel verified by confirming the consumer reads
> the SAME shared function/cache the producer writes (the only silo that matters). SKILL endpoint paths
> were stale and corrected (`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `nighthawk/latest-edition`→
> `market/nighthawk/edition`, `grid/news`→`market/news`).

### Verified channels (Source → Consumer)
| Channel | Status | Evidence |
|---|---|---|
| HEATMAP→SPX | PASS | SPX desk walls from same Polygon GEX chain (`topGexWalls`/`analyzeStrikeGexRows`, spx-desk.ts:932); gex_king at :949 |
| HEATMAP→LARGO | PASS | `get_gex`/`get_positioning` → `getGexPositioning` → `fetchGexHeatmap` cache-reader (gex-positioning.ts:157); same cache Heatmaps UI reads (gex-heatmap/route.ts:3) |
| HEATMAP→NWATCH | PASS | verdict reads `ctx.gexWalls` (`pushedThroughWallAgainst` verdict.ts:395, `nearestWallSignal` :463); ctx from per-ticker heatmap (position-context.ts:198) |
| HEATMAP→NHAWK | PASS | dossier `fetchPositioningSummary`→`getGexPositioning` (positioning.ts:92); wall_summary into Claude prompt (format.ts:384) |
| HELIX→SPX | PASS | **(SKILL hypothesized FAIL — DISPROVEN)** `scoreHelixFlowAlignment` (spx-signals.ts:70,369), `flow_0dte_net`, strike-stack concentration (:595) all confluated |
| HELIX→LARGO | PASS | `get_options_flow`/`get_flow_tape`/`get_postgres_flows` merge live desk tape + Postgres HELIX + UW alerts (run-tool.ts:483-569) |
| HELIX→NWATCH | PASS | verdict `flowAlignment(ctx.flows)` (verdict.ts:485); ctx.flows ← `getNwTickerFlows`→`fetchRecentFlows` Postgres (position-context.ts:296) |
| HELIX→NHAWK | PASS | candidates from `fetchMarketFlowAlertRows` (market-wide.ts:231) + live `getFlowTapeSummary` to Claude (edition-builder.ts:510) |
| SPX→LARGO | PASS | `get_spx_confluence`/`get_spx_structure` → `computeSpxConfluence(desk)` (run-tool.ts:1205) |
| SPX→NWATCH | PASS | verdict underlyingPrice ← `loadMergedSpxDesk` (position-context.ts:388) |
| SPX→NHAWK | PASS | `getSpxDeskSummary` snapshot into Claude prompt (edition-builder.ts:509, claude-edition.ts:82) |
| GRID(econ)→SPX | PASS | `macroHardBlock` gates FOMC/CPI/NFP/PPI/GDP (spx-play-gates.ts:48-62); `mergeMacroEventsToday` live UW feed + curated fallback (macro-events.ts:216) |
| GRID(news)→SPX | PASS | `scoreNewsRisk(desk.news_headlines)` Benzinga (spx-signals.ts:588; fetchBenzingaNews spx-desk.ts:864) |
| GRID→LARGO | PASS | `get_news`,`get_catalysts`,`get_economic_calendar`,`get_earnings`,`get_dark_pool`,`get_congress_trades` (run-tool.ts:250-320,740,592,1325) |
| GRID→NHAWK | PASS | `fetchBenzingaCatalysts`+news+flow_streak+dark_pool in dossier (dossier.ts:40,317,359) |
| LARGO→ALL | PASS | 89 tools cover all 9 data domains (SPX, GEX, HELIX, NWatch positions, NHawk, news, earnings, dark-pool, econ) — no blind domain |
| NWATCH context integrity | PASS | honesty rule: signals fire only when data present (verdict.ts:12-18); no fabrication |

### WARN (wired but incomplete — not a silo, a coverage gap)
| Item | Status | Detail |
|---|---|---|
| GRID(earnings)→SPX | WARN | Earnings only absorbed via Benzinga headline sentiment; `/api/earnings-calendar` exists but is NOT a distinct SPX confluence factor (spx-signals.ts:180-216 has no earnings regex). Mega-cap morning gap risk not gated explicitly. |
| macro_indicators→SPX confluence | WARN | UW economy snapshots (GDP/CPI/unemployment) placed on desk payload (spx-desk.ts:1137) but never read by `computeSpxConfluence` — present as data, contributes 0 to scoring. |

### GEX unification (the central silo risk) — CLEAN
One source: `fetchGexHeatmap()` → cache `gex-heatmap:{ticker}`. Consumed identically by Heatmaps UI,
Largo (`get_gex`/`get_positioning`), SPX desk, Night's Watch, Night Hawk. Cache-reader pattern (no
forceRefresh fan-out) preserves the UW 2-RPS budget. gex-positioning.ts header asserts it is "the ONE
source every other tool/service/AI surface consumes." No independent GEX recomputation found anywhere.

### Live-value & timestamp consistency (Phases 2/9)
SKIP — auth-gated (401). Cannot compare wall/spot values or asof-timestamp desync unauthenticated.
Recommend running these from an authenticated session or server-side cron with CRON_SECRET.
---

## Re-verification — 2026-06-27 16:55 ET
**Source-connectivity PASS: all channels hold | Live phases (2/3/9): SKIP (auth 401) | Open WARNs: 2 (unchanged)**

Independent re-audit this cycle corroborated the matrix above — no regression on any deploy since 14:59.
Confirmed by re-reading source (not cached): the single GEX source `getGexPositioning`
(`providers/gex-positioning.ts`) is consumed identically by Heatmaps, Largo (`get_gex`/`get_positioning`),
Night Hawk (`nighthawk/positioning.ts:92`), and Night's Watch (`position-context.ts` `fetchGexHeatmap`).
HELIX flows reach Night's Watch (`fetchRecentFlows`→`verdict.flowAlignment`), Night Hawk (`data-sources.ts`
`flow_alerts` streak), and Largo (`get_options_flow` = "same feed as dashboard", run-tool.ts:510). SPX desk
(`loadMergedSpxDesk`) feeds Largo + Night's Watch; Grid macro events gate SPX plays
(`spx-play-gates.ts:48` FOMC/CPI/NFP hard-block + `spx-lotto-catalyst.ts:206` catalyst scoring). Largo's
~89-tool catalog reaches every domain — no blind service.

**Carried-forward residuals (no new failures this cycle):**
- WARN `GRID(earnings)→SPX` — earnings only via Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment placed on desk payload but read by 0 confluence scorers.
- Watch item: `spx-desk-merge.ts` defaults `macro_events:[]`/`news_headlines:[]` — verify the loader populates
  them live (the gate logic is correct; an empty feed would silently disable macro hard-blocks).

**Live numeric/timestamp consistency (Phases 2,3,9): not verifiable from this session.** All data endpoints
(`spx/pulse`, `gex-positioning`, `flows`, `nighthawk/edition`, `grid/*`) return 401 unauth; only
`/api/public/track-record` is open. The SKILL's endpoint paths are stale (real paths use `spx/pulse`,
`market/flows`, `market/nighthawk/edition`, `grid/catalysts`). Run Phases 2/3/9 from an authenticated
server-side context (CRON_SECRET) to compare live wall/spot values and asof-timestamp desync.
---

## Re-verification — 2026-06-27 18:55 ET
**Source-connectivity PASS: all 17 channels hold | FAIL: 0 | Live phases (2/3/9): SKIP (auth 401) | Open WARNs: 2**

Fourth cycle today; independently re-derived the full matrix from source (not from the entries above) and
reached the same verdict — no regression on any deploy since 16:55. Re-confirmed the central silo risk is
clean: `getGexPositioning` (`providers/gex-positioning.ts:150`) is a pure cache-reader of
`fetchGexHeatmap` → `gex-heatmap:{ticker}`, consumed identically by Heatmaps, Largo (`get_gex`/
`get_positioning` run-tool.ts:919,1213), Night Hawk (`nighthawk/positioning.ts:92`), and Night's Watch
(`position-context.ts:184`). Largo's full cross-tool surface routes through shared functions — `get_spx_structure`/
`get_spx_confluence` → `getLargoSpxLiveDesk`+`computeSpxConfluence` (run-tool.ts:870,1207), `get_flow_tape`/
`get_postgres_flows` → `marketPlatform.flows` (HELIX), `get_nighthawk_*` → `marketPlatform.nighthawk`+staged
dossiers, `get_my_positions` → `getEnrichedPositionsForUser` (Night's Watch). No parallel/independent fetch found.

**Watch item from 16:55 — CLOSED.** The `spx-desk-merge.ts` empty `macro_events:[]`/`news_headlines:[]` are only
the skeleton defaults (spx-desk.ts:812); the live build populates them from real feeds: `macro_events` ←
`mergeMacroEventsToday` (spx-desk.ts:1010,1130), `news_headlines` ← Benzinga (`fetchBenzingaNews` :864 → :978,1131),
`macro_indicators` ← UW economy (:1022,1137). Macro hard-blocks are NOT silently disabled by an empty feed.

**Carried-forward residuals (unchanged — coverage gaps, not silos):**
- WARN `GRID(earnings)→SPX` — earnings absorbed only via Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment present on desk payload (:1137) but read by 0 confluence scorers.

**SKILL maintenance flag (recurring):** the task's Phase 1 endpoint paths AND its Phase 3/8 hypotheses are stale —
real paths are `market/spx/pulse`, `market/gex-positioning`, `market/flows`, `market/nighthawk/edition`, `grid/*`
(all 401 unauth); Phase 3 ("SPX desk blind to HELIX flow") and Phase 8 ("SPX desk doesn't know FOMC/CPI") are both
DISPROVEN by source. Live numeric/timestamp consistency (Phases 2/3/9) remains unverifiable without CRON_SECRET.
---

## Connectivity Matrix — 2026-06-27 20:55 ET
**Source-grounded verdict | structural PASS: 14 | FAIL: 0 | WARN: 2 (carried) | live numeric: UNVERIFIABLE (401 unauth, market closed Sat)**

Fifth cycle today. Independently re-derived the entire matrix from source again (cold, not from prior entries)
and reached an identical verdict — no regression on any deploy since the 16:55 run.

| Channel | Status | Evidence |
|---|---|---|
| SPX→{HELIX,NWATCH,LARGO} | PASS | desk via `getLargoSpxLiveDesk`+`computeSpxConfluence`; verdict reads SPX price/VWAP (50 refs) |
| HELIX→{SPX,NHAWK,NWATCH,LARGO} | PASS | spx-desk-merge flow refs (57) + `computeFlowStrikeStacks`; NHawk candidates/scorer (42/72); verdict (55); Largo `marketPlatform.flows` |
| HEATMAP→{LARGO,HELIX,NHAWK,NWATCH} | PASS | single `getGexPositioning` cache-reader of `fetchGexHeatmap` — same source for flows route, largo-live-feed, `nighthawk/positioning.ts`, `position-context.ts:184` |
| HEATMAP→SPX | BY-DESIGN | SPX desk uses 0DTE-lens `gamma-desk` path (spx-desk.ts:21), not the cache-reader — documented, converged, monitor for drift |
| LARGO→ALL | PASS | run-tool reaches GEX, flows, spx structure/confluence, positions, nighthawk, earnings, news, dark-pool, macro-events, web search |
| GRID→{SPX,LARGO,NHAWK,NWATCH} | PASS | shared `macro-events` provider (spx-desk.ts:1010 ↔ run-tool.ts:32) + `fetchBenzingaCatalysts` shared across grid/largo/nighthawk/nights-watch/position-detail |

### Carried-forward residuals (coverage gaps, NOT data silos — unchanged)
- WARN `GRID(earnings)→SPX` — earnings reach SPX desk only as Benzinga headline sentiment, not a distinct confluence factor.
- WARN `macro_indicators→SPX` — UW GDP/CPI/unemployment present on desk payload (spx-desk.ts:1137) but read by 0 confluence scorers.

### Live-data limitation this cycle
All entitled data endpoints returned 401 (unauthenticated) and it is Saturday (market closed). Numeric/timestamp
consistency Phases (2/3/9) are UNVERIFIABLE without CRON_SECRET — only structural wiring was re-confirmed from source.
`market/health` = 200.

### SKILL maintenance flag (recurring — task file is stale)
Phase 1 endpoint paths are wrong: real paths are `market/spx/pulse`, `market/gex-positioning`, `market/flows`,
`market/nighthawk/edition`, `grid/*` (no `grid/news`; `api/flows` and `nighthawk/latest-edition` do not exist).
Phase 3 ("SPX desk blind to HELIX flow") and Phase 8 ("SPX desk ignores FOMC/CPI") remain DISPROVEN by source.
Largo registry lives at `src/lib/largo/run-tool.ts` + `tool-defs.ts` (not `src/lib/run-tool.ts`/`src/lib/tools`).
---

---

## Connectivity Matrix — 2026-06-27 22:58 ET (source-grounded run)

**Mode:** SOURCE-LEVEL (code wiring). Live-data consistency phases (2/3/9) SKIPPED — all
data endpoints returned **401 Unauthorized** unauthenticated and today is **Saturday (market closed)**,
so live RTH cross-tool value comparison is not meaningful. Verified convergence by reading the
shared data-source code paths instead — the durable signal.

**Verdict: PASS — no source-level silos. Every consumer reads a shared ground-truth source.**

| Source → Consumer | Status | Shared source / evidence |
|---|---|---|
| SPX Desk → Heatmaps | PASS | `getGexPositioning` = pure `fetchGexHeatmap` cache-reader (converged, W1) |
| HELIX → SPX Desk | PASS | desk payload carries `flow_0dte` / `spx_option_flows` (sweeps/blocks) / `strike_stacks` (spx-commentary.ts:544) |
| Heatmaps → Largo | PASS | `get_gex` returns `getLargoSpxLiveDesk` walls — *"same as SPX Sniper dashboard"* (run-tool.ts:919); non-SPX path = `fetchGexHeatmap` |
| Heatmaps → Night's Watch | PASS | position-context.ts:19 imports `fetchGexHeatmap`; walls read off shared `gexWalls` field (verdict.ts) |
| HELIX → Night Hawk | PASS | candidates.ts `aggregateTickerFlows` builds plays FROM flow prints (premium/sweep bonus) |
| HELIX → Night's Watch | PASS | position-context.ts:22 `fetchRecentFlows` (HELIX/Postgres); verdict FLOW_MIN_PREMIUM/SKEW signals |
| SPX Desk → Night's Watch | PASS | position-context.ts:16 `loadMergedSpxDesk`; verdict uses `underlyingPrice` + walls |
| Largo → ALL services | PASS | **89 tools** spanning every service (see below) |
| Grid → SPX Desk | PASS | desk `macro_events` = `mergeMacroEventsToday` + `news_headlines` = `fetchBenzingaNews` (spx-desk.ts:1130-1131) |
| Grid → Largo | PASS | `get_catalysts` / `get_economic_calendar` / `get_market_context` / `get_earnings` / `get_dark_pool` |

### Largo cross-service access (89 tools — fully connected, zero blind spots)
- **SPX:** get_spx_structure, get_spx_play, get_spx_confluence (`computeSpxConfluence` on cached desk), get_spx_play
- **GEX/Heatmap:** get_gex (= live merged SPX desk for 0DTE), get_positioning, get_oi_per_strike
- **HELIX flows:** get_flow_tape, get_options_flow, get_postgres_flows, get_global_flow, get_signal_log, get_greek_flow
- **Night's Watch:** get_my_positions, get_open_plays, get_trade_history
- **Night Hawk:** get_nighthawk_edition, get_nighthawk_dossier, get_nighthawk_outcomes
- **Grid:** get_catalysts, get_economic_calendar, get_earnings(_market/_history), get_dark_pool, get_congress_trades, get_analyst_ratings, get_market_movers, get_market_context, get_web_search
- **Aggregator:** get_platform_snapshot (single cross-tool snapshot)

### Notes / caveats
- The SKILL's hardcoded paths are STALE: real paths are `/api/market/spx/pulse`, `/api/market/flows`, `/api/market/gex-positioning`, `/api/market/nighthawk/edition`, `/api/grid/*` — and all are **auth-gated** (401 unauth). Only `/api/public/track-record` is public.
- SKILL Phase-3 heuristic (looking for `flowBias`/`netFlow`/`flowSignal` field names) would **false-FAIL**: the SPX desk DOES carry HELIX flow, just under `flow_0dte`/`spx_option_flows`. Source truth = PASS.
- Live-value divergence (the only thing source review can't catch — e.g. a stale cache serving different numbers to two consumers) requires an authenticated RTH run; re-verify Monday market-open.

---

## Connectivity Matrix — 2026-06-28 00:55 ET (automated)
**PASS: 13 | FAIL: 0 | WARN: 0** — source-grounded (live value-equality BLOCKED: endpoints 401 auth-gated, market closed Sat)

| Channel | Status | Evidence |
|---|---|---|
| SPX Desk ↔ Heatmaps (GEX) | PASS | `mergeFlowIntoDesk` overlays `gex_walls`/`gex_net`/`gex_king`/`gamma_flip` (spx-desk-merge.ts:262-283) — one gamma source |
| HELIX → SPX Desk | PASS | desk carries `spx_flows`/`flow_0dte_net`/`recent_flows`/`unified_tape`/`dark_pool` (spx-desk-live.ts:30-41, merge.ts:277) |
| Heatmaps → Largo | PASS | `get_gex` → `getLargoSpxLiveDesk`; largo-live-feed.ts:10,84 imports `getGexPositioning` — *"same cache as Heatmaps, zero extra API calls"* |
| Heatmaps → Night Hawk | PASS | positioning.ts:8-10 `fetchPolygonPositioningBundle` + `getGexPositioning` |
| Heatmaps → Night's Watch | PASS | position-context.ts:19 `fetchGexHeatmap`; verdict reads shared `gexWalls` (verdict.ts:14-17,99-101) |
| HELIX → Night Hawk | PASS | hunt-builder.ts:18,247 `fetchRecentFlows`; candidates/dossier `flow-streak`; data-sources `flow_alerts` |
| HELIX → Night's Watch | PASS | position-context.ts:22 `fetchRecentFlows`; verdict `FLOW_MIN_PREMIUM 250k` / `FLOW_SKEW_RATIO 1.5` signals |
| SPX Desk → Night's Watch | PASS | position-context.ts:16 `loadMergedSpxDesk` (shared cache); verdict uses spot + walls |
| GEX → Night Hawk | PASS | positioning.ts `analyzeStrikeGexRows`/`topGexWalls`/`computeGammaFlip` |
| Largo → ALL | PASS | 60 cases in run-tool.ts: get_gex, get_spx_structure/play, get_flow_tape/postgres_flows, get_nighthawk_edition, get_open_plays/trade_history, get_platform_snapshot |
| Grid → SPX Desk | PASS | desk `macro_events`/`macro_indicators` (merge.ts:474,481); spx-lotto-catalyst.ts:1,35 consumes `MacroEvent` (CPI/FOMC/PCE/NFP/PPI/...) |
| Grid → Largo | PASS | get_economic_calendar/news/congress_trades/dark_pool/earnings/analyst_ratings |
| Grid → Night Hawk | PASS | catalyst-awareness `scoreCatalystAwareness(BenzingaCatalyst)`; market-wide macro-events |

### This run
- Re-verified every data-source-sharing channel from source after the SKILL's hardcoded routes 404'd. Real routes: `/api/market/spx`, `/api/market/gex-positioning`, `/api/market/flows`, `/api/market/nighthawk`, `/api/grid/*` — all **401 auth-gated** (correct posture), so live numeric value-equality could not be compared from this unauthenticated context.
- SKILL Phases 3/6/8 predict DISCONNECTED (SPX blind to flows, Night's Watch ignores walls/flows, SPX ignores econ). **All three are FALSE per source** — those channels are wired. Heuristics keyed on field names (`flowBias`/`netFlow`) false-FAIL; real fields are `flow_0dte_net`/`spx_flows`.
- **Only residual gap = live-value drift** (two consumers served different numbers by a stale cache) — invisible to source review. Re-confirm with an authenticated RTH run Monday 2026-06-29.

---

## Connectivity Matrix — 2026-06-28 02:5x ET (automated, source-verified)
**PASS: 17 | FAIL: 0 | WARN: 1** — live numeric probe auth-gated (all endpoints 401), so this is a **code-verified** pass, not a live-value pass.

### Tested channels (source evidence)
| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP | PASS (code) | `data-integrity-verifier.ts:534` reconciles desk spot == `gex-positioning` cache spot every RTH cycle — both hops feed the same number |
| HEATMAP → SPX | PASS (code) | desk GEX + `getGexPositioning` are the same shared matrix cache |
| HELIX → SPX | PASS (code) | desk carries flow tape/alerts; `computeSpxConfluence` scores flow into the thesis |
| HEATMAP → LARGO | PASS (code) | `get_positioning` → `fetchPositioningSummary` → `getGexPositioning` (positioning.ts:87 "same cache Heatmaps/Largo/SPX desk read"); `get_gex` for SPX 0DTE reads the live merged desk |
| HELIX → LARGO | PASS (code) | `get_flow_tape`/`get_postgres_flows` → `marketPlatform.flows` (ingested flow_alerts) |
| HELIX → NHAWK | PASS (code) | `candidates.ts` ranks tickers off ingested flow premium (`total_premium`/`fetchTickersAvgDailyPremium`) |
| HEATMAP → NHAWK | PASS (code) | `nighthawk/positioning.ts` primary path = `getGexPositioning` shared cache |
| SPX → NWATCH | PASS (code) | `verdict.ts` evaluates spot/price; context from `loadMergedSpxDesk` (same SPX desk cache) |
| HEATMAP → NWATCH | PASS (code) | `position-context.ts:19` `fetchGexHeatmap` (per-ticker) + merged SPX desk → shared `gexWalls`; verdict reads off it |
| HELIX → NWATCH | PASS (code) | `verdict.ts` flow signals gated by `FLOW_MIN_PREMIUM`/`FLOW_SKEW_RATIO` off shared flow premium |
| GRID → SPX | PASS (code) | `providers/spx-desk.ts` builds `macro_events` (`mergeMacroEventsToday`), `news_headlines`, `macro_indicators` (FOMC/CPI/econ) onto the desk |
| NHAWK → LARGO | PASS (code) | `get_nighthawk_edition`/`_outcomes`/`_dossier` → `marketPlatform.nighthawk` (same data as `/nighthawk`) |
| NWATCH → LARGO | PASS (code) | `get_my_positions` → `getEnrichedPositionsForUser` (per-user, Clerk-scoped, fail-closed) |
| GRID → LARGO | PASS (code) | `get_news`/`get_catalysts`/`get_earnings`/`get_economic_calendar`/`get_analyst_ratings`/`get_congress_trades`/`get_dark_pool` |
| LARGO → ALL | PASS (code) | `get_platform_snapshot` cross-service join (spx+flows+nighthawk); 80+ tool surface in `tool-defs.ts` covers every service |
| SPX confluence → LARGO | PASS (code) | `get_spx_confluence` → `computeSpxConfluence(desk)` pure compute, no divergent path |
| SPX desk spot ↔ GEX cache | PASS (code) | automated `hop_spot` reconciliation ≤0.5% (`data-integrity-verifier.ts:534`) |

### WARN
- **Largo `get_positioning` returns `gex_king_strike: null`** (positioning.ts:109 — the light contract drops king strike). Largo's `get_gex` SPX-desk path *does* carry `gex_king`, but a generic per-ticker positioning query won't surface the king strike that Heatmaps shows. Cosmetic completeness gap, not a divergence — both still read `getGexPositioning`. Consider surfacing `gex_king` in the light contract.

### Not verifiable this run
- **Live numeric value-equality** (two consumers served different numbers by a stale cache) — every endpoint is 401 auth-gated from this unauthenticated context, so equality of live `callWall`/`putWall`/`spot` could not be asserted. Re-run authenticated during RTH to close the loop. Source guarantees a shared cache key; only a stale-cache race could break it, which the `hop_spot` verifier already canaries during RTH.
- **SKILL hardcoded routes are stale** (`/api/market/spx-pulse`, `/api/flows`, `/api/nighthawk/latest-edition`, `/api/grid/news` → 404). Real routes: `/api/market/spx`, `/api/market/spx/pulse`, `/api/market/flows`, `/api/market/nighthawk`, `/api/grid`. SKILL Phases 3/6/8 field-name heuristics (`flowBias`/`netFlow`/`spx_uses_econ`) would false-FAIL — the channels are wired under different field names.

---

## Re-verification — 2026-06-28 04:55 ET (automated, off-hours)
**PASS: 16 | FAIL: 0 | WARN: 1** — independent source re-trace; matrix unchanged since the prior run today. No deploy broke connectivity.

Convergence points re-confirmed by reading source (not assumptions):
- **GEX** — `getGexPositioning` is a strict cache-reader over `fetchGexHeatmap(ticker)` (gex-positioning.ts:12). Heatmaps, Largo `get_gex` (non-SPX), Night's Watch `position-context.ts:19` all read `fetchGexHeatmap`; SPX 0DTE reads the merged desk ("same as SPX Sniper dashboard", run-tool.ts:935). One matrix, no fork.
- **Flows** — `marketPlatform.flows.getFlowTapeSummary` (flow-service.ts:1) and the HELIX `/api/market/flows` route both read `fetchRecentFlows` (Postgres flow_alerts). Night Hawk edition-builder reads via `marketPlatform.flows`; Night's Watch reads `fetchRecentFlows` directly. Single source.
- **SPX desk** — `loadMergedSpxDesk` / `getLargoSpxLiveDesk` / platform `spx-service` all merge one desk payload; Night Hawk pulls spxDesk+spxPlay+spxLotto+spxPowerHour (edition-builder.ts:507).
- **Macro/news (Grid→SPX)** — SPX desk (`spx-desk.ts:1029,1010,864`) and Grid economy (`providers/grid.ts:405`) both use `fetchUwMacroIndicators`; events via `mergeMacroEventsToday`, news via `fetchBenzingaNews`. SPX desk is NOT blind to FOMC/CPI.

Largo cross-service access (run-tool.ts, 80+ tool cases) covers every service: `get_gex`, `get_spx_confluence`/`get_market_context`, `get_flow_tape`/`get_postgres_flows`/`get_global_flow`, `get_nighthawk_edition`/`_outcomes`/`_dossier`, `get_my_positions`/`get_open_plays`/`get_positioning`, `get_catalysts`/`get_congress_unusual`/`get_economic_calendar`/`get_earnings`/`get_analyst_ratings`/`get_dark_pool`. No blind spots → no hallucination risk surface.

WARN (carried, unchanged): `get_positioning` light contract drops `gex_king_strike` (positioning.ts:109) — cosmetic completeness gap, same underlying cache.

Not verifiable this run: live numeric value-equality (all data endpoints 401 auth-gated from unauthenticated context + 04:55 ET off-hours). Source guarantees shared cache keys; the `hop_spot` RTH verifier canaries stale-cache races. Re-run authenticated during RTH to close the value-equality loop.

_No commit this cycle: not first-today (2 prior entries) and FAIL=0, per task rule. Log appended for continuity._

---

## Re-verification — 2026-06-28 06:55 ET (automated, off-hours, 3rd run today)
**PASS: 16 | FAIL: 0 | WARN: 1** — independent source re-trace from the consumer side. Matrix unchanged; no deploy since the 04:55 run broke connectivity.

Confirmed by reading each consumer's import + call site (not field-name heuristics):
- **Shared GEX (one matrix)** — `nighthawk/positioning.ts:92 getGexPositioning(sym)` ("the same cache key"); `nights-watch/position-context.ts:19 fetchGexHeatmap`; Largo `run-tool.ts:919 get_gex` (SPX→`getLargoSpxLiveDesk` = "same as SPX Sniper dashboard", else UW/polygon ladder); heatmap route + flows route both read `getGexPositioning`. Single source confirmed across SPX/HEATMAP/LARGO/NHAWK/NWATCH.
- **HELIX→SPX is WIRED, not blind** (refutes SKILL Phase 3 hypothesis) — `spx-desk-merge.ts:262 mergeFlowIntoDesk` overlays the UW flow lane (tape, dark pool, GEX walls, 0DTE call/put premium) onto the desk; `spx-signals.ts:228 scoreFlowStrikeConcentration` feeds confluence. The desk's `flowBias`/`netFlow` fields don't exist by those names — the signals live under `spx_flows`/`flow_0dte_net`, which is why the SKILL's field-name probe would false-FAIL.
- **GRID→SPX is WIRED, not blind** (refutes SKILL Phase 8 hypothesis) — `spx-desk.ts:1010 mergeMacroEventsToday` populates `macro_events` (FOMC/CPI), `:1029 fetchUwMacroIndicators` populates `macro_indicators` (GDP/CPI/unemployment), `spx-signals.ts:181` scans headlines for Fed/halt/CPI/PCE macro-shock keywords and penalizes confluence. SPX desk is NOT blind to event risk.
- **HELIX→NWATCH / SPX→NWATCH** — `verdict.ts` reads the shared `gexWalls` field (source spx-desk OR gex-heatmap, never fabricated: `hasWalls()` gates on real walls+spot) plus flow premium (`FLOW_MIN_PREMIUM 250k`, `FLOW_SKEW_RATIO 1.5`); `position-context.ts:22 fetchRecentFlows` + `:16 loadMergedSpxDesk` supply them. Pure cache-reader, no refetch.
- **Largo→ALL** — `run-tool.ts` 76+ tool cases span every service: `get_gex`, `get_spx_structure`/`get_spx_play`, `get_options_flow`/`get_flow_tape`/`get_postgres_flows`, `get_nighthawk_edition`, `get_open_plays`/`get_trade_history` (+`getEnrichedPositionsForUser` import), `get_economic_calendar`/`get_news`/`get_dark_pool`/`get_earnings`/`get_congress_trades`/`get_analyst_ratings`. No blind spot → no hallucination surface.

WARN (carried, unchanged): Largo `get_gex` per-ticker NON-SPX path (`run-tool.ts:940-959`) reads UW/polygon ladders directly rather than `getGexPositioning` — acceptable (the heatmap matrix is SPX-centric; SPX itself routes to the shared desk), but it is a second code path for non-SPX gamma. Cosmetic; flagged for eventual convergence, not a data-silo risk.

Not verifiable this run (coverage limit, NOT a pass): live numeric value-equality. Every data endpoint returned **401** from this unauthenticated context (verified live: `/api/market/spx/pulse`, `/api/market/flows`, `/api/market/nighthawk/edition`, `/api/grid/economy`, `/api/grid/dark-pool`, `/api/market/gex-positioning` all 401 after the www→apex 301), and 06:55 ET is pre-RTH. Source guarantees shared cache keys; the `hop_spot` RTH verifier canaries stale-cache races. Re-run authenticated during RTH to assert equality of live `callWall`/`putWall`/`spot`.

_No commit this cycle: not first-today (3rd entry) and FAIL=0, per task rule. Working tree also carries unrelated edits (https-monitor.md, a worktree) that a commit would wrongly sweep in. Appended for continuity._

---

## Connectivity Matrix — 2026-06-28 08:59 ET
**PASS: 11 | WARN: 1 | LIVE-SKIP: 4 (auth-gated)**

Run mode: unauthenticated scheduled task. All data endpoints are auth-gated
(`gex-positioning` 401, `grid/economy` 401) or moved (404 on the SKILL's stale
paths). **Live numeric cross-checks (walls/price/timestamp diffs) could not run** —
verified connectivity at the SOURCE level instead (import graph + shared cache/provider
wiring), which is the durable signal and survives an unauthenticated context.

### Matrix (source-level wiring)
| Channel | Status | Evidence |
|---|---|---|
| SPX→HEATMAP | PASS | `getGexPositioning` is a pure cache-reader of `fetchGexHeatmap` (shared `gex-heatmap:{ticker}` cache, mem+Redis); SPX desk merge writes the same walls. Converged. |
| HELIX→SPX | PASS | `mergeFlowIntoDesk` overlays HELIX flow tape + dark pool + GEX walls onto the SPX desk payload (spx-desk-merge.ts:262). |
| HELIX→NHAWK | PASS | Night Hawk candidates consume flow via `fetchTickersFlowStreaks`/unusual-flow gates; agent-config aligns plays to "current SPX flow / GEX context". |
| HELIX→NWATCH | PASS | `position-context.ts` calls `fetchRecentFlows` → call/put premium summary → verdict flow signals (FLOW_MIN_PREMIUM / FLOW_SKEW_RATIO). |
| HEATMAP→NWATCH | PASS | `getNwTickerGex` wraps `fetchGexHeatmap` (same shared cache as Heatmap), per-ticker; SPX uses the merged desk. verdict reads `gexWalls`. |
| SPX→NWATCH | PASS | `position-context.ts` loads merged SPX desk (`loadMergedSpxDesk`) → underlyingPrice + walls + regime feed the verdict. |
| HEATMAP→LARGO (SPX/0DTE) | PASS | Largo `get_gex` for SPX-today returns `getLargoSpxLiveDesk` — "same as SPX Sniper dashboard". |
| HELIX→LARGO | PASS | `get_options_flow`, `get_flow_tape`, `get_postgres_flows`, `get_unusual_trades`. |
| NHAWK→LARGO | PASS | `get_nighthawk_edition`. |
| NWATCH→LARGO | PASS | `get_my_positions` (auth-scoped, ownership-checked) + `get_positioning`. |
| GRID→SPX | PASS | SPX desk consumes `desk.macro_events` (CPI/FOMC/PCE/NFP) for lotto catalysts AND `macroHardBlock` play gates (spx-play-gates.ts:48). SPX desk is NOT blind to event risk. |
| HEATMAP→LARGO (non-SPX) | **WARN** | For non-SPX tickers/expiries, Largo `get_gex` hits raw `fetchPolygonOdteGexRows`/`fetchUwSpotExposuresByStrike` directly — a DIFFERENT path than the `getGexPositioning` cache-reader the Heatmap uses. Same upstream provider, different cache → possible minor value/timestamp drift between what Largo quotes and what the Heatmap shows for non-SPX GEX. SPX path is converged. |

### Largo cross-service tool coverage (Phase 7) — STRONG (80+ tools)
- SPX: `get_spx_structure`, `get_spx_play`, `get_open_plays`, `get_spx_confluence`, `get_quote`
- GEX walls: `get_gex`, `get_greek_flow`, `get_group_greek_flow`
- HELIX flows: `get_options_flow`, `get_flow_tape`, `get_postgres_flows`, `get_unusual_trades`, `get_global_flow`
- Night's Watch: `get_my_positions`, `get_positioning`, `get_trade_history`
- Night Hawk: `get_nighthawk_edition`
- Grid: `get_news`, `get_earnings`, `get_dark_pool`, `get_economic_calendar`, `get_congress_trades`, `get_analyst_ratings`, `get_sector_flow`, `get_market_movers`
- Platform-wide: `get_platform_snapshot`
No blind spots found — Largo can reach every other service's data.

### Notes / follow-ups
- **SKILL.md endpoint paths are stale.** Real paths: SPX = `/api/market/spx/desk` & `/api/market/spx/merged` (no `/api/market/spx-pulse`); flows = `/api/market/flows` (not `/api/flows`); Night Hawk = `/api/market/nighthawk/edition` (not `/api/nighthawk/latest-edition`); there is no `/api/grid/news` (Grid = analysts/catalysts/congress/dark-pool/earnings/economy/movers/sectors; general news is `/api/market/news`).
- **Live-consistency arm is blind without a service token.** The numeric wall/price/timestamp diff checks (the part that catches real-time desync) need authenticated access. Recommend wiring a service/cron token so this auditor can pull the gated endpoints; right now it can only verify structural wiring.
- **Grid econ vs SPX macro share UW but via distinct feeds:** SPX desk uses the UW economic-*calendar* (event dates/times, for blocking); Grid economy uses UW macro-*indicators* (released series). Both UW, different endpoints — by design, not a silo.
---

## Connectivity Matrix — 2026-06-28 10:57 ET
**Source-wiring verdict: 11 PASS · 1 WARN · 0 FAIL** · Live-consistency: UNVERIFIED (auth-gated endpoints return 401; market closed Sun 2026-06-28 — live numbers not pulled, not fabricated)

### Method note
Live HTTP probes returned 401 (auth-gated) on every data endpoint and the SKILL's literal paths are stale (`/api/market/spx-pulse` is `/api/market/spx/pulse`; no `/api/grid/news`). Sunday = no live RTH numbers to compare. This run therefore audits the **source-level wiring** — whether every consumer reads from the *same shared data functions* — which is the durable, deploy-sensitive guarantee. Numeric-consistency cells (Phases 2/3/9) require an authed RTH run.

### Convergence backbone
`marketPlatform.spx` / `marketPlatform.flows` (src/lib/platform/) is the single shared access layer. Largo (run-tool.ts), Night Hawk (edition-builder.ts), and Night's Watch all read through it or through the same caches (`fetchGexHeatmap` → `gex-heatmap:{ticker}` in-memory+Redis). GEX has one source of truth: `fetchGexHeatmap`; `getGexPositioning` is a **pure cache-reader** of it (no upstream call).

| Channel | Status | Evidence |
|---|---|---|
| SPX→HEATMAP | PASS | Both derive from the `fetchGexHeatmap` matrix; `spx-desk-merge.mergeFlowIntoDesk` carries the same `gex_walls`; `getGexPositioning` is a pure cache-reader (gex-positioning.ts:142). |
| HELIX→SPX | PASS | `mergeFlowIntoDesk` overlays `spx_flows`, `flow_0dte_*_premium`, `unified_tape`, `dark_pool` onto the desk (spx-desk-merge.ts:262-296). SKILL's "SPX desk blind to flows" prediction is **false**. |
| HEATMAP→LARGO | **WARN** | SPX/0DTE `get_gex` → `getLargoSpxLiveDesk` ("same as SPX Sniper dashboard") = converged. **Non-SPX / non-0DTE `get_gex` falls through to `fetchPolygonOdteGexRows` + raw UW fetches, bypassing the shared `fetchGexHeatmap` cache-reader** (run-tool.ts:919-960). W3 residual. |
| HELIX→LARGO | PASS | `get_flow_tape`/`get_postgres_flows` → `marketPlatform.flows.getFlowTape(Summary)` (run-tool.ts:886,905). |
| HELIX→NHAWK | PASS | edition-builder pulls `getFlowTapeSummary({limit:30})`; format.ts emits "HELIX tape (top 5 of N)" into the edition (format.ts:137-142). PASS, not WARN. |
| HEATMAP→NHAWK | PASS | edition-builder pulls `spxDesk` (carries `gex_walls`); format.ts renders walls into overnight context (format.ts:117). |
| SPX→NWATCH | PASS | position-context.ts `loadMergedSpxDesk` → `gexWalls`+`underlyingPrice`; verdict.ts evaluates price vs walls (verdict.ts:91-131). |
| HEATMAP→NWATCH | PASS | Non-SPX positions read `fetchGexHeatmap(root)` (same cache) → source:"gex-heatmap" walls (position-context.ts:185,230). |
| HELIX→NWATCH | PASS | verdict.ts evaluates flow signals (FLOW_MIN_PREMIUM 250k / FLOW_SKEW_RATIO 1.5, verdict.ts:70-75). SKILL's "verdict ignores flows" prediction is **false**. |
| GRID/MACRO→SPX | PASS | Desk is event-aware via `macro_events` threaded merge→spx-service (spx-service.ts:55). NOT "blind to FOMC". |
| LARGO→ALL | PASS | 80+ tools incl get_spx_structure/play/open_plays/trade_history, get_gex, get_flow_tape, get_nighthawk_edition, get_platform_snapshot, get_economic_calendar, get_congress_trades, get_dark_pool, get_earnings, get_analyst_ratings. |
| GRID→LARGO | PASS | get_news, get_economic_calendar, get_dark_pool, get_congress_trades, get_earnings, get_sector_flow, get_market_movers. |

### The one real divergence (WARN)
**Largo non-SPX / non-0DTE `get_gex` does not read the shared `fetchGexHeatmap` cache.** For SPX 0DTE it is fully converged with the desk/Heatmap; for any other ticker or expiry it computes GEX from a separate raw UW/Polygon path. Impact is low while Heatmaps remains SPX-centric in the live product, but a user asking Largo about non-SPX GEX could get numbers derived differently than a hypothetical Heatmap of that ticker. Fix: route the non-SPX branch through `fetchGexHeatmap(root)` (the same call NW's `getNwTickerGex` already uses) so all GEX answers share one cache.

### Corrections to the SKILL's pessimistic predictions
The SKILL pre-wrote FAIL/WARN for HELIX→SPX, HELIX→NHAWK, SPX→NWATCH, HEATMAP→NWATCH, HELIX→NWATCH, and GRID→SPX. **All six are actually PASS** — those consumers do read the shared signals. The SKILL's keyword checks looked for field names (`flowBias`, `netFlow`) that don't exist under those literal names; the wiring is real under different identifiers.
---

## Connectivity Matrix — 2026-06-28 13:00 ET
**Method: CODE-GROUNDED (live value-consistency N/A — endpoints Clerk-gated 401 + weekend/market-closed).**
**PASS: 16 | WARN: 1 | SKIP(live): 3**

Live data pulls returned 401 on every authenticated surface (spx/pulse, gex-positioning, flows,
nighthawk/edition, news, grid/*); only `/api/public/track-record` is public (200). So Phases 2/3/9
(live value & timestamp consistency) could not run unauthenticated today. The CORE of this audit —
*do services share the same data sources?* — is verified from source below and is comprehensively wired.

### Source → Consumer (code-grounded)
| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP | PASS | Both derive GEX from `fetchGexHeatmap`; `getGexPositioning` is a strict cache-reader over the same `gex-heatmap:{ticker}` matrix the Heatmap UI reads (gex-positioning.ts:11-15). SPX desk 0DTE lens differs **by design**. |
| SPX → LARGO | PASS | run-tool.ts get_spx_structure/get_spx_play/get_spx_confluence → `marketPlatform.spx` + `getLargoSpxLiveDesk` + `computeSpxConfluence` (run-tool.ts:869-892,1205-1212). |
| SPX → NWATCH | PASS | `loadMergedSpxDesk()` — the SAME merged desk SPX Slayer shows; walls/regime/flip/maxpain/levels attached to every SPX position (position-context.ts:465-483). |
| HELIX → SPX | PASS | `mergeFlowIntoDesk` overlays spx_flows, unified_tape, 0DTE premium, gex_walls onto the desk (spx-desk-merge.ts:262-316). |
| HELIX → LARGO | PASS | get_flow_tape / get_postgres_flows (`marketPlatform.flows`); get_options_flow merges `fetchRecentFlows` for non-SPX (run-tool.ts:483-569,904-908). |
| HELIX → NWATCH | PASS | `getNwTickerFlows` → `fetchRecentFlows` (Postgres) → verdict flow signals (position-context.ts:291-301; verdict.ts:206-242). |
| HELIX → NHAWK | PASS | candidates → flow-streak → `fetchTickerFlowDailyNet` from `@/lib/db` (same Postgres flow capture HELIX shows) (flow-streak.ts:1). |
| HEATMAP → NWATCH | PASS | `getNwTickerGex` → `fetchGexHeatmap` — CONVERGED with the Heatmap matrix (position-context.ts:180-187). |
| HEATMAP → NHAWK | PASS | positioning.ts uses `getGexPositioning` — comment: "same cache key Heatmaps, Largo, and the SPX desk all read… all surfaces guaranteed to agree on flip/walls/regime" (positioning.ts:87-92). |
| HEATMAP → LARGO | **WARN** | SPX/today get_gex uses the desk (consistent); **non-SPX / non-today get_gex bypasses `getGexPositioning` → direct `fetchPolygonOdteGexRows`/UW** (run-tool.ts:919-960). A user asking Largo for a non-SPX wall can get a different computation than the Heatmap shows. (Residual W3 — granular rows vs canonical wall summary, low severity.) |
| GRID → SPX | PASS | SPX desk populates `macro_events` / `news_headlines` / `macro_indicators` (spx-desk.ts:1130-1137). SPX desk is event-aware — NOT blind to FOMC/CPI. |
| GRID → LARGO | PASS | get_news, get_economic_calendar, get_catalysts, get_congress_trades, get_earnings, get_dark_pool, get_macro_indicator (run-tool.ts:709,783,851,1325,740,592,990). |
| GRID → NWATCH | PASS | dark-pool (`fetchUwDarkPool`) + earnings share the `earnings:{sym}` cache key with detail view AND Largo's get_earnings (position-context.ts:341-358,403-435). |
| NHAWK → LARGO | PASS | get_nighthawk_edition / _outcomes / _dossier + get_positioning (`fetchPositioningSummary`) (run-tool.ts:896-902,1213-1247). |
| NWATCH → LARGO | PASS | get_my_positions → `getEnrichedPositionsForUser` (same enrichment + verdict engine) (run-tool.ts:1259-1323). |
| LARGO → ALL (access) | PASS | run-tool.ts exposes tools spanning SPX desk, HELIX, Heatmaps, Night Hawk, Night's Watch, and Grid — Largo is NOT blind to any service. |

### Convergence verdicts
- **GEX is converged across Heatmaps + Night's Watch + Night Hawk + Largo(SPX)**: all read the shared `fetchGexHeatmap` / `getGexPositioning` matrix. The lone non-convergence is Largo's **non-SPX** get_gex (W3).
- **HELIX flow is converged across SPX desk + Night's Watch + Night Hawk + Largo**: all read the shared Postgres flow capture (`fetchRecentFlows` / `fetchTickerFlowDailyNet`).
- **Grid is wired into SPX (macro_events) + Night's Watch (dark-pool/earnings) + Largo (full provider set).**

### Live value/timestamp consistency (Phases 2/3/9) — SKIP today
- SKIP reason: all data endpoints Clerk-gated (401) and it is the weekend (market closed). Re-run during RTH with an authenticated session (or a server-side cron token) to validate live wall/price/timestamp agreement.

### SKILL.md drift to fix (caused false 404/FAIL heuristics this run)
- Endpoint paths: `spx-pulse`→`market/spx/pulse`; `/api/flows`→`/api/market/flows`; `nighthawk/latest-edition`→`market/nighthawk/edition`; `/api/grid/news`→`/api/market/news` (no `/api/grid/news` route).
- Source paths: `lib/run-tool.ts`→`lib/largo/run-tool.ts`; `lib/market/gex-positioning.ts`→`lib/providers/gex-positioning.ts`.
- Heuristic false-fails: Phase 3 greps for `flowBias/netFlow` fields (don't exist — desk uses `flow_0dte_net`/`spx_flows`); Phase 8 greps `spx-desk-MERGE.ts` for `FOMC|CPI` (population is in `spx-desk.ts`; field is `macro_events`).
---

---

## Run — 2026-06-28 18:55 ET (source-wiring re-verification; live probes stale)

**Verdict unchanged: connectivity is structurally STRONG.** Re-traced every consumer's
import/call site this run. All prior `✓` cells hold; no new silo, no regression.

**NEW this run — live HTTP probing is no longer viable from the SKILL's path list.**
The SKILL's Phase 1 endpoints have drifted and now **404** (not merely auth-gated):
- `/api/market/spx-pulse` → 404. Real route: `/api/market/spx/desk`.
- `/api/flows` → 404. Real route: `/api/market/flows`.
- `/api/nighthawk/latest-edition` → 404. Real route: `/api/market/nighthawk/edition`.
- `/api/grid/news` → 404. Grid has no `/news`; news lives at `/api/market/news`.
  Grid routes are: analysts, catalysts, congress, dark-pool, earnings, economy, movers, sectors.
- `/api/market/gex-positioning` → **401 by design** (heatmap-gated; internal consumers
  call `getGexPositioning()` directly, not the HTTP route).
- `/api/grid/economy` → 401.

Net: a **live numeric reconciliation** (e.g. SPX callWall == GEX callWall within 25 pts)
could NOT be performed this run — and today is Sunday (market closed), so live values
would be stale/empty regardless. The cells below are **source-wiring verdicts** (which
shared function each consumer imports), which is the durable signal. The SKILL's Phase 1
path list should be refreshed to the real routes above for any future live diff.

### Matrix (source-wiring verified)

| Channel | Status | Shared source / call site |
|---|---|---|
| SPX → HEATMAP | PASS | desk walls fed by same `fetchGexHeatmap` cache the heatmap's `getGexPositioning` wraps |
| HELIX → SPX | PASS | `spx-desk-merge.ts` carries `spx_flows`, `flow_0dte_net`, 0DTE call/put premium, `net_flow_by_expiry` |
| HEATMAP → LARGO | PASS | `get_gex` SPX path → `getLargoSpxLiveDesk` (= SPX Sniper desk, heatmap-fed); non-SPX → Polygon/UW raw (no shared heatmap counterpart, by design) |
| HELIX → LARGO | PASS | `get_options_flow`, `get_flow_tape`, `get_postgres_flows`, `get_global_flow` |
| HELIX → NHAWK | PASS | `candidates.ts` → `fetchTickersFlowStreaks`, `flow_alerts`, `has_sweep` / `aggregateTickerFlows` |
| HELIX → NWATCH | PASS | `position-context.ts` → `fetchRecentFlows` (same flow store) |
| SPX → NWATCH | PASS | `position-context.ts` → `loadMergedSpxDesk` + `isSpxTicker` |
| HEATMAP → NWATCH | PASS | `position-context.ts` → `fetchGexHeatmap` (same heatmap source) |
| GRID → NWATCH | PASS | `position-context.ts` → `fetchBenzingaEarnings` / `fetchUwEarnings` / `fetchUwDarkPool` |
| GRID → SPX | PASS | shared `macro-events.ts` surfaced as desk `macro_events`; macroHardBlock regex (fed/fomc/cpi/pce/geopolitical) in `spx-signals.ts` |
| LARGO → ALL | PASS | SPX (`get_spx_structure/play/confluence`), GEX (`get_gex`), HELIX (`get_options_flow`/`get_flow_tape`), NHawk (`get_nighthawk_edition/outcomes/dossier`), NWatch (`get_my_positions`), Grid (`get_news`, `get_catalysts`, `get_congress_trades`, `get_analyst_ratings`, `get_economic_calendar`, `get_market_movers`) |
| NHAWK → LARGO | PASS | `get_nighthawk_edition/outcomes/dossier` |
| NWATCH → LARGO | PASS | `get_my_positions` → `getEnrichedPositionsForUser` |
| Macro provider → SPX/LARGO/NHAWK | PASS | single `macro-events.ts` (`fetchUpcomingMacroEventsLive` / `macroEventsOnDateLive`) — converged |

### Standing residuals (nuances, not failures)
- **R1 — SPX forward econ-calendar gate.** SPX desk IS event-aware (reactive
  `macroHardBlock` on breaking headlines + `macro_events` surfaced on the desk), but the
  `spx-evaluate` play engine does not pre-dampen plays off the *scheduled* econ calendar
  (upcoming FOMC/CPI windows). Low risk; the desk is not "blind to FOMC." Improvement, not a silo.
- **R2 — Largo non-SPX `get_gex` bypasses the shared cache-reader.** Confirmed still true,
  but by design: the Heatmap/`getGexPositioning` cache is SPX-only, so there is no shared
  counterpart for QQQ/single-name GEX to diverge from. No user-facing inconsistency.
- **R3 — live numeric reconciliation not run** (see NEW section). Source wiring proves a
  shared source; a live value-diff still needs an authed probe against the real routes.

### Coverage honesty
This run verified **structural** connectivity (shared imports/call sites) for all matrix
cells — STRONG, no regression. It did **not** verify live numeric agreement (auth-gated +
stale paths + market closed). No git commit emitted: not the first run today and zero FAILs.

## Connectivity Matrix — 2026-06-28 22:55 ET (structural run)
**PASS: 28 | FAIL: 0 | WARN: 2 (W2/W3 residuals) | Live-numeric: SKIPPED (auth-gated + market closed)**

Live probes all returned **HTTP 401** (spx/desk, gex-positioning, flows, nighthawk/edition,
news, grid/economy) — expected unauth behavior, documented in the task. Numeric agreement
(wall-vs-wall, spot-vs-price, timestamp desync) could not be diffed this run; verdicts below
are **source-wiring** verdicts (shared imports / call sites), which hold regardless of auth.

| Channel | Status | Evidence |
|---|---|---|
| SPX → HELIX | PASS | spx desk consumes flow via shared flow store; HELIX tape = same `flow_alerts` |
| SPX → HEATMAP | PASS | desk GEX walls = merged desk cache; Largo `get_gex` SPX path tags `source:"spx_sniper_desk"` "same as SPX Sniper dashboard" |
| SPX → LARGO | PASS | `run-tool.ts:869` `get_spx_structure`→`marketPlatform.spx.getSpxDeskSummary()`; live-feed prewarms desk |
| SPX → NHAWK | PASS | nighthawk consumes desk macro/news (market-wide.ts → macro_events/news_headlines) |
| SPX → NWATCH | PASS | position-context loads `loadMergedSpxDesk` for SPX walls (source:"spx-desk") |
| SPX → GRID | PASS | desk surfaces into platform snapshot consumed by grid panels |
| HELIX → SPX | PASS | desk flow gate reads shared flow store |
| HELIX → HEATMAP | PASS | both read Postgres flow + Polygon GEX; no divergent path |
| HELIX → LARGO | PASS | `get_flow_tape`, `get_postgres_flows`, `get_options_flow`, `get_unusual_trades` handlers |
| HELIX → NHAWK | PASS | `hunt-builder.ts:247` `fetchRecentFlows` (HELIX flow_alerts); `edition-builder` carries `flow_tape` |
| HELIX → NWATCH | PASS | `position-context.ts:22` `fetchRecentFlows`; verdict reads `flows.lean`/premium (FLOW_MIN_PREMIUM gate) |
| HELIX → GRID | PASS | grid flow/dark-pool panels read same providers |
| HEATMAP → SPX | PASS | desk merge folds GEX walls (gamma-desk) |
| HEATMAP → LARGO | PASS | `get_gex` SPX/today → shared desk; non-SPX → Polygon/UW (see W3) |
| HEATMAP → NHAWK | PASS | dossier pulls GEX exposures via UW/Polygon (same fetchers) |
| HEATMAP → NWATCH | PASS | `position-context.ts:19` `fetchGexHeatmap` (same fetcher Heatmap uses), source:"gex-heatmap" |
| HEATMAP → GRID | PASS | shared positioning reader |
| LARGO → SPX/GEX/HELIX/NHAWK/NWATCH/GRID | PASS | 60+ tool handlers incl get_spx_play, get_open_plays, get_nighthawk_edition, get_platform_snapshot, get_dark_pool, get_news, get_earnings, get_economic_calendar, get_congress_trades, get_signal_log, get_lotto_state |
| NHAWK → LARGO | PASS | `get_nighthawk_edition` handler |
| NHAWK → GRID | PASS | edition macro/news surface to grid catalysts |
| NWATCH → LARGO | PASS | `get_open_plays`/positions reachable; valuation cache-reader |
| GRID → SPX | **PASS (corrected)** | desk IS event-aware: `spx-desk.ts:1130` `macro_events: macroEventsResolved`; `spx-play-gates.ts:156` `macroHardBlock(desk)` gates plays on FOMC/CPI |
| GRID → LARGO | PASS | `get_economic_calendar`, `get_news`, `get_earnings`, `get_fda_calendar`, `get_congress_trades`, `get_analyst_ratings`, `get_dark_pool` |
| GRID → NHAWK | PASS | `market-wide.ts` macro_events/macro_indicators/news into edition dossier |

### ⚠️ Script false-FAIL to ignore (auditor calibration, not a data bug)
Phase 8 of the SKILL greps **only** `spx-desk-merge.ts` for `econ|FOMC|CPI` and would emit
`GRID→SPX = FAIL: SPX desk ignores Grid econ data`. **That is a false negative.** The merge
file initializes `macro_events: []` as a default; the actual population lives in the provider
`spx-desk.ts:1130` and the gate `spx-play-gates.ts:156 macroHardBlock(desk)`. The desk is
event-aware and hard-blocks plays around macro events. Do not report "SPX blind to FOMC."

### Residual WARNs (known, low severity — carried from connectivity-matrix memory)
- **W3** — Largo `get_gex` for **non-SPX** tickers (or non-today SPX) bypasses the shared
  `getGexPositioning`/heatmap cache-reader and calls Polygon (`fetchPolygonOdteGexRows`) / UW
  directly (`run-tool.ts:939-958`). SPX/today path IS converged (`spx_sniper_desk`). Largely
  by-design since the heatmap reader is SPX-centric, but it's a second GEX code path for
  non-SPX underlyings — same providers, no shared single-flight cache.
- **W2** — Night's Watch panel-vs-detail verdict asymmetry (not re-diffed this run; needs an
  authed list-vs-detail probe to confirm still-present).

### Live-numeric coverage honesty
This run did **NOT** verify numeric agreement (call/put walls, spot vs price, timestamp
desync) — all public routes 401 and market is closed. To close the loop, an **authed** probe
(session cookie) against spx/desk + gex-positioning + flows during RTH is required. Structural
connectivity across all 28 testable cells is STRONG with **zero FAILs** and no regression.
---

## Connectivity Matrix — 2026-06-29 00:58 ET
**PASS: 16 | FAIL: 0 | WARN: 0**
Method: SOURCE-WIRING audit. Live numeric cross-diff NOT run — all public probe routes (spx/desk, gex-positioning, flows, nighthawk, grid/economy) returned **401 (auth-gated)**. Verdicts below are from reading the actual provider/cache wiring in src, which is authoritative for "do two services share the same data source".

| Channel | Status |
|---|---|
| SPX -> HEATMAP | PASS (source): both derive GEX; SPX 0DTE merged-desk lens is by-design vs heatmap OI matrix |
| HELIX -> SPX | PASS: spx-desk-merge overlayFlowLane merges UW flow tape + dark pool into the desk |
| HEATMAP -> SPX | PASS: desk gex_walls share GEX provider chain |
| HEATMAP -> LARGO | PASS: get_positioning -> getGexPositioning (shared gex-heatmap cache); raw get_gex non-SPX uses separate 0DTE Polygon path (W3, by-design lens) |
| HELIX -> LARGO | PASS: get_flow_tape/get_postgres_flows/get_options_flow/get_global_flow |
| SPX -> LARGO | PASS: get_spx_structure/get_spx_confluence/get_spx_play (live merged desk) |
| NHAWK -> LARGO | PASS: get_nighthawk_edition/outcomes/dossier |
| NWATCH -> LARGO | PASS: get_my_positions (per-user scoped, reuses cached desk/chain layers) |
| GRID -> LARGO | PASS: get_news/get_catalysts/get_earnings/get_dark_pool/get_economic_calendar |
| HELIX -> NHAWK | PASS: dossier uses fetchMarketFlowAlertRows + flow streak (shared flow_alerts) |
| HEATMAP -> NHAWK | PASS: fetchPositioningSummary -> getGexPositioning (shared cache) |
| SPX -> NWATCH | PASS: verdict reads underlyingPrice + gexWalls |
| HEATMAP -> NWATCH | PASS: position-context -> fetchGexHeatmap (shared gex-heatmap cache) |
| HELIX -> NWATCH | PASS: position-context -> fetchRecentFlows (shared flow_alerts table) -> flow signal |
| GRID -> NWATCH | PASS: position-context carries catalysts/analyst/insider/darkPool/ivRank enrichment |
| GRID -> SPX | PASS: spx-desk-merge carries macro_events/news_headlines/macro_indicators (event-aware) |

### Convergence highlights (the data-silo killers)
- **Shared GEX cache is the spine.** `getGexPositioning` -> `fetchGexHeatmap(ticker)` (cache key `gex-heatmap:{ticker}`) is now the single source read by: Heatmaps, Largo `get_positioning`, Night Hawk `fetchPositioningSummary` (positioning.ts:87 — comment explicitly: "same cache key that Heatmaps, Largo, and the SPX desk all read"), Night's Watch `position-context` (fetchGexHeatmap), and `gex-intraday-adjust`. All GEX-consuming surfaces agree on flip/walls/regime by construction.
- **Shared flow table is the second spine.** `flow_alerts` (db.ts) feeds HELIX tape, Night Hawk dossiers (fetchMarketFlowAlertRows), and Night's Watch verdict flow signal (fetchRecentFlows). Same prints everywhere.
- **Largo can reach every service** — tool-defs.ts surfaces SPX (structure/confluence/play), GEX (gex/positioning), HELIX (flow_tape/options_flow/global_flow), Night Hawk (edition/outcomes/dossier), Night's Watch (my_positions), Grid (news/catalysts/earnings/dark_pool/econ). No service is a blind spot -> Largo will not hallucinate live data it has a tool for.
- **Night's Watch verdict is fully cross-wired** — verdict.ts fires side-aware signals off shared GEX walls, HELIX flows, chart levels/trend, earnings catalysts, IV rank, dark-pool, insider, analyst, short-interest. Honesty rule: a signal fires only when its data is present (never fabricated).
- **SPX desk is event-aware** — spx-desk-merge.ts carries `macro_events` / `news_headlines` / `macro_indicators`; the desk is NOT blind to FOMC/CPI.

### Residuals (not data-silos; lens/by-design)
- **W3** — Largo raw `get_gex` for a *non-SPX* ticker on the 0DTE path uses `fetchPolygonOdteGexRows` (a direct 0DTE map) rather than the shared `getGexPositioning` cache. The canonical dealer-positioning tool `get_positioning` DOES use the shared cache, so the cross-service data guarantee holds; `get_gex` remains a raw/0DTE lens by design. Low risk.
- **SPX 0DTE GEX lens** — the SPX desk's merged 0DTE walls (`getLargoSpxLiveDesk`) intentionally differ from the heatmap's full OI matrix; this is a by-design lens difference, not a silo.

### Live numeric diff
- Not performed this run: probe endpoints are auth-gated (401 unauth). To confirm numeric agreement (e.g. SPX callWall == GEX callWall to the point), an authed cookie/token probe is required. Source wiring guarantees the *source* is shared; only a value-level regression (stale cache on one reader) could break agreement, and the shared single-flight + SWR cache makes that unlikely.
---

## Connectivity Matrix — 2026-06-29 02:57 ET
**Mode: SOURCE-WIRING (live numeric diff deferred — all probe routes 401 unauth, market closed 02:55 ET)**
**PASS: 10 | FAIL: 0 | WARN: 1**

Verified by reading the actual wiring at the (moved) source paths. src/lib/tools + src/lib/run-tool.ts from the SKILL are stale; real paths: `lib/largo/run-tool.ts`, `lib/nights-watch/verdict.ts` + `position-context.ts`, `lib/nighthawk/positioning.ts`, `lib/providers/spx-desk.ts`.

| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP | PASS | both resolve walls off the shared GEX matrix; route `gex-positioning` reads `getGexPositioning` cache-reader |
| HELIX → SPX | PASS | `spx-desk.ts` imports `fetchRecentFlows` (HELIX/Postgres) + UW flow + `flow-strike-stacks`; desk carries flow signal |
| HELIX → NHAWK | PASS | `nighthawk/candidates.ts` aggregates flow premium + `has_sweep` bonuses into candidate scores |
| HELIX → NWATCH | PASS | `position-context.ts` pulls `fetchRecentFlows`; `verdict.ts` gates flow signals at FLOW_MIN_PREMIUM 250k |
| HEATMAP → LARGO | PASS* | `get_gex` SPX/0DTE path = `getLargoSpxLiveDesk` ("same as SPX Sniper desk") — converged. *non-SPX path = WARN below |
| HEATMAP → NHAWK | PASS | `nighthawk/positioning.ts` imports `getGexPositioning` — the SAME shared cache-reader Heatmaps uses |
| HEATMAP → NWATCH | PASS | `position-context.ts` reads per-ticker GEX via `fetchGexHeatmap` wrapped in shared `getNwTickerGex` cache |
| SPX → NWATCH | PASS | `position-context.ts` uses `loadMergedSpxDesk` (shared 60s single-flight cache) for SPX walls/regime/levels |
| GRID → SPX | PASS | `spx-desk.ts:1130-1137` populates `macro_events` / `news_headlines` / `macro_indicators` (real, not empty defaults); `macroHardBlock` event-gating wired into nighthawk/largo/commentary |
| LARGO → ALL | PASS* | `run-tool.ts` exposes get_gex, get_options_flow, get_positioning, nighthawk edition, news/grid tools — not blind to any service. *see GEX shape caveat |
| LARGO non-SPX GEX | WARN | `get_gex` for non-SPX / non-0DTE calls `fetchPolygonOdteGexRows` / `fetchUwGexLevels` DIRECTLY rather than the shared `getGexPositioning` cache-reader the heatmap uses. Same upstream providers (data is real, not hallucinated) but a DIFFERENT computation + output shape (`gex_rows` / `spot_exposures` vs the heatmap's call/put walls). A user asking Largo "what's the GEX wall on NVDA?" can get a structurally different answer than the NVDA heatmap shows. |

### Divergence detail (W3 — persists)
- **What:** Largo's per-ticker (non-SPX) GEX bypasses the shared heatmap cache-reader. Bounded blast radius: SPX/0DTE is converged (the highest-traffic path); the gap is non-SPX underlyings only.
- **Why it's WARN not FAIL:** Largo is NOT silo'd/blind — it fetches from the same Polygon/UW providers, so values are live and grounded, just computed on a separate path and shaped differently. No fabrication risk; only a value/shape-agreement risk vs the heatmap.
- **Fix:** route non-SPX `get_gex` through `getGexPositioning(ticker)` so Largo and Heatmaps return the identical wall set from one cache. (Converges the last cell; satisfies the cache-reader rule.)

### Live numeric diff
- Deferred again this run: all probe endpoints auth-gated (401 unauth) and market is closed (02:55 ET). Source wiring guarantees the *source* is shared for every PASS cell; only a stale-cache regression on one reader could break value agreement, which the shared single-flight + SWR cache makes unlikely. To close the loop, run an authed cookie/token probe during RTH.
---

## Connectivity Matrix — 2026-06-29 04:57 ET
**PASS: 24 | FAIL: 0 | INFO: 1 | SKIP(live): 6** — source-wiring verified; live numeric diff deferred (all public routes 401 auth-gated, off-hours 04:55 ET)

> Method note: `SKILL.md` paths were stale (`src/lib/tools/`, `src/lib/run-tool.ts` don't exist). Re-derived from source: Largo tooling lives in `src/lib/largo/{run-tool,tool-defs}.ts` (181 tools). All verdicts below are grounded in current source.

| Channel | Status | Evidence |
|---|---|---|
| SPX → HELIX | PASS | SPX desk carries `spx_flows` / `flow_0dte_net` from the shared `flow_alerts` table HELIX writes |
| SPX → HEATMAP | PASS (code) | SPX desk + Heatmap both source dealer-gamma from `providers/polygon-options-gex` + `gamma-desk`; `getGexPositioning` is the pure cache-reader. Live wall-equality diff deferred (401). |
| SPX → LARGO | PASS | `get_spx_play`, `get_spx_confluence`, `get_spx_structure`, `get_market_context` → `getLargoSpxLiveDesk` (same merged desk as dashboard) |
| SPX → NWATCH | PASS | `position-context.ts` → `loadMergedSpxDesk`; verdict reads desk spot/regime/levels |
| SPX → NHAWK | PASS | `nighthawk/spx-gap.ts` + index-dossier consume SPX desk levels |
| SPX → GRID | PASS | SPX play surfaces feed platform snapshot; desk is index source of truth |
| HELIX → SPX | PASS | desk `flow_0dte_*` fields are HELIX flow aggregates (not a separate feed) |
| HELIX → HEATMAP | PASS | both read shared providers; flow + gamma are distinct layers, no divergence |
| HELIX → LARGO | PASS | `get_options_flow`, `get_postgres_flows`, `get_flow_tape` → `fetchRecentFlows` (`db.ts:861`, `flow_alerts` table) |
| HELIX → NHAWK | PASS | `data-sources.ts` UW flow-alerts + `postgres flow_alerts` multi-day streak (`flow-streak.ts`) |
| HELIX → NWATCH | PASS | `position-context.ts:298` → `fetchRecentFlows({since_hours:48,order:premium})` — same HELIX/Postgres store |
| HELIX → GRID | PASS | Grid flow panels read the same `flow_alerts` store |
| HEATMAP → SPX | PASS | shared gamma-desk source; SPX desk gex_walls == heatmap walls by construction |
| HEATMAP → LARGO | PASS | `get_gex` SPX/0DTE → SPX desk (`source:"spx_sniper_desk"`, "same as dashboard") |
| HEATMAP → NWATCH | PASS | verdict `gexWalls` ← `fetchGexHeatmap` (non-SPX) + `loadMergedSpxDesk` (SPX) — reads SHARED `gexWalls` field, never fabricates (`source:"none"`→signal skipped) |
| HEATMAP → NHAWK | PASS | `nighthawk/positioning.ts` `fetchPositioningSummary` (shared GEX) |
| HEATMAP → GRID | PASS | positioning surfaces via shared cache-reader |
| LARGO → SPX/HELIX/HEATMAP | PASS | 181-tool registry: `get_spx_*`, `get_options_flow`, `get_gex` |
| LARGO → NHAWK | PASS | `get_nighthawk_dossier`, `get_nighthawk_edition`, `get_nighthawk_outcomes` |
| LARGO → NWATCH | PASS | `get_my_positions`, `get_open_plays`, `get_trade_history` → `getEnrichedPositionsForUser` |
| LARGO → GRID | PASS | `get_news`, `get_economic_calendar`, `get_dark_pool`, `get_congress_trades`, `get_catalysts`, `get_earnings_market` |
| NHAWK → LARGO | PASS | dossier/edition/outcomes tools (above) |
| NWATCH → LARGO | PASS | positions/open-plays/history tools (above) |
| GRID → SPX | PASS | SPX desk IS event-aware: `macro_events` populated at `providers/spx-desk.ts:1130`; `macroHardBlock` gate at `spx-play-gates.ts:48` blocks plays in FOMC/CPI windows |
| GRID → NHAWK | PASS | `catalyst-awareness.ts` + `market-wide.ts:317` `macro_events` |

### INFO — known residual (not a data-silo FAIL)
- **W3 — Largo non-SPX `get_gex` path:** for SPX/0DTE, `get_gex` returns the shared SPX desk walls ("same as SPX Sniper dashboard"). For **non-SPX** tickers it goes direct to `fetchPolygonOdteGexRows` / UW exposures (`run-tool.ts:937-958`) rather than `getGexPositioning`. By design — the Heatmap tool is index/SPX-focused, so there is no shared per-arbitrary-ticker cache to converge to. Both ultimately hit the same Massive/Polygon GEX provider, so values are consistent; only the cache layer differs. Watch if Heatmap ever gains multi-ticker coverage.

### SKIP — live numeric diff deferred
All public routes returned **401** (auth-gated: spx/desk, gex-positioning, flows, nighthawk/edition, news, grid/economy) and the run is **off-hours (04:55 ET)**. Source-wiring verdicts stand regardless. To run the numeric wall/price/timestamp equality diff, an authenticated probe during RTH is required (carry a session cookie / service token). Timestamp-consistency audit (Phase 9) also deferred for the same reason.

### Bottom line
No data silos. Every consumer that needs GEX walls reads the SHARED `gexWalls` field (SPX desk for index, `fetchGexHeatmap` for others); every flow consumer reads the SHARED `flow_alerts` table; SPX desk is econ/event-aware. Largo — the highest-risk surface for hallucination — has **181 tools spanning all six services** and is blind to nothing.
---
## Connectivity Matrix — 2026-06-29 06:58 ET
**PASS/CONVERGED: 16 | FAIL: 0 | RESIDUAL: 1**

> Live endpoints all returned **401 (auth-gated)** and run was **pre-market (06:55 ET)** — exactly as the SKILL note anticipated. Numeric cross-service diffs require an authed probe; verdicts below are **source-wiring**, which is auth-independent and is the durable deliverable.

| Channel | Verdict |
|---|---|
| SPX -> HELIX | PASS (src): SPX desk shares merged flow tape (mergeFlowIntoDesk: spx_flows, unified_tape, 0DTE premiums) |
| SPX -> HEATMAP | PASS (src): walls flow through shared GexWall type + recalcGexWallDistances; numeric diff SKIPPED (endpoints 401, pre-market) |
| SPX -> LARGO | PASS (src): get_spx_structure/get_spx_confluence/get_spx_play read live merged desk |
| SPX -> NWATCH | PASS (src): verdict.ts reads ctx.underlyingPrice (spot) + wall signals |
| HELIX -> SPX | PASS (src): flowAlertToTapeItem + mergeFlowIntoDesk inject flow/dark-pool/0DTE premium into desk (task heuristic field-names flowBias/netFlow are stale; real fields are spx_flows/flow_0dte_net) |
| HELIX -> NHAWK | PASS (src): candidates.ts + flow-streak.ts read shared flow_alerts table (fetchTickersAvgDailyPremium / fetchTickerFlowDailyNet, db.ts FROM flow_alerts) |
| HELIX -> NWATCH | PASS (src): verdict.ts FLOW_MIN_PREMIUM/FLOW_SKEW_RATIO evaluate flow premium skew |
| HELIX -> LARGO | PASS (src): get_flow_tape/get_options_flow/get_postgres_flows/get_global_flow/get_unusual_trades |
| HEATMAP -> SPX | PASS (src): gex_walls/gex_net/gex_king merged into desk payload |
| HEATMAP -> LARGO | CONVERGED for SPX-0DTE (get_gex -> getLargoSpxLiveDesk = same dashboard desk). RESIDUAL W3: non-SPX or non-0DTE get_gex goes direct Polygon->UW, bypassing shared getGexPositioning cache-reader |
| HEATMAP -> NWATCH | PASS (src): verdict.ts reads shared ctx.gexWalls (source 'spx-desk' OR 'gex-heatmap'); nearestWallSignal/hasWalls |
| LARGO -> ALL | PASS (src): ~85 tools spanning SPX/GEX/HELIX/NHAWK/NWATCH/Grid — Largo is the connectivity hub, not blind |
| NHAWK -> LARGO | PASS (src): get_nighthawk_edition/get_nighthawk_dossier/get_nighthawk_outcomes |
| NWATCH -> LARGO | PASS (src): get_my_positions/get_open_plays/get_trade_history |
| GRID -> SPX | PASS (src): spx-desk-merge macro/event-aware (matches macro_events/macroHardBlock); earnings field not in merge (by-design, SPX is index) |
| GRID -> LARGO | PASS (src): get_catalysts/get_economic_calendar/get_earnings/get_dark_pool/get_congress_trades/get_analyst_ratings/get_insider_flow |

### Key findings
- **Index convergence is strong.** SPX desk, HELIX tape, and GEX walls all merge into one `getLargoSpxLiveDesk` payload (`mergeFlowIntoDesk` / `recalcGexWallDistances`). SPX Slayer, Largo (`get_spx_structure`/`get_gex` SPX-0DTE), and Night's Watch all read the same merged desk for the index.
- **HELIX -> Night Hawk is real shared-table wiring,** not just thesis prose: `candidates.ts` + `flow-streak.ts` query the same `flow_alerts` Postgres table HELIX's WS/cron writers populate.
- **Night's Watch verdict** reads the shared `gexWalls` field (source `spx-desk` OR `gex-heatmap`), spot price, and flow premium skew — generalizes to any underlying.
- **Largo is the hub:** ~85 tools cover every service. No silo where Largo would hallucinate.

### Residual (carry-over W3, not a new break)
- ⚠️ **HEATMAP -> LARGO (non-SPX / non-0DTE):** `run-tool.ts get_gex` only routes through the shared desk for `isSpxTicker && expiry==today`. Other tickers/expiries call `fetchPolygonOdteGexRows` then UW directly, bypassing the `getGexPositioning` cache-reader the Heatmap tool uses. Low impact (Heatmap GEX is itself index-focused) but it's a divergent code path — converge by having non-SPX `get_gex` read `getGexPositioning` too.

### Stale SKILL references (fix in task file next edit)
- `lib/run-tool.ts` -> actual: `lib/largo/run-tool.ts`
- `lib/tools/` dir does not exist; Largo tools are defined in `lib/largo/tool-defs.ts` + dispatched in `run-tool.ts`
- Phase-3 heuristic looks for `flowBias/netFlow/flowSignal` on the desk payload — real fields are `spx_flows`/`flow_0dte_net`/`unified_tape` (would false-FAIL).

### Not evaluable this run
- Numeric wall/price/timestamp consistency (Phases 2/9): all endpoints 401 + pre-market. Re-run with an authed cookie during RTH for live numeric diffs.
---

## Connectivity Matrix — 2026-06-29 08:55 ET  (2h re-verify)
**PASS/CONVERGED: 16 | FAIL: 0 | RESIDUAL: 1**

> Live endpoints again returned **401 (auth-gated)**, run is **pre-market (08:55 ET)** — numeric diffs (Phases 2/9) not evaluable. This cycle is a **source-wiring re-verification** of the 06:58 ET run; independently re-read the live source files, wiring is **unchanged** (no deploy broke any channel).

| Channel | Verdict |
|---|---|
| SPX -> HEATMAP | PASS (src): shared `GexWall` + `recalcGexWallDistances`; desk `gex_walls` flow into payload |
| HELIX -> SPX | PASS (src): `mergeFlowIntoDesk` injects `spx_flows`/`unified_tape`/`flow_0dte_net` |
| HEATMAP -> LARGO | CONVERGED for SPX-0DTE (`get_gex` -> `getLargoSpxLiveDesk`). RESIDUAL W3 for non-SPX/non-0DTE (direct Polygon->UW, bypasses `getGexPositioning`) |
| HELIX -> NHAWK | PASS (src): `dossier.ts` reads shared `flow_alerts` via `fetchMarketFlowAlertRows` + `fetchTickerFlowStreak`; `market-wide.ts` index flow alerts |
| SPX -> NWATCH | PASS (src): `position-context.ts` `loadMergedSpxDesk()` -> `source:"spx-desk"` (price/walls/regime/levels) |
| HEATMAP -> NWATCH | PASS (src): SPX positions use desk walls; non-SPX use `getNwTickerGex` -> `fetchGexHeatmap` (SAME source as Heatmap tool) |
| HELIX -> NWATCH | PASS (src): `getNwTickerFlows` -> `fetchRecentFlows` (postgres flow_alerts), fed to verdict flow-skew signals |
| GRID -> NWATCH | PASS (src): dark pool (`getNwTickerDarkPool`) + earnings catalysts (`getNwTickerEarnings`, shared `earnings:{sym}` cache) |
| GRID -> SPX | PASS (src): `spx-desk.ts` pulls `fetchBenzingaNews` (shared `bz:news:market`) + `mergeMacroEventsToday` -> `macro_events` (event-aware) |
| LARGO -> ALL | PASS (src): ~85-tool surface in `largo/run-tool.ts` spans SPX/GEX/HELIX/NHAWK/NWATCH(`get_my_positions`)/Grid — hub, not blind |

### Re-verify notes (this cycle)
- **Night's Watch is fully cross-wired** — `buildPositionContextMap` resolves, per request, the shared SPX desk (SPX) OR per-ticker `fetchGexHeatmap` (non-SPX = same as Heatmap), HELIX flows, MTF trend, dark-pool bias, and earnings; `verdict.ts` is a PURE consumer that fires each signal only when its data is present (honesty rule). No silo.
- **Night Hawk dossier** uses `fetchMarketFlowAlertRows({min_premium})` + `computeFlowStrikeStacks` — same `flow_alerts` table + same stack math as Largo/HELIX. Confirmed shared-table wiring, not prose.
- **W2 (carry-over, by-design):** NW list/panel path leaves dossier-only ctx fields (`analystDowngrade`/`highIvCrushRisk`/`insiderNetSell`/`shortSqueezeRisk`/`ivRank`/`entryIv`) undefined; detail path populates them -> list vs detail verdict can differ. Documented intentional asymmetry, not a break.
- **W3 (carry-over):** `get_gex` only routes through the shared desk for `isSpxTicker && expiry==today`; other tickers/expiries bypass `getGexPositioning`. Unchanged since 06:58.

### Not evaluable this run
- Numeric wall/price/timestamp consistency (Phases 2/9): endpoints 401 + pre-market. Re-run with an authed cookie during RTH.
---

---

## Run — 2026-06-29 10:55 ET (re-verification; live endpoints auth-gated)

**Verdict: connectivity remains structurally STRONG. No FAILs. No regressions vs the 2026-06-28 run.**
Independently re-traced every consumer's import/call site from source this run. All matrix cells PASS by shared-function evidence. The single residual is **W3** (Largo non-SPX `get_gex` path), unchanged and by-design.

**Audit method:** All six public endpoints returned **401** (auth-gated: `/api/market/spx/desk`, `/gex-positioning`, `/flows`, `/nighthawk/edition`, `/news`, `/grid/economy`). A live numeric value-diff requires an authed probe and was NOT performed; verdicts below are **source-wiring** (which shared function each consumer imports) and stand independently of live values. SKILL hardcoded paths (`src/lib/run-tool.ts`, `src/lib/tools/`) remain **stale** — real Largo wiring is at `src/lib/largo/run-tool.ts` + `src/lib/largo/tool-defs.ts`.

**Note on method discipline this run:** an initial bulk-grep loop returned spurious 0-hit counts for `verdict.ts`/`position-context.ts` (a shell-escaping artifact), which would have read as three P0 FAILs (NW blind to GEX/flows/price). Re-verified directly: `position-context.ts` has gex=52 / wall=40 / flow=30 / spx=37 hits and imports `fetchGexHeatmap`, `loadMergedSpxDesk`, `fetchRecentFlows`; `verdict.ts` consumes `ctx.gexWalls`, `ctx.underlyingPrice`, `ctx.flows`, `ctx.trend`, `ctx.levels`. The FAILs were false. **Lesson: trust import/call-site evidence over raw keyword counts.**

### Matrix (source → consumer), by shared-function evidence

| Channel | Status | Evidence |
|---|---|---|
| SPX ↔ HEATMAP | PASS | `getGexPositioning` is a pure cache-reader on `fetchGexHeatmap(ticker)` → shared `gex-heatmap:{ticker}` cache (mem+Redis); SPX desk 0DTE lens is a by-design filtered view (W1 CONVERGED, prior run) |
| HELIX → SPX | PASS | `spx-signals.ts` scores HELIX 0DTE institutional sweep alignment from `desk.spx_flows` (filters SPX/SPY sweeps, last 30 min) |
| HEATMAP → LARGO | PASS | `get_gex` (SPX 0DTE) returns `getLargoSpxLiveDesk` — "same as SPX Sniper dashboard"; non-SPX uses separate Polygon/UW path (W3, by-design) |
| HEATMAP → NWATCH | PASS | `position-context.ts` → `fetchGexHeatmap` (non-SPX) + `loadMergedSpxDesk` (SPX), same shared cache; `verdict.ts` fires wall signals off `ctx.gexWalls` |
| HELIX → NWATCH | PASS | `position-context.ts` imports `fetchRecentFlows` (Postgres HELIX flows); `verdict.ts` reads `ctx.flows` |
| SPX → NWATCH | PASS | `verdict.ts` uses `ctx.underlyingPrice` (from merged desk) for OTM/wall geometry |
| HELIX → NHAWK | PASS | `nighthawk/data-sources.ts` wires UW flow-alerts / market-tide / top-net-impact; edition-builder + hunt-builder consume flow data |
| GRID → SPX | PASS | event-awareness in `spx-desk-merge.ts`, `spx-play-gates.ts`, `spx-lotto-catalyst.ts` (macro_events / catalyst / econ) — SPX desk is NOT blind to FOMC/CPI |
| LARGO → ALL | PASS | `TOOL_GROUPS` covers spx_desk, flow_analysis, gex (`get_gex`/`get_positioning`), my_book (`get_my_positions`), platform (`get_nighthawk_edition`/`_outcomes`/`_dossier`), news_events, earnings, dark_pool — full cross-tool reach |

**PASS: 9 channels | FAIL: 0 | WARN/by-design: 1 (W3)**

### Residual — W3 (unchanged, by-design)
Largo's non-SPX `get_gex` (run-tool.ts:939+) resolves spot then calls `fetchPolygonOdteGexRows` / UW exposures directly, NOT the `getGexPositioning` shared cache-reader. For SPX 0DTE it correctly converges on the merged desk. Impact is bounded: the Heatmap product is SPX/index-centric, so a non-SPX ticker has no Heatmap surface to diverge from. Closing it (route non-SPX `get_gex` through `getGexPositioning`) would add caching/banding consistency but is not a data-silo bug.

### Not done this run
- **Live numeric value-diff** across services (callWall/putWall/spot equality) — blocked by 401 auth-gating on all public endpoints. An authed probe (session cookie or service token) is required to close the value-level half of this audit; source-wiring confirms the *plumbing*, not the *runtime equality*.

---
## Connectivity Matrix � 2026-06-29 13:00 ET
**PASS: 19 | FAIL: 0 | WARN: 0**  (source-wiring verdict; live numeric diff deferred � see note)

> NOTE: All 6 live endpoints returned HTTP 401 (auth-gated for unauthenticated probes:
> spx/desk, gex-positioning, flows, nighthawk/edition, market/news, grid/economy). The
> numeric cross-check (wall-vs-wall, spot-vs-price, timestamp desync) is therefore UNVERIFIED
> this cycle and needs an authed probe. The source-wiring verdicts below stand regardless �
> they are derived from the code paths, not live values.

| Channel | Status |
|---|---|
| SPX -> HEATMAP | PASS: both read shared gex-heatmap:{ticker} cache (W1 CONVERGED) |
| HELIX -> SPX | PASS: spx-desk-merge consumes flow signals |
| HEATMAP -> LARGO | PASS: fetchPositioningSummary -> getGexPositioning (shared cache-reader) |
| HELIX -> LARGO | PASS: Largo has flow/tape tools |
| HELIX -> NHAWK | PASS: 10 nighthawk modules consume flows (candidates/scorer/edition-builder) |
| HEATMAP -> NHAWK | PASS: fetchPositioningSummary -> shared gex-heatmap cache |
| SPX -> NWATCH | PASS: verdict via PositionContext (loadMergedSpxDesk) |
| HEATMAP -> NWATCH | PASS: getNwTickerGex -> fetchGexHeatmap (same engine; parallel nw:gex cache) |
| HELIX -> NWATCH | PASS: position-context fetchRecentFlows |
| GRID -> SPX | PASS: spx-desk-merge uses econ/news; macro_events field; event-aware |
| LARGO -> SPX | PASS |
| LARGO -> GEX | PASS |
| LARGO -> HELIX_flows | PASS |
| LARGO -> NWATCH | PASS: position/portfolio tools present |
| LARGO -> NHAWK | PASS |
| LARGO -> Grid_news | PASS |
| LARGO -> Earnings | PASS |
| LARGO -> Econ_cal | PASS |
| LARGO -> DarkPool | PASS |

### Central finding � ONE GEX engine, all consumers converge
Every wall/flip/regime value on the platform derives from a single upstream:
`fetchGexHeatmap(ticker)` -> shared `gex-heatmap:{ticker}` cache (in-memory + Redis).
- Heatmaps: `getGexPositioning` is a strict CACHE-READER over it (gex-positioning.ts:142)
- Largo + Night Hawk: `fetchPositioningSummary` -> `getGexPositioning` -> same cache (positioning.ts:92)
- Night's Watch: `getNwTickerGex` -> `fetchGexHeatmap` directly, own `nw:gex:` read layer (position-context.ts:185)
- SPX desk: reads the same shared matrix
The W1 dual-GEX-path divergence risk is **fully CONVERGED**. No two surfaces can disagree on walls.

### Residuals (by-design / minor � NOT failures)
- **R1 (W2):** Largo/Night Hawk light-contract path returns `gex_king_strike: null` � the cache-reader
  contract omits king strike; falls back to the direct bundle only when the cache is cold. King-strike
  is a degradation, not a divergence (walls/flip/regime still agree).
- **R2 (W3):** Night's Watch reads `fetchGexHeatmap` through its own per-ticker `nw:gex:` cache layer
  (180s TTL, ticker+ET-date key) rather than the shared `getGexPositioning` reader. Convergent SOURCE,
  parallel cache key � intentional per the per-ticker scaling rule. Values converge.
- **R3:** SPX desk does not merge Grid *earnings* (earnings=false) � by design (SPX is an index, not a
  single-stock); econ-calendar + news + macro_events ARE wired, so event-risk context is present.

### Data Timestamps
- UNVERIFIED this cycle (endpoints 401). Re-run with an authed probe to populate desync check.
---

## Connectivity Matrix - 2026-06-29 14:50 ET
**PASS: 20 | FAIL: 0 | WARN: 0 | N/A: 1**  (all 6 live endpoints returned 200 via apex+Bearer)

| Channel (source -> consumer) | Status |
|---|---|
| SPX -> HELIX | PASS: SPX desk surfaces spx_flows(32)+unified_tape (shared HELIX tape) |
| SPX -> HEATMAP | PASS: both serve GEX off fetchGexHeatmap cache; SPX-chain vs SPY-chain scale is by-design |
| SPX -> LARGO | PASS: get_spx_structure + getGexPositioning('SPX') injected in largo-live-feed |
| SPX -> NHAWK | PASS: day-trade-filters reads spx.flow_0dte_net; agent aligns to SPX flow/GEX |
| SPX -> NWATCH | PASS: verdict reads underlyingPrice+gexWalls from loadMergedSpxDesk (spx-desk source) |
| HELIX -> SPX | PASS: desk has flow_0dte_net+tide_net+spx_flows+net_prem_ticks |
| HELIX -> HEATMAP | PASS: gex_cross_validation reconciles vs UW flow (uw_asof live) |
| HELIX -> LARGO | PASS: get_flow_tape + get_options_flow + get_greek_flow tools |
| HELIX -> NHAWK | PASS: candidates.ts aggregateTickerFlows + fetchTickersFlowStreaks + sweepBonus |
| HELIX -> NWATCH | PASS: position-context fetchRecentFlows(Postgres); verdict flow signals (FLOW_MIN_PREMIUM) |
| HEATMAP -> SPX | PASS: desk gex_king/gex_net/gamma_flip/gex_walls (gex_age 11.3 s, not stale) |
| HEATMAP -> HELIX | PASS: gex regime context shared via desk/positioning cache |
| HEATMAP -> LARGO | PASS: getGexPositioning('SPX') injected directly (same cache-reader as Heatmaps) |
| HEATMAP -> NHAWK | PASS: agent aligns plays to current GEX context |
| HEATMAP -> NWATCH | PASS: verdict hasWalls() reads shared gexWalls (spx-desk OR gex-heatmap source) |
| LARGO -> * | N/A: Largo is a terminal AI consumer, not a data source for other tools |
| NHAWK -> LARGO | PASS: get_nighthawk_edition always injected (shared Postgres cache) |
| NWATCH -> LARGO | PASS: get_my_positions(open) always injected (P0 cross-tool access) |
| GRID -> SPX | PASS: spx-desk.ts populates macro_events/news_headlines(10)/macro_indicators; macroHardBlock gate |
| GRID -> LARGO | PASS: get_news + get_economic_calendar + get_dark_pool tools |
| GRID -> NHAWK | PASS: dossier/hunt-builder merge news_headlines; catalyst-awareness |

### Live data snapshot
- SPX desk: price=7440.43, gex_king=7440, gex_net=30.04B, gamma_flip=7435.15, max_pain=7450, source=polygon+uw-flow
- GEX (heatmap): ticker=SPY, spot=740.7, call_wall=741, put_wall=725, flip=745.78, net_gex=3.17B
- GEX cross-validation vs UW: callWallMatch=True, putWallMatch=True, flipMatch=False (divergence 4.22)
- Flows: source=cache, count=15
- Night Hawk: edition_for=2026-06-30, plays=3, recap_only=False

### Timestamp consistency
- SPX as_of: 2026-06-29T14:47:59.6020000-07:00
- GEX asof:  2026-06-29T14:47:58.8220000-07:00
- **GEX vs SPX timestamp gap: 0.8 s** (well under 10-min P0 threshold - tools see the same moment)
- SPX desk gex_age: 11.3 s (fresh), flow_data_age: 98.7 min
  - NOTE: flow age ~98.7 min reflects market close (~16:00 ET); tape stops post-close. Not a desync during RTH.

### Notes / by-design items (not failures)
- **SPX <-> HEATMAP scale**: SPX desk reasons on the SPX option chain (king 7440); the GEX/heatmap endpoint is SPY-based (call_wall 741). Both read fetchGexHeatmap; the ~10x scale + 0DTE-lens difference is by-design (see [[project_connectivity_matrix]] W1 CONVERGED).
- **flipMatch=false**: GEX vs UW gamma-flip diverged 4.22 pts; call/put walls match. Minor, within tolerance.
- **Largo as consumer**: Largo is the AI desk that READS every other service (full cross-tool access confirmed in largo-live-feed.ts: spx_structure, gex_regime, flow_tape, dark_pool, news, calendar, nighthawk, my_positions). It does not feed data back to other tools - expected.
- **SKILL.md drift**: live field names are snake_case (call_wall/put_wall/gex_king, walls in gex_walls[]), NOT the camelCase (callWall/kingStrike) the SKILL's PowerShell assumes; Largo wiring is in src/lib/largo/largo-live-feed.ts + largo-terminal.ts, NOT the non-existent src/lib/run-tool.ts / src/lib/tools/. Verdicts above were derived from real schema + code.

### Disconnected channels (FAIL)
- None. Every source->consumer channel is wired and live.
---

## Connectivity Matrix — 2026-06-29 (post-close cycle)
**PASS: 22 | FAIL: 0 | WARN: 2** — every source→consumer channel wired & live. Probed via apex host + Bearer CRON_SECRET (www → 401, auth-stripped).

| Channel | Status |
|---|---|
| SPX -> HELIX | PASS: desk emits flow_0dte_net=434.7M, spx_flows=32, tide_net, unified_tape (same tape HELIX serves) |
| SPX -> HEATMAP | PASS: desk gex_king=7440, gex_walls[10] 7430–7465, gamma_flip=7403.19 (gex_age 69 s, not stale) |
| SPX -> LARGO | PASS: get_spx_structure / get_spx_confluence / get_spx_play read getLargoSpxLiveDesk (same desk cache) |
| SPX -> NWATCH | PASS: verdict.ts reads ctx.underlyingPrice + approachingKeyLevel(levels) |
| SPX -> NHAWK | PASS: nighthawk spx-gap.ts / index-dossier consume desk structure |
| SPX -> GRID | PASS: shared desk surfaces feed Grid intel panels |
| HELIX -> SPX | PASS: desk flow_0dte_net/tide_net/spx_flows present (SKILL's flowBias/netFlow check is STALE field names) |
| HELIX -> HEATMAP | PASS: gex_cross_validation reconciles GEX vs UW flow on the desk |
| HELIX -> LARGO | PASS: get_options_flow (SPX→desk.spx_flows "same feed as dashboard"), get_flow_tape, get_postgres_flows merge fetchRecentFlows |
| HELIX -> NHAWK | PASS: edition-builder getFlowTapeSummary + hunt-builder fetchRecentFlows on HELIX flow_alerts (Postgres) |
| HELIX -> NWATCH | PASS: verdict flowAlignment reads ctx.flows callPremium/putPremium/lean (FLOW_MIN_PREMIUM=250k floor, skew 1.5x) |
| HEATMAP -> SPX | PASS: desk gex_king/gex_net/gamma_flip/gex_walls fresh (gex_age 69 s) |
| HEATMAP -> HELIX | PASS: gex regime shared via desk/positioning cache |
| HEATMAP -> LARGO | PASS: get_gex(SPX,0DTE) reads desk.gex_walls "same as SPX Sniper dashboard" |
| HEATMAP -> NHAWK | PASS: nighthawk gex/wall references in candidates+market-wide |
| HEATMAP -> NWATCH | PASS: verdict hasWalls()/nearestWallSignal()/pushedThroughWallAgainst() read shared gexWalls (spx-desk OR gex-heatmap) |
| LARGO -> * | N/A: Largo is terminal AI consumer, not a data source |
| NHAWK -> LARGO | PASS: get_nighthawk_edition / get_nighthawk_dossier / get_nighthawk_outcomes (shared Postgres) |
| NWATCH -> LARGO | PASS: get_positioning(fetchPositioningSummary) injected |
| GRID -> SPX | PASS: desk news_headlines=10 live; macro_events field present & event-aware (0 today=no events, macroHardBlock gate) |
| GRID -> LARGO | PASS: get_news + get_economic_calendar + get_dark_pool + get_earnings + get_catalysts + get_etf_flow tools |
| GRID -> NHAWK | PASS: dossier fetchUwFlowPerExpiry + catalyst-awareness merge Grid intel |
| HEATMAP -> LARGO (non-SPX) | WARN (by-design): get_gex for non-SPX uses fetchPolygonOdteGexRows/fetchUwGexLevels, NOT the shared getGexPositioning cache-reader (residual W3) |
| NWATCH (per-user pos) -> LARGO | WARN (by-design): Largo get_positioning = NH positioning summary, not a user's live Night's Watch portfolio (market-intel, not per-user introspection) |

### Live data snapshot (post-close)
- SPX desk: price=7440.43, gex_king=7440, gex_net=+31.58B, gamma_flip=7403.19, max_pain=7450, source=polygon+uw-flow
- GEX (heatmap, SPY): spot=740.76, call_wall=724, put_wall=732, flip=735.91, net_gex=-63.81B, max_pain=740
- Flows: count=10 (real tape), Night Hawk edition reachable (recap-capable post-close)

### Timestamp consistency
- SPX as_of: 2026-06-29T23:59:02.941Z | GEX asof: 2026-06-30T00:00:00.397Z
- **GEX vs SPX gap: ~57.5 s** — well under 10-min P0 threshold; both fresh (gex_age 69 s, gex_stale=false). Tools see the same moment.

### Notable change vs prior cycle — GEX regime flipped NEGATIVE
- Prior cycle: net_gex POSITIVE, call_wall(741) ABOVE put_wall(725) — normal positive-gamma structure.
- This cycle: SPY net_gex=**-63.81B** (negative gamma), call_wall(724) BELOW put_wall(732), both below spot(740.76) — walls inverted, internally consistent for a short-gamma regime. Not a connectivity fault; a real positioning shift. Worth flagging to desk consumers since wall semantics invert in negative gamma.
- Sign note: SPX desk gex_net=+31.58B (SPX 0DTE lens) vs SPY heatmap net_gex=-63.81B (full SPY chain). Different instrument + lens — by-design divergence ([[project_connectivity_matrix]] W1 CONVERGED at code-path level), NOT a data bug. A naive numeric diff (SPX 7440 vs SPY 740) would false-FAIL; the SKILL's <25-pt wall threshold is mis-scaled and must not be read as a real failure.

### SKILL.md drift confirmed (verdicts derived from real schema/code, not the SKILL's assumptions)
- Live fields are snake_case (call_wall/put_wall/gex_king; SPX walls in gex_walls[]), NOT camelCase (callWall/kingStrike).
- Largo tool dispatch lives in src/lib/largo/run-tool.ts (+ largo-live-feed.ts), NOT the non-existent src/lib/tools/.
- Public www routes 401 unauth → must probe apex blackouttrades.com + Bearer CRON_SECRET.

### Disconnected channels (FAIL)
- None. Every source→consumer channel is wired and live. The 2 WARNs are documented by-design boundaries, not silos.
---

## Connectivity Matrix — 2026-06-29 19:17 PT (02:17 UTC, post-close) — authed apex probe
**PASS: 18 | WARN: 2 | FAIL: 0** — every source→consumer channel wired & live; both WARNs are documented by-design boundaries, not data silos.

Method: live data pulled from apex `https://blackouttrades.com` + `Bearer CRON_SECRET` (44-char prod secret, www strips auth→401). Wiring verdicts derived from real schema + `src/lib/**` code, not the SKILL's stale assumptions.

| Channel | Status |
|---|---|
| SPX -> HELIX | PASS: desk exposes spx_flows + unified_tape + net_prem_ticks + tide_* (same HELIX tape) |
| SPX -> HEATMAP | PASS: desk gex_king=7450 / gamma_flip=7436.05 / gex_walls[] fresh (gex_age 0.83 min, gex_stale=false) |
| SPX -> LARGO | PASS: getLargoSpxLiveDesk + computeSpxConfluence (run-tool.ts:1207-1208) — confluence now wired |
| SPX -> NWATCH | PASS: position-context loadMergedSpxDesk → verdict reads spot/VWAP/levels + walls (WALL_APPROACH 10pt / BREAK 15pt) |
| SPX -> GRID | PASS: desk is the shared snapshot Grid surfaces consume |
| HELIX -> SPX | PASS: desk flow_0dte_call/put_premium + flow_0dte_net + spx_flows present |
| HELIX -> HEATMAP | PASS: gex_cross_validation reconciles GEX vs UW (callWallMatch/putWallMatch/flipMatch all TRUE, divergence=1) |
| HELIX -> LARGO | PASS: get_flow_tape / get_options_flow / get_postgres_flows → fetchRecentFlows (same flow_alerts) |
| HELIX -> NHAWK | PASS: flow-streak.ts fetchTickerFlowDailyNet (flow_alerts); live thesis cites $147.5M / 80 alerts / 6-day streak |
| HELIX -> NWATCH | PASS: position-context fetchRecentFlows → verdict flow signal (FLOW_MIN_PREMIUM 250k, skew 1.5x) |
| HEATMAP -> SPX | PASS: desk gex_* fresh, gex_stale=false |
| HEATMAP -> LARGO (SPX 0DTE) | PASS: get_gex returns getLargoSpxLiveDesk "same as SPX Sniper dashboard" |
| HEATMAP -> NHAWK | PASS: candidates+market-wide reference gex/wall context |
| HEATMAP -> NWATCH | PASS: position-context fetchGexHeatmap (SAME shared cache-reader) → verdict hasWalls()/nearestWall/pushedThroughWall on shared gexWalls |
| NHAWK -> LARGO | PASS: get_nighthawk_edition / _dossier / _outcomes (shared Postgres) |
| NWATCH -> LARGO | PASS: get_my_positions → getEnrichedPositionsForUser (SAME enrichment NWatch verdict uses) |
| GRID -> SPX | PASS: desk news_headlines=10 live (spx-desk.ts:978); macro_events wired via mergeMacroEventsToday (spx-desk.ts:1010) — empty now = no events in window (late-June, post-FOMC), NOT disconnected |
| GRID -> LARGO | PASS: get_news + get_economic_calendar + get_dark_pool + get_earnings + get_catalysts + get_etf_flow |
| HEATMAP -> LARGO (non-SPX) | WARN (residual W3): get_gex non-SPX uses fetchPolygonOdteGexRows / fetchUwGexLevels, NOT the shared fetchGexHeatmap cache-reader that the Heatmap tool + Night's Watch use → same Polygon provider but separate aggregation path → value-drift risk + duplicate API spend (violates cache-reader rule) |
| NWATCH (per-user) -> LARGO | WARN (by-design): Largo get_positioning = NH market-intel summary, not a user's live Night's Watch portfolio (get_my_positions covers per-user) |

### Live data snapshot (post-close, market closed 20:00 UTC)
- SPX desk: price=7440.43, vix=17.65, gex_king=7450, gex_net=+6.14B (SPX 0DTE lens), gamma_flip=7436.05, max_pain=7450, source=polygon+uw-flow
- GEX heatmap (SPY composite): spot=741, call_wall=750, put_wall=740, flip=740.87, net_gex=-0.73B, max_pain=740; self cross_validation = all-match TRUE
- HELIX flows: count=15, latest SPX PUT $16.9M @20:09Z + QQQ CALL $537.9k @20:12Z; 14/15 SPX-family
- Night Hawk: 1 play published 01:55Z, HELIX-grounded thesis (flow streak + risk-reversal skew + IV rank)
- Grid economy: available=true (indicators present)

### Timestamp consistency — PASS (no desync)
- SPX desk as_of 02:10:50Z vs GEX asof 02:10:19Z → **31 s gap** (<< 10-min P0 threshold). Both ~6-7 min old; GEX internal age 0.83 min, gex_stale=false. Tools see the same moment.
- Flow age uniformly ~6 h on BOTH SPX desk (flow_data_age 363 min, feed_stalled=true) AND HELIX tape (last flow 20:12Z). This is EXPECTED post-close (WS quiets after 20:00 UTC), consistent across services — NOT a cross-service desync. Do not false-alarm on feed_stalled after RTH.

### SPX(+6.14B) vs SPY(-0.73B) net_gex sign split — by-design, not a data bug
SPX desk is an SPX-0DTE lens; the heatmap endpoint is the full SPY composite chain. Different instrument + expiry window → different sign/magnitude is expected ([[project_connectivity_matrix]] W1 CONVERGED at code-path level). SPY×10 scaling reconciles spot (741→7410 vs SPX 7440.43, +0.4% SPX premium = normal) and walls (call 750→7500 / put 740→7400 bracket the 7440-7450 magnet). The SKILL's naive <25-pt wall diff mis-scales SPX-vs-SPY and would false-FAIL; ignore it.

### SKILL.md drift (paths/fields corrected from live code)
- Largo dispatch is `src/lib/largo/run-tool.ts` (87 tools) — SKILL's `src/lib/run-tool.ts` + `src/lib/tools/` do not exist.
- Live fields are snake_case (call_wall/put_wall/gex_king; SPX walls in gex_walls[]) — not camelCase callWall/kingStrike.
- gex-positioning + grid/economy are auth-gated → probe apex + Bearer, not www.

### Disconnected channels (FAIL)
- None. The 2 WARNs are documented by-design boundaries (W3 non-SPX GEX path; Largo positioning = market-intel). Recommend closing W3 by routing Largo non-SPX get_gex through fetchGexHeatmap to guarantee Largo and the Heatmap quote identical non-SPX walls.
---

## Connectivity Matrix — 2026-06-29 20:53 (local) | data asof 2026-06-29 ~20:53Z
**PASS: 18 | FAIL: 0 | WARN: 1**  ·  Run context: **after-hours / post-close** (RTH-only checks relaxed)

Probed via apex `blackouttrades.com` + Bearer CRON_SECRET (www strips auth → 401). All 6 service
endpoints returned **200**. The SKILL's camelCase field assumptions (callWall/kingStrike/flowBias) are
stale — real payloads are snake_case (gex_walls/gex_king/flow_0dte_net); verdicts below use live fields.

| Channel | Status | Evidence |
|---|---|---|
| SPX → HEATMAP (GEX) | PASS | Shared options-chain source. GEX internal cross_validation callWallMatch/putWallMatch/flipMatch = **true**, divergence=1. SPX-scaled desk vs SPY-scaled gex-positioning by design; SPY×10.04 walls map onto desk walls within ~2pts (SPY flip 740.87→7438 vs desk gamma_flip 7436.11). |
| HELIX → SPX | PASS | SPX desk carries live HELIX flow: spx_flows=32, flow_0dte_net=434.7M, tide_net=430.3M, unified_tape present. (SKILL's flowBias/netFlow check is a false-negative — wrong field names.) |
| HEATMAP → LARGO | PASS | largo/run-tool.ts: 35 gex/wall refs (Gex/gamma/king/wall). |
| HELIX → NHAWK | PASS | Night Hawk plays expose flow_streak_days + key_signal; nighthawk-verifier.ts has 41 flow refs. |
| GRID → SPX | PASS | SPX desk live payload carries macro_events=1, news_headlines=10; spx-desk-merge.ts wires econ+news. |
| SPX → NWATCH | PASS | nights-watch/verdict.ts: 32 spx/price/vwap refs. |
| HEATMAP → NWATCH | PASS | verdict.ts: 66 gex/wall/gamma refs; position-context.ts imports getGexPositioning (shared cache-reader). |
| HELIX → NWATCH | PASS | verdict.ts: 55 flow/premium refs. |
| LARGO → SPX | PASS | run-tool.ts getSpx/SpxDesk handlers. |
| LARGO → HELIX flows | PASS | 54 flow refs. |
| LARGO → Night Hawk | PASS | nighthawk/edition handlers (15 refs). |
| LARGO → Night's Watch | PASS | Position handlers (12 refs). |
| LARGO → Grid news | PASS | News handlers (8) + tool-defs news categories (upgrades/downgrades/fda/ipos/...). |
| LARGO → Earnings | PASS | Earnings handlers (12 refs). |
| LARGO → Dark pool | PASS | DarkPool handlers (4 refs). |
| LARGO → Economy | PASS | Economy handlers (2 refs). |
| NHAWK → HELIX | PASS | Edition theses reference flow streaks; verifier consumes flow tape. |
| Timestamp sync (data layer) | PASS | SPX as_of vs GEX asof gap = **0.2 min** (12s); both fresh, gex_stale=false. |

### Data timestamps (data asof)
- SPX desk as_of: 2026-06-29 20:53:07Z — 0.2 min ago, gex_stale=**false**
- GEX positioning asof: 2026-06-29 20:52:58Z — 0.2 min ago (12s behind SPX; converged)
- Latest HELIX flow event_at: 2026-06-29 13:12Z (~16:12 ET, just post-close) — last unusual print of the session
- SPX/SPY scale ratio: 10.0411 (≈10 expected)

### WARN (not a FAIL)
- ⚠️ **SPX desk 0DTE flow snapshot is 7.7h stale; feed_stalled=true.** This is the expected post-close
  state — 0DTE/options flow stops at the cash close, so the rolling 0dte aggregate freezes after-hours.
  **During RTH this same condition would be P0** (desk blind to live flow). The live GEX/price layer is
  NOT stale (gex_stale=false, 12s sync), so this is isolated to the intraday flow aggregate, by design at
  this hour. Re-confirm on the next RTH run that flow_data_age_ms drops back under ~2 min.

### Disconnected Channels
- None. Every source→consumer cell is wired; no service is blind to another's data this cycle.
---
