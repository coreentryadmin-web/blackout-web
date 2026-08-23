# SPX SLAYER — THE MAP

**Phase 0 deliverable of the SPX Slayer owner lane (`docs/agents/briefs/spx-slayer.md`).**
Living inventory. Kept current forever after — when this file and the code disagree, the code
wins and this file is a bug.

Its job is to let a stranger answer, for every displayed field: *what is this · where does it come
from · how is it calculated · what source generated it · when was it last updated · what units ·
what makes it unavailable · how do we know it is correct · where else is this value consumed.*

**Where an answer is not known, this file says `UNKNOWN`.** An honest gap is a finding; a
plausible guess is a lie that outlives whoever wrote it. Every `UNKNOWN` below is a work item.

> **Provenance of this document.** Everything marked *verified* was read out of the code at
> `963c8448` (2026-08-22) or measured against live Polygon/Massive data on 2026-08-22. Nothing
> here is carried over from a prior document without being re-checked — §6 is a list of the
> places where the prior documents turned out to be wrong.

---

## 1. Coordinates

**The member route is `/dashboard`. There is no `/spx` page.** An unstyled Times-New-Roman
render is the 404 page, not a CSS failure.

`src/app/(site)/dashboard/page.tsx` → `requireTier("community")` → `<DeskShell fullBleed>` →
`<SpxDashboard vectorEnabled={canAccessTool("vector")}>`. `force-dynamic`, `revalidate = 0`,
`noindex`.

| Area | Where | Count |
|---|---|---|
| Engine / lib | `src/features/spx/lib/` | 221 files (95 `*.test.ts`) |
| Components | `src/features/spx/components/` (+ `ios/`) | 17 `.tsx` |
| Hooks | `src/features/spx/hooks/` | 9 |
| Member APIs | `/api/market/spx/*` | 13 routes |
| Admin APIs | `/api/admin/spx/{health,dashboard}`, `/api/admin/analytics/spx` | 3 |
| Crons | `spx-evaluate`, `spx-signal-observe`, `spx-issues-sync`, `spx-signal-weight-optimize` | 4 |
| Largo tools | `get_spx_{play,pin,pulse,structure,confluence,engine_snapshots,vs_nighthawk_comparison}` | 7 |

The first three crons are confirmed DST-correct in **both** offsets by
`scripts/audit/cron-dst-audit.mjs`. `spx-signal-weight-optimize` — **UNKNOWN**, not covered by
that run.

### Test baseline

`641 pass / 0 fail` across the 95 SPX lib test files, Node 20.20.2, at `963c8448`
(`PLAYBOOK_VERDICT_GUARD_ASSERT=1 node --import tsx --experimental-test-module-mocks --test
src/features/spx/lib/*.test.ts`). Quote this as the baseline; a run on Node 22, or a run before
`npm ci`, is not evidence.

**Check both before running anything — they are container-dependent, not fixed** (`_COMMON.md` and
`CLAUDE.md` were corrected on this point in #2633 after asserting it both ways). This container had
Node 20 pre-installed at `/opt/node20/bin` **and an empty `node_modules`**; a run before `npm ci`
reported 20 failures that were purely missing dependencies, which is the phantom-failure trap
arriving from a direction the briefs did not cover. `node -v` and `ls node_modules` cost nothing.

---

## 2. THE LANE MODEL — read this before any freshness question

This is the single most load-bearing fact about SPX Slayer and it is not written down anywhere
else: **the desk is not one payload, it is five independently-cached lanes at five different
speeds, all rendering into one screen.** Almost every coherence and staleness defect in the
product's history is two lanes disagreeing.

All five live in `src/features/spx/lib/spx-desk-loader.ts`, all keyed by ET session date
(`todayEtYmd()`), all `staleWhileRevalidate` — meaning **a served value can be older than its TTL**;
the TTL governs when a refresh is *started*, not how stale a response may be.

| Lane | Cache key | Code default | **PRODUCTION** | Builder | Serves |
|---|---|---|---|---|---|
| **pulse** | `spx-desk-pulse:{ymd}` | 1s | **2s** (`SPX_PULSE_CACHE_SEC`) | `buildSpxDeskPulse` | price, change%, VIX, internals, VWAP, EMAs, session extremes |
| **flow** | `spx-desk-flow:{ymd}` | 2s | **5s** (`SPX_FLOW_CACHE_SEC`) | `buildSpxDeskFlow` | tape, dark pool, GEX walls, its own `gamma_flip` |
| **pin** | `spx-pin:{ymd}` | 1s | **2s** (reuses pulse — *see below*) | `buildSpxPinForecast` | EOD pin, cones, magnet, its own flip |
| **desk** | `spx-desk:{ymd}` | 20s | **30s** (`SPX_DESK_CACHE_SEC`) | `buildSpxDesk` | GEX/max-pain/flip header tiles, macro, news, regime |
| **merged** | `spx-merged:{ymd}` | 20s | **30s** | merge of the three above | `/merged`, `/power-hour`, `/commentary` |
| **bootstrap** | `spx-bootstrap:{ymd}` | 20s | **30s** | `loadMergedSpxDesk` | one-shot page load |

> **Read the PRODUCTION column, not the code default.** All three TTL env vars are set in the
> `blackout-production/app/env` secret and every one of them overrides the code — the desk lane
> runs at **30s, not the 20s the source suggests**. A freshness claim quoted from
> `src/lib/providers/config.ts` alone is wrong by 50% on the slowest lane. (Read from Secrets
> Manager 2026-08-22; flag names and their non-secret values only, nothing else inspected.)

**Consequences that are structural, not bugs to be surprised by:**

1. **The 30s desk lane is the slow one, and the header tiles ride it.** `Γ FLIP`, `GEX`,
   `MAX PAIN`, `TREND` can sit still for >30s in production while the price tile, chart and pin
   panel all move.
   Recorded as a P2 in the 2026-08-07 backlog; still true and still structural.
2. **`/merged` and `/bootstrap` cache at 30s but *contain* the 2s pulse.** A consumer reading pulse
   fields off the merged bundle gets them up to 15× staler than the same fields off `/pulse`.
   The dashboard avoids this by polling `/desk`, `/pulse` and `/flow` separately after the initial
   bootstrap (`useMergedDesk.ts`) — **any new consumer that reads pulse fields off `/merged`
   inherits the 30s staleness silently.**
3. **Three lanes each compute their own `gamma_flip`** (desk, flow, pin), plus the matrix's own.
   They are *different questions* (expiry scope differs), not a race — see §5.

> **Defect (doc): the pin lane's TTL comment is wrong.** `spx-desk-loader.ts:130` says
> *"5s TTL (reuses the pulse TTL)"*. It calls `deskPulseCacheTtlMs()`, which defaults to **1000ms**
> (`src/lib/providers/config.ts:35-40`) and is **2000ms in production**. The pin forecast — which
> runs a 400-path Monte-Carlo — therefore rebuilds 2.5× more often than its own comment claims.
> The comment is doubly misleading: it names a number that is neither the default nor the deployed
> value, and it ties the pin lane's cost to a variable (`SPX_PULSE_CACHE_SEC`) that someone tuning
> the *price* lane would not expect to be paying for a Monte-Carlo.

### Client poll cadence

`useMergedDesk.ts` — `/bootstrap` once, then SWR per lane: pulse at `SPX_PULSE_REST_POLL_MS`
(slowed to `SPX_PULSE_REST_SSE_POLL_MS` while the SSE stream is connected), flow at
`SPX_FLOW_POLL_MS`, full desk at `SPX_FULL_DESK_POLL_MS`, all `refreshInterval: 0` when
`sessionActive` is false. `/pulse/stream` is the SSE overlay (index store + UW tide/dark-pool/
net-flow stores, with backpressure shedding).

---

## 3. Field inventory — header + pulse surfaces

Read as: **field → route → engine function → upstream → freshness/units → consumers**.

### 3.1 `SpxSniperHeader` stat pills (`SpxSniperHeader.tsx:195-243`)

| Field | Route | Engine | Upstream | Units / freshness | Unavailable when |
|---|---|---|---|---|---|
| SPX price | `/pulse` | `buildSpxDeskPulse` → `fetchPulseLaneSnapshots` | Redis `spx:pulse:snapshot` (WS writer), falls through to Polygon `fetchIndexSnapshots` | index pts, ≤1s TTL + SWR | `!spxSnap.price` → whole pulse payload `empty` |
| `spx_change_pct` | `/pulse` | `fetchPulseLaneSnapshots` + `pulseChangePctFromPriorClose` | **prior close**, not session open — see §6.1 | % , 2dp | anchor unresolved → falls to REST lane |
| `vix`, `vix_change_pct` | `/pulse` | same lane | Polygon `I:VIX` | pts / % | same |
| `vwap` | `/pulse` | `sessionStatsWithProxyVwap` → `sessionStatsFromMinuteBars` | Polygon `I:SPX` minute bars | pts | no RTH bars |
| `vwap_volume_weighted` | `/pulse` | `sessionStatsFromMinuteBars:82` | — | bool | **always `false` in production** — §7.1 |
| `gex_net` (`GEX`) | `/desk` | `gexPositioningFromHeatmap(hm).net_gex` | Polygon options GEX matrix (`fetchGexHeatmap`) | $ notional, ≤20s + SWR | matrix cold → sticky `lastGood*` |
| `gex_king` | `/desk` | `kingFromStrikeTotals` | same matrix | strike | same |
| `max_pain` | `/desk` | `gexPositioningFromHeatmap(hm).max_pain` | same matrix, **OI-only** | strike | same |
| `gamma_flip` (`Γ FLIP`) | `/desk` | matrix flip, `gammaRegimeWithHysteresis` | same matrix | strike, **near-term multi-expiry** | honest `null` is preserved, never back-filled from sticky (see `spx-desk.ts:418-424`) |
| `regime` (`TREND`) | `/desk` | `inferRegime` | price vs 20/50 EMA | word | — |
| `uw_iv_rank` | `/desk` | `intel ?? polygonIvRank ?? uwIv` | engine overlay → Polygon → UW | 0–100 | all three null |
| `tick`/`trin`/`add` | `/pulse` | `resolveMarketInternals` | Polygon index snapshots, `intel` fallback | index | `internals_estimated` flags a derived value |
| `gex_stale` badge | `/desk` | `gexStaleFromAge(gexAgeMs)` from `pos.asof` | — | bool | — |

**Why `gex_stale` is derived from `pos.asof` and not from "did we fetch this cycle"** is worth
keeping: a successful fetch can return data the provider itself computed minutes ago. The comment
at `spx-desk.ts:439` records this; it is the correct pattern for every freshness flag on the desk.

**Correctness check available:** the desk's `max_pain` is OI-only and was verified against a full
Polygon SPXW chain on 2026-08-07 (`maxPain OI-only = 7630`, matching `desk.max_pain` exactly).
That check is reproducible and should be part of a pre-open gate — see §8.

### 3.2 Fields whose provenance is UNKNOWN

- ~~**The writer of Redis `spx:pulse:snapshot`.**~~ **TRACED 2026-08-23 — and it found a live
  defect.** The writer is `src/lib/ws/polygon-socket.ts:464`: the indices-WS `A` (aggregate)
  handler `setex`es the whole `indexStore` under a 30s TTL on every bar. The `V` (value/tick)
  handler deliberately does **not** write it — it refreshes only the local in-process store, so
  Redis is not hammered at tick rate. A second, conditional seeder lives at
  `src/lib/ws/socket-cluster-health.ts:161` (UW stock-state, used when the Polygon indices WS is
  not writing).

  **The `change_pct` anchor at source is TWO different anchors behind one field name**, carried
  on `IndexStoreEntry.open_source`:

  | `open_source` | `session_open` is… | so `change_pct` is measured from… |
  |---|---|---|
  | `"rest"` | `price / (1 + change_pct/100)` where `change_pct` is Polygon `/v3/snapshot/indices` → `session.change_percent` | the **PRIOR CLOSE** |
  | `"ws-bar"` | `agg.o`, the bar's own open | a **BAR OPEN** |

  `seedSessionOpenFromRest()` only runs on a connect at or after **09:31 ET**, so a replica whose
  socket comes up before the bell never gets a REST anchor and rides a bar-open anchor for the
  whole session. The two differ by the overnight gap. The value crosses Redis and the SSE wire
  with **no anchor attached**, which is precisely the 2026-08-07 P0 that
  `pulseChangePctFromPriorClose` was written to make unexpressible.

  The REST pulse derives correctly (`spx-desk.ts:1683`, `:2017`). The SSE overlay did **not** —
  `usePulseStream`'s `overlayFromStream` spread the transported value over the derived one, and
  the overlay wins (`{ ...basePulse, ...overlay }`). Fixed 2026-08-23; see the findings entry.
  **Still open:** `vix_change_pct` on the same overlay has no VIX prior close on `SpxDeskPulse` to
  derive from, and Thermal's `/heatmap` header (`GexHeatmap.tsx:3475`, `pushedChangePct`) consumes
  the same transported field for SPX/VIX — that surface is the Thermal lane's.
- **`leader_stocks`, `lit_dark_ratio`, `vix_term`, `gap_source`, `data_quality`** — carried on the
  pulse payload, not traced to source in this pass. UNKNOWN.
- **Every field on `/journal`, `/commentary`, `/outcomes`, `/power-hour`, `/signals`.** Phase 0
  mapped the desk/pulse/flow/pin spine only. UNKNOWN — next increment of this file.
- **The `ios/` component set** (`SpxIosMetricGroups` and siblings) renders its own field list;
  only `Max pain` was checked. UNKNOWN whether its labels track the desktop header's.

---

## 4. The trace — one signal, end to end

Required by the charter. Traced for the **confluence signal**, the thesis every other SPX surface
narrates. Every arrow names a real function.

```
INPUTS      SpxDeskPayload            spx-desk.ts        buildSpxDesk / mergeDeskLayers
   ↓                                   ← Polygon GEX matrix, Polygon index bars/snapshots,
   ↓                                     UW WS ladder + tide + dark pool, Benzinga news,
   ↓                                     macro-events, Postgres flow tape
FEATURES    factors[]{label,weight,detail}   spx-signals.ts   computeSpxConfluence
   ↓
CONDITIONS  per-factor thresholds, all in computeSpxConfluence:
   ↓          VWAP side                  ±12
   ↓          γ regime (regime × side)   ±10   — only when regime & side agree
   ↓          GEX wall within 12 pts     ±18   — mutually exclusive, nearer wall only (ISSUE-01)
   ↓          gex_king side              ±6
   ↓          session window quality     ±6/−8 via sessionQualityDelta (magnitude, not direction)
   ↓          news risk                  −6…+3 (directional, added signed)
   ↓          flow strike concentration  +3    (requires alert_count > 3)
   ↓          Helix flow alignment       scoreHelixFlowAlignment
   ↓
SCORE       signed sum → clamp(−100, 100)          spx-signals.ts:684
   ↓
CONFIDENCE  clamp(round(|score|·1.15 + factors.length·3), 0, 96)   spx-signals.ts:706  ← §7.2
   ↓
GRADE       scoreToGrade(|score|, conflicts) → A+ | A | B | C | D
   ↓
DECISION    score ≥ +22 → BUY_CALL · ≤ −22 → BUY_PUT · |score| ≥ 10 → HOLD · else WAIT
   ↓
GATES       evaluatePlayGates(desk, confluence, session, confirmations)   spx-play-gates.ts:121
   ↓          four ordered categories: operational → playbook_validity → risk → quality
   ↓          returns blocks[], blocks_by_category, first_block_category,
   ↓          entry_mode: none|starter|full, trade_governor
   ↓
STATE       SCANNING → WATCHING → BUY → HOLD → TRIM → SELL
   ↓          spx-play-engine.ts  evaluateSpxPlay / getSpxPlaySnapshot
   ↓          persisted via spx-play-store.ts
OUTCOME     spx-play-outcomes.ts  fetchPlayOutcomeStats / fetchRecentPlayOutcomes
            adaptive gates fed back via computeAdaptiveGates (spx-play-telemetry.ts)
```

**Two things this trace makes visible that reading any single file does not:**

- The `Session window` factor was inverted for every short setup until it was fixed — a
  magnitude modifier added to a *signed* score upgrades a short when it means to penalise it. The
  fix (`sessionQualityDelta`, applied along the current sign) and its 24-line explanation sit at
  `spx-signals.ts:625-655`. **This is the template for every future modifier: decide whether the
  factor speaks to DIRECTION or to CONFIDENCE, and add it signed only if the former.**
- `confidence` is computed *before* the gates and never revised by them. A play blocked by four
  gates carries the same `confidence` as one that passed cleanly.

---

## 5. Why there are several gamma flips and two max pains — the intended design

Recorded so no future lane "fixes" this by collapsing them, which would make the pin engine wrong.

| Value | Scope | Where |
|---|---|---|
| `desk.gamma_flip` | near-term multi-expiry aggregate | matrix flip, `spx-desk.ts:434` |
| `flow.gamma_flip` | flow lane's own GEX snapshot | `buildSpxDeskFlow` |
| `pin.flip` | **0DTE-only, OI-only** BSM ladder | `pinFlip`, `spx-pin-forecast-core.ts` |
| matrix flip | 0DTE over the 21-expiry book | GEX matrix panel |
| `desk.max_pain` | **OI only** | `gexPositioningFromHeatmap` |
| pin magnet max pain | **OI + intraday volume** | `pinMaxPain`, same file |

Both max pains are *correct*; they are two metrics wearing one word. The disambiguation is
partially shipped: the pin panel now says **"effective max pain" / "EFF MAX PAIN"**
(`SpxPinForecast.tsx:18,281`) and the header tooltips now name the basis split for `flip`,
`maxPain` and `regime` (`SpxSniperHeader.tsx:96-98`). **What is still open:** the visible header
label is still bare `Max Pain` (`SpxSniperHeader.tsx:223`) and `Max pain` on iOS
(`SpxIosMetricGroups.tsx:115`) — a tooltip is not disclosure on a touch device, where there is no
hover. And there is still no coherence assertion anywhere that two member-facing values sharing a
label must agree within a stated tolerance.

---

## 6. Prior art that is now WRONG

The charter asks for this by name. A stale document that reads as current is the most expensive
artifact in the repo.

### 6.1 `docs/audit/backlog/2026-08-07-spx-slayer.md` — all 10 items said `BACKLOG`. Three were fixed and one was not a defect. **Reconciled in place by this PR.**

As found, every item's `### Status` line read `BACKLOG — fix after close 2026-08-07`. Re-checked
against `963c8448` and each status rewritten in that file to its real state, with the file and line
that settles it — so the two documents cannot drift apart again. The table below is the summary;
that file carries the detail and stays the 2026-08-07 RTH capture it is (its evidence is real live
prod data and was not altered).

Three items are marked **UNVERIFIED** rather than judged. They are pixel and network observations
that a source read genuinely cannot settle, and calling them fixed or open from the source would be
a guess wearing a verdict's clothing.

| # | Item | Real status at `963c8448` |
|---|---|---|
| P0 | Day-change anchored to session open, wrong sign | **FIXED.** `fetchPulseLaneSnapshots` now applies the FIX-A authoritativeness test — takes the price, leaves `change_pct` unresolved unless `open_source === "rest"`, falls through to the REST lane. `spx-desk.ts:624-651`, carrying the 2026-08-07 measurement in the comment. |
| P1 | `/flow` is the one route with no `roundFloats()` | **FIXED.** `flow/route.ts:24` wraps in `roundFloats`, comment cites the same measurement. |
| P1 | Four flips / two max pains / contradictory tabs | **PARTIAL.** Tooltip disclosure + "effective max pain" shipped; bare header label and the coherence assertion are not — §5. |
| P2 | Mobile brand text collides with menu button | **UNVERIFIED.** Pixel defect; needs a live render. Not checkable from source. |
| P2 | Chart controls under the 44px touch minimum | **OPEN.** `.tap44` exists (`globals.css:20195`) and is used by **Helix only** — no SPX component references it. |
| P2 | Desk lane stale for tens of seconds | **OPEN and structural** — 20s TTL + SWR, §2. |
| P2 | Intel tab ~200px dead space above the fold | **UNVERIFIED.** Needs a live render. |
| P3 | Pin temporal-stability gate never fires | **OPEN, unchanged.** `spx-pin.ts:55-68` — still module-level per-process state, still `if (stable) pinStabilityConfirmed = last`, still a 3-sample window. |
| P3 | Analytic vs Monte-Carlo cones on one axis | **NOT A DEFECT — closable.** The finding said "confirm what the panel draws". It draws **one at a time**: `SpxPinForecast.tsx:22` is a `useState<"analytic"\|"montecarlo">` toggle and line 106 captions which is shown. Never overlaid. |
| P3 | Console 411/502 on `/dashboard`, not reproduced | **UNVERIFIED.** Recorded as unreproduced originally. |

**Do not re-report the three fixed items.** Re-deriving a solved finding is how a lane spends a
day producing nothing.

### 6.2 `spx-desk-loader.ts:130` — pin lane "5s TTL"

Actual TTL is 1s. §2.

### 6.3 Anything describing a staging deploy target

`docs/spx/PLAYBOOK-*` and the in-code "STAGING FULL-ENABLEMENT" comments describe a staging
environment that was **fully decommissioned on 2026-07-25** (CLAUDE.md). The comments are not
merely stale prose — they gate live code paths. §7.1.

### 6.4 The eleven `PLAYBOOK-*.md` documents — audited 2026-08-22

**The result is not what the shape of this section predicted.** These documents are *accurate about
the code* and *false about the world*, often in the same paragraph — which is worse than being
uniformly stale, because nothing tells a reader which half they are looking at.

**What held up.** Every mechanically checkable engineering claim was correct at `9b20b63c`:

- `PLAYBOOK-ARCHITECTURE-STATUS.md` §6's per-playbook matrix — **all 70 cells** match
  `PLAYBOOK_SURFACE_STATUS`.
- §16's hard constants — wall proximity 10pts, MTF buffer 1.0, flow materiality 100k — all match
  `spx-play-config.ts`.
- §17's code map — every module listed exists.
- Referenced source paths across all eleven — 37 of 40 exist; the 3 missing are staging artifacts.

**What is false.** Every one of the eleven references staging (~154 times), decommissioned
2026-07-25. The worst is concentrated in the file that calls itself the **"Single Source of
Truth"** and tells the reader to *"start here for current truth"*:

| Claim in `PLAYBOOK-ARCHITECTURE-STATUS.md` | Reality |
|---|---|
| **Repo:** `coreentryadmin-web/blackout-web-sandbox` | Not this repo. This is `blackout-web`. |
| `→ https://staging.blackouttrades.com` | Decommissioned 2026-07-25. |
| *"do not merge to **Railway** prod"* | There is no Railway. All infra is AWS ECS. |
| §9 *"Prod — Playbook live gate **off** unless `PLAYBOOK_LIVE_GATE=1`"* | It **is** `1` in production. The sentence is literally true and practically inverted. |
| §9 *"Infra: `apply-staging-env-overrides.mjs` sets `PLAYBOOK_LIVE_ALLOWLIST`"* | Unset in production; the allowlist resolves to `null`. |
| §18 `npm run validate:staging-playbook` | Removed from `package.json` with staging. |

Each file now carries a banner naming exactly these, so a reader cannot take the environment
claims at face value. **Do not delete these documents** — the design intent and per-playbook detail
in them is the best record that exists, and it is correct.

**Enforced going forward:** `src/features/spx/lib/playbook-status-doc-sync.test.ts` asserts §6's
matrix still matches `PLAYBOOK_SURFACE_STATUS` (and that a parse finding zero rows fails rather
than passing vacuously). The half that can be checked mechanically now is, so it cannot silently
join the half that rotted.

---

## 7. Findings opened while mapping

### 7.1 [P1] Five SPX code paths are gated on `isStagingDeploy()`, permanently false since staging was decommissioned — and because `PLAYBOOK_LIVE_GATE=1` in production, PB-01 and PB-02 are unreachable setups that can never produce a live entry

`isStagingDeploy()` is `(NEXT_PUBLIC_SITE_URL ?? "").includes("staging.")`
(`src/lib/clerk-env.ts:10-12`). Production sets `NEXT_PUBLIC_SITE_URL=https://blackouttrades.com`,
and **staging was fully decommissioned on 2026-07-25** — there is no deploy target that can make
this true. Every branch behind it is dead code in every environment that exists:

> **CORRECTION (2026-08-22): this section originally said "five call sites". That was an undercount
> by roughly 3×** — it counted only what a grep of `spx-desk.ts` and `spx-play-config.ts` turned up.
> The real SPX surface is **~15 dead branches** across at least nine files: add
> `playbook-session-risk.ts:47`, `trade-governor.ts:167`, `spx-play-engine.ts:875`,
> `spx-play-gates.ts:168,205,207`, `playbook-regime-router.ts:93`, `spx-play-kanban-chips.ts:131`
> and `SpxCommentaryRail.tsx:354` (the last five reach it through `playbookStagingLabEnabled()`,
> which is just `isStagingDeploy()` wearing a different name — grepping the direct call alone misses
> them). There are three more in `src/lib/ai-env.ts` and one in `src/lib/largo-env.ts`, outside this
> lane's surface.
>
> **Only the VWAP site is fixed** (the one that unblocks PB-01/PB-02). The remaining branches each
> need a per-site judgment about what the correct production behaviour is — several are staging-only
> debug affordances where deletion is right but is a UI change — so the sweep is its own issue, not
> a rider on a member-facing fix.

| Site | Effect now |
|---|---|
| `spx-desk.ts:129` `sessionStatsWithProxyVwap` | **FIXED.** Was: SPY-volume-proxy merge never ran → SPX VWAP was an equal-weight typical-price mean and `vwap_volume_weighted` permanently `false`. Now resolved by `spx-vwap-proxy.ts` behind `SPX_VWAP_SPY_PROXY` (default ON, env-reversible), which also reports `vwap_volume_source` so `true` never silently claims SPX volume that does not exist. |
| `spx-play-config.ts:419` `playbookStagingLabEnabled` | always false |
| `spx-play-config.ts:427` `playbookLiveGateEnabled` | falls through to `PLAYBOOK_LIVE_GATE` (default false) |
| `spx-play-config.ts:483` `playbookLiveAllowlist` | full-enablement branch unreachable |
| `spx-play-config.ts:493` `isPlaybookLiveAllowlisted` | full-enablement branch unreachable |

**The consequence that matters.** `playbook-data-requirements.ts:73` sets
`volumeWeightedVwap: id === "PB-01" || id === "PB-02"`, and line 112 raises a data-requirement
violation whenever `desk.vwap_volume_weighted === false`. Since that flag can never be true in
production, **PB-01 (VWAP Reclaim) and PB-02 (VWAP Reject) — both `fidelity: "high"` — can never
satisfy their data requirements.** Two of fourteen playbooks are silently, permanently
unreachable, and the only mechanism that could unblock them lives behind a decommissioned
environment. The code's own comment at `spx-desk.ts:118` predicted this ("permanently hard-blocks
PB-01/PB-02") — for staging's absence, which has now happened everywhere.

**This is member-facing, and the production config is what makes it so.** Read from the
`blackout-production/app/env` secret on 2026-08-22: **`PLAYBOOK_LIVE_GATE = "1"`.** So
`playbookLiveGateEnabled()` is TRUE in production, which means gate A17 requires a matched
`primary_playbook_id` before any BUY. Two of the high-fidelity setups in that matcher can never
match, so every entry PB-01 (VWAP Reclaim) or PB-02 (VWAP Reject) would have produced is silently
not taken — not blocked with a reason a member or Largo could read, but absent from the matcher
before any gate gets a say. `PLAYBOOK_LIVE_ALLOWLIST` is unset, so the allowlist resolves to `null`
and is NOT the constraint; the data requirement is.

*Severity was first written here as P2 on the assumption that the live gate was probably off in
production — the code default is `false`. Checking rather than assuming moved it to P1. The
assumption was never published, but it did shape the Phase 1 ordering, and the ordering changed
with it.*

**Measured, and it corrects the obvious first reading.** My first read was that this makes the
desk's VWAP wrong. It does not, materially. Computing both VWAPs over real Polygon `I:SPX` minute
bars merged with real SPY minute volume — the exact merge `sessionStatsWithProxyVwap` performs —
across seven sessions (2026-08-12 → 08-21, RTH only, 390 bars each):

```
day        equalWeightVWAP  trueVWAP(SPYvol)  diff_pts  diff_bps  above/below disagreements
2026-08-21         7676.50           7677.03     -0.52      -0.7    8/390
2026-08-20         7671.33           7666.34     +4.99      +6.5   14/390
2026-08-19         7720.80           7717.77     +3.03      +3.9   19/390
2026-08-18         7702.16           7700.42     +1.75      +2.3   13/390
2026-08-14         7786.90           7787.58     -0.68      -0.9    1/390
2026-08-13         7794.58           7795.39     -0.81      -1.0    7/390
2026-08-12         7749.77           7749.82     -0.05      -0.1   22/390
```

So the **level** is close — worst case 5.0 pts, 6.5 bps. The honest severity is therefore *not*
"VWAP is wrong"; the `vwap_volume_weighted: false` badge is telling the truth and the header shows
`vw` only when true. What is wrong is the **dead gate**. Note the last column though: the two
VWAPs disagree about whether price is *above or below* VWAP on 1–22 minutes per session (0.3%–5.6%),
and `above_vwap` is a ±12-weight confluence factor — the largest non-wall weight in the engine.

**Fix rationale (deferred to Phase 1, per the Phase 0 gate).** Delete `isStagingDeploy()` from the
SPX paths and make each branch an explicit env decision, so a capability is enabled by a named flag
rather than by a URL substring that no longer occurs. The VWAP proxy in particular should be
`SPX_VWAP_SPY_PROXY=1`-gated and decided on its merits, not inherited from a dead environment.
**Deliberately not proposing** to force `vwap_volume_weighted` true — that flag is honest and other
code correctly reads it.

### 7.2 [P2, Largo boundary] `confidence` reaches Largo as an uncalibrated formula, which the product contract says must be omitted

`spx-signals.ts:706`:

```ts
const confidence = clamp(Math.round(abs * 1.15 + factors.length * 3), 0, 96);
```

This is a deterministic transform of `|score|` and a **count of factors**, with no reference to any
realized outcome, no denominator, and no calibration set. It is nonetheless published as a
percentage — `computeSpxTradeSignal` renders it as `` `${c.confidence}% conviction` `` — and
`get_spx_confluence` returns the `SpxConfluence` object **verbatim** to the model
(`src/lib/largo/run-tool.ts:1564-1571`), so a `confidence: 74` arrives at Largo alongside other
lanes' confidence values and is ranked against them.

`docs/audit/LARGO-PRODUCT-CONTRACT.md`, restated in `CLAUDE.md`, is explicit: *"`confidence` must
be OMITTED when a product cannot calibrate it. An invented score is compared against another lane's
measured one, so fabricated certainty does not stay local — it corrupts cross-product ranking."*

Two specific defects inside the formula, beyond the calibration question:

1. **`factors.length` counts *conflicting* factors as confidence.** `factors` holds both signs. A
   maximally-conflicted tape scoring ≈0 across 8 factors yields `0·1.15 + 8·3 = 24`; the count term
   cannot distinguish agreement from disagreement. `agreeing` and `weighted_conflicts` are computed
   on the very next lines and are not used.
2. **Gates never revise it.** Confidence is fixed before `evaluatePlayGates` runs, so a play held
   by four gates reports the same conviction as one that passed clean (§4).

**MEASURED 2026-08-23 — it is worse than "uncalibrated": it is a CONSTANT.** Across every closed
play in production, **51 of 51 over 54.3 days, `confidence` is 96** — the clamp ceiling, zero
variance. The `factors.length * 3` term contributes 24–42 points on a typical 8–14 factor desk, so
anything clearing the entry thresholds (full 52 / starter 48 / cold-buy 78) saturates the cap. The
desk renders it to members as `"{n}% conviction"` per play. It has said 96 for eight weeks.

Measured with `scripts/audit/spx-confidence-calibration.mjs`. On the same 51 plays the substitutes
this map recommended are themselves weak: `r(|score|, win) = 0.172`, `r(grade_rank, win) = −0.038`
— n=51, indicative only, but `grade` shows no signal in this sample and should not be presented as
a calibrated stand-in.

**The Largo boundary is fixed (#2646); the member-facing number is not.** That is with the
coordinator, since they directed it be left alone when the field was believed merely uncalibrated.

The tool *description* for `get_spx_confluence` (`tool-defs.ts:506`) lists action, bias, score,
grade, agreeing/conflicting factors, levels — and **does not mention confidence at all**. So the
field is arriving undocumented as well as uncalibrated.

**RESOLVED (2026-08-22): it does, and so do two more paths.** The uncalibrated value reached the
model on **four** doors, not one — `get_spx_confluence` (`run-tool.ts:1564`), `get_spx_play`
(`run-tool.ts:960`, the payload carries it at top level from 12 assignment sites in
`spx-play-engine.ts`), `get_ecosystem_context.spx_full_state` (`ecosystem-context.ts:847`), and
`largo-live-feed.ts:784`, which **whitelisted it explicitly** into the feed the model reads without
any tool call. `tool-defs.ts:217` also advertised the field. All four now omit it and name the
absence (`src/lib/largo/spx-confidence-boundary.ts`); the member-facing UI number is unchanged.

**Still open, and logged here rather than fixed:** `spx-play-engine.ts:1633` sets
`confidence: closedConfluence?.confidence ?? 0` on the session-closed path. A `0` reads as a
measured floor, not as "unknown" — absence published as measurement, in the member payload. It
belongs with the calibrated-confidence work, not the boundary fix.

---

## 8. What Phase 0 could not answer — the work list

Ranked. These are the `UNKNOWN`s above, restated as tasks.

0. ~~**Audit every SPX-relevant key in `blackout-production/app/env` against its code default.**~~
   **DONE — and made reproducible rather than snapshotted.** `scripts/audit/spx-env-drift.mjs`
   scans the SPX surface for `process.env.X`, extracts each one's code default from the source,
   reads the deployed values, and classifies every key **unset / no-op / override / unknown**.
   A markdown snapshot of the answer would rot exactly the way the documents §6 reconciles had
   rotted; a script does not. Run it before quoting any env-tunable behaviour.

   **Measured 2026-08-22 — 142 keys referenced, and only 6 actually override their default:**

   | key | code default | **production** |
   |---|---|---|
   | `PLAYBOOK_LIVE_GATE` | `false` | **`1`** — this is what makes §7.1 a P1 rather than latent |
   | `SPX_DESK_CACHE_SEC` | 20 | **30** |
   | `SPX_PULSE_CACHE_SEC` | 1 | **2** |
   | `SPX_FLOW_CACHE_SEC` | 2 | **5** |
   | `SPX_PLAY_MEMBER_READ_CACHE_SEC` | 5 | **2** |
   | `SPX_CHAIN_QUOTE_TTL_MS` | 5000 | **4000** |

   132 are unset (the code default genuinely governs), 1 is a no-op (`ENGINE_INTEL_OVERLAY="0"`,
   which equals its default — it *looks* like a deliberate override and is not one), and 3 are
   secrets with no determinable default. **So the trap is small and enumerable, not everywhere** —
   which is the useful form of "check the deployed value": there are six of them, and five are
   latency knobs. Note the shape of the tuning: the three shared lanes are all *slowed* while the
   per-member play read is *sped up*. That is coherent, not drift.

   Without credentials the script reports **SKIPPED, never GREEN** — "I could not look" must not
   render as "clean".

1. ~~**Line-audit the eleven `docs/spx/PLAYBOOK-*.md` documents**~~ **DONE — see §6.4.** Accurate
   about the code, false about the world; all eleven bannered, and §6's matrix is now ratcheted
   against its source constant.
2. **Build a calibrated confidence from `spx-play-outcomes`, out-of-sample validated** — and fix
   `spx-play-engine.ts:1633`'s `?? 0` fallback with it. The Largo boundary now omits the
   uncalibrated number, which is honest but not an answer; the member UI still renders it.
   **Partially addressed 2026-08-23:** the `?? "D"` / `?? 0` fallbacks are no longer
   *indistinguishable* from a measurement — `SpxPlayPayload.assessed` now marks the three sites
   that fabricate them, and the Play Verdict Bar suppresses the fabricated grade/score. That
   removes the false publication; it does not produce a calibrated number, which is still this
   item. The three literals themselves remain in the payload because the type is non-nullable —
   see §8b.
   **Start from the measurement, not from the field's history:** `scripts/audit/spx-confidence-calibration.mjs` shows the stored `confidence` is 96 on all 51 rows (§7.2), so the ledger carries no recoverable conviction signal — a calibration has to be built from `score`/`grade`/factors. On those same rows `r(|score|, win) = 0.172` and `r(grade_rank, win) = −0.038` (n=51, indicative only).
3. **Trace the `spx:pulse:snapshot` writer** in the market-worker lane and record its `change_pct`
   anchor at source (§3.2).
4. **Map `/journal`, `/commentary`, `/outcomes`, `/power-hour`, `/signals`** to this file's schema.
5. **Run `scripts/audit/largo-truncation-probe.mjs` against all seven SPX tools** and read the
   CONTROL line — a run whose control does not come back TRUNCATED reports every COMPLETE as
   UNVERIFIED, not clean.
6. ~~**Build the SPX interaction audit**~~ **DON'T — one already exists and covers `/dashboard`.**
   `scripts/audit/live-ui-interaction-audit.mjs` ships `/dashboard` in its default page list and
   shares `lib/ui-geometry-probe.mjs`. It did not need writing; it needed running. First run
   2026-08-23 confirmed the 2026-08-07 backlog's chart-control collision on **desktop** (3
   collisions: `SPX` over the timeframe selector, `▶ Replay` over `GEX`, both ways) and exposed a
   defect in the harness itself — four false Escape FAILs per page from comparing dialog counts
   across a navigation, fixed and validated live (6 failures → 1).

   **Still open here:** localise and fix the collision CSS (the 2026-08-07 entry's caution against
   guessing a layout rule stands), and audit the **phone** viewport — it has failed navigation with
   `ERR_CONNECTION_RESET` on every attempt, which is the sandbox tunnel and not the server, so the
   mobile brand/menu collision stays UNVERIFIED.


7. **A coherence assertion in the pre-open gate**: any two member-facing values sharing a label
   must agree within a stated tolerance or the label must differ (§5). The reproducible OI-only
   max-pain check against a full Polygon SPXW chain is the model.
8. **Confirm `spx-signal-weight-optimize`'s DST correctness** — the other three crons are done.

---

## 8b. Known-open — recorded, deliberately not fixed

Things measured and understood, where the fix was scoped out on purpose. Recorded here so they
are open work rather than forgotten work. A row leaves this list only when it is fixed or
reclassified with a reason.

| # | What | Why not fixed here |
|---|---|---|
| b1 | `SpxPlayPayload.grade`/`score`/`confidence` are non-nullable (`string`/`number`/`number`), so the three fabrication sites must invent `"D"`/`0`/`0` when nothing was assessed. `assessed` flags it; the literals are still in the payload. | Making them nullable produced 13+ `tsc` errors that force a nullability decision through gate arithmetic (`buildSpxPlayDeskContext` → `mixedTapeBlockThreshold`), **Vector's** `PlayStateSnapshot`, and the Night Hawk badge map. Each needs its own answer to "what does an ungraded desk mean here"; that is a typed-absence refactor across three lanes, not a UI fix. |
| b2 | `spx-slayer-badge-map.ts:37-38` forwards `payload.grade`/`payload.score` into `SpxSlayerBadge` (typed `string`/`number`), and `unavailableSpxSlayerBadge()` hard-codes `grade: "D", score: 0` — the same absence-as-measurement defect, rendered on the **Night Hawk** board (`zerodte-board-strips.tsx`, `CommandDeck.tsx`). | The DTO and both renderers are Night Hawk-lane surfaces. The `assessed` flag is now on the payload for that lane to act on; changing another lane's display types inside an SPX UI fix is the cross-lane push this repo's merge history keeps punishing. |
| b3 | The chart-control collisions on `/dashboard` desktop (3, reproduced live 2026-08-23) are localised to the harness output but the CSS rule is not yet identified. | §8 item 6 — the 2026-08-07 entry's caution against guessing a layout rule stands; needs the phone viewport too, which the sandbox tunnel has never reached. |
| b4 | **Pin stability window size** — `PIN_STABILITY_WINDOW = 3` at the deployed 2s pin TTL asks "did the pin move more than a strike in ~6 seconds", which is structurally almost always no. | Calibration, not a defect. Needs out-of-sample evidence over real sessions. The 2026-08-23 hold-steady fix (this PR) is correct at any window size. |
| b5 | **Pin stability state is per-process** — `spx-pin.ts` holds the rolling window at module scope; production runs multiple ECS tasks, so a member round-robins across replicas each with its own window and its own held pin. | Needs shared state (the Redis lane the desk already uses). Architectural, not a lane's unilateral change. |
| b6 | **`spx-play-engine.ts:1633`** — `confidence: closedConfluence?.confidence ?? 0` on the session-closed path; `0` reads as a measured floor, not "unknown". | Belongs with the calibrated-confidence work (§8 item 2), which is measured infeasible until ~264 closed plays exist. |
| b7 | **~15 `isStagingDeploy()` dead branches** across nine SPX files (§7.1). | Each needs a per-site judgment about correct production behaviour; several are staging-only debug affordances whose removal is a UI change. |

### Cross-lane: the Vector toolbar collides with itself, on BOTH surfaces

Found while auditing `/dashboard`, localised, and **handed to the Vector lane rather than fixed
here** — the component is theirs and a fix changes their page too.

- **`/dashboard`**: `.vector-replay-bar` (inside `.vector-replay-controls.flex.min-w-0`) computes to
  **width 0** while its buttons still render at full size with `overflow: visible`, so `▶ Replay`
  prints over the `.vector-desk-seg` GEX/VEX segment — 17x27px of real intersection.
- **`/vector`**: the same segment is overlapped by the price readouts — `"7,775"` over `GEX`,
  `"+$30.6M"` over `VEX`, `"—"` over `VEX`.

One component, two surfaces. Mechanism: `min-w-0` lets the flex child shrink to nothing, and
`overflow: visible` means its content spills onto its neighbour instead of clipping. Reproduce with
`NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/live-ui-interaction-audit.mjs
--pages=/dashboard,/vector --desktop-only`.

---

## 9. Keeping this file honest

- Add a row when you add a field. A field with no row is undocumented by definition.
- When you fix something listed here, update the row **in the same PR as the fix**. §6.1 exists
  because that did not happen for ten items.
- Prefer `UNKNOWN` over a plausible sentence. Everything in §8 started as an `UNKNOWN` in §3.
- Measurements carry their conditions: the market phase, the date, the Node version, the session
  count. A number without them is an anecdote.
