# VECTOR — THE MAP

**Phase 0 deliverable of the Vector owner lane (`docs/agents/briefs/vector.md`).**
Living inventory. Kept current forever after — when this file and the code disagree, the code
wins and this file is a bug.

Its job is to let a stranger answer, for every displayed field: *what is this · where does it come
from · how is it calculated · what source generated it · when was it last updated · what units ·
what makes it unavailable · how do we know it is correct · where else is this value consumed.*

**Where an answer is not known, this file says `UNKNOWN`.** An honest gap is a finding; a
plausible guess is a lie that outlives whoever wrote it. Every `UNKNOWN` below is a work item.

> **Provenance.** Everything marked *verified* was read out of the code at `9b20b63c`
> (2026-08-22), or measured that day against the **deployed** EventBridge manifest
> (`coreentryadmin-web/blackout-infra` @ `68a0aa0f`) and the `blackout-production/app/env` secret.
> Nothing is carried over from a prior Vector document without being re-checked — §9 lists where
> the prior documents turned out to be wrong. **No live-market validation is in this file**: it was
> written on a Saturday with the tape closed. Correctness-against-Polygon is Phase 1 and belongs in
> the next RTH window.

---

## 1. Coordinates

Member route is **`/vector`** (`src/app/(site)/vector/page.tsx`): `requireDeskTool("premium",
"vector")` → `<VectorPageClient>` → `<VectorPageShell>` (desk) or `<VectorCompareDesk>` (compare
mode, `?compare=`). `force-dynamic`, `noindex`. A failed tool gate renders `<ComingSoon>`, not a
404. The same engine is embedded on **`/dashboard`** (SPX Slayer) via `SpxVectorEmbed`.

| Area | Where | Count |
|---|---|---|
| Feature lib | `src/features/vector/lib/` | 245 files (110 `*.test.ts`) |
| Components | `src/features/vector/components/` | 32 `.tsx` + 3 test files |
| Member APIs | `/api/market/vector/*` | 17 routes |
| Member API (rules CRUD) | `/api/vector/alerts/rules` | 1 route |
| Crons (declared) | `vector-{walls-warm,bead-record,alerts,universe-snapshot,full-state-snapshot,dark-pool-warm}` | 6 |
| Crons (**deployed**) | walls-warm · universe-snapshot · full-state-snapshot · dark-pool-warm | **4** — see §7 |
| Largo bridge | `src/lib/bie/vector-*.ts` | 9 impl + 8 test |
| Largo tools | `get_vector_full_state`, `get_vector_pulse`, `get_vector_analytics` | 3 |

**Shared with other lanes — coordinate before editing:**
`src/lib/providers/polygon-options-gex.ts` (the GEX matrix — **Thermal**),
`src/lib/providers/gex-wall-levels.ts` (`computeGexWalls`, the wall/`pct` definition),
`src/lib/providers/gex-positioning.ts` (`getGexPositioning` — the shared spot **and** flip, also
read by SPX Slayer and the heatmap), and `SpxVectorEmbed` (**SPX Slayer** renders this chart).

### Test baseline

**1065 pass / 0 fail** across the 110 Vector lib test files, Node 20.20.2, at `9b20b63c`, ~23s
(`node --import tsx --experimental-test-module-mocks --test src/features/vector/lib/*.test.ts`).
Quote this as the baseline. A Node 22 run is not evidence, and neither is a run before `npm ci` —
this container had Node 20 at `/opt/node20/bin` and an **empty** `node_modules`.

---

## 2. THE TICKER TIER MODEL — read this before any cadence or freshness question

The single most load-bearing fact about Vector, and the one most likely to be got wrong: **Vector
does not have a universe, it has three tiers, and almost every cadence, cache and recorder in the
product branches on which tier a symbol is in.** A statement like "the bead rail samples every 5
seconds" is true for one tier and false for another.

| Tier | Membership | Defined in |
|---|---|---|
| **Oracle** | `SPX`, `SPY`, `QQQ` | `VECTOR_ORACLE_TICKERS` (`vector-ticker.ts`) |
| **Shared universe** | **55** static names ∪ dynamic member-viewed (`DYNAMIC_UNIVERSE_CAP = 100`, 14-day window) | `vectorUniverseTickers` (`heatmap-allowlist.ts`) ∪ `listSharedUniverseTickers` |
| **On demand** | **any** syntactically valid symbol | `isVectorTickerAllowed` — `/^[A-Z0-9.\-]{1,8}$/` |

**The preset list is not an allowlist.** `isVectorTickerAllowed` rejects only junk/injection; a
well-formed unknown symbol is served, and the providers return honest-empty structure for a
non-optionable one. Two consequences that have already bitten: the per-ticker server state map is
LRU-capped at `MAX_TICKER_STATES = 64` (`vector-snapshot.ts`) precisely because a client cycling
invented-but-well-formed tickers would otherwise grow it without bound; and an off-allowlist ticker
is **never warmed by any cron** — every cache it touches is populated only by its own reader.

### What the tier changes

| Quantity | Oracle | Shared universe | On demand | Source |
|---|---|---|---|---|
| Bead-rail bucket | **5s** | **5s** | **15s** | `ORACLE_/UNIVERSE_/NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC` |
| Client walls/history poll | 5s | 5s | 15s | `vectorWallsScopePollMs` (`vector-cadence.ts`) |
| Server wall-scope refresh | 5s | 5s | 15s | `VECTOR_(NON_UNIVERSE_)WALL_SCOPE_REFRESH_MS` |
| GEX wall source | UW `gex_strike_expiry` WS ladder | Polygon chain per expiry | Polygon chain per expiry | `getVectorGexWallsForHorizon` |
| Server-side rail recorded with no viewer | yes | yes | **no** | `vector-bead-recorder-leader.ts` |
| Full-state snapshot pre-warmed | yes | yes | **no** | `vector-full-state-snapshot` cron |

> **The trap this tier model sets.** For an oracle ticker the UW subscription is *always on*, so
> `cachedWallsAt` keeps refreshing overnight against a chain nobody is trading. A freshness check
> (`STALE_RECORD_MAX_MS = 120s`) therefore passes around the clock and is **not** a proxy for "the
> market is open". That is why all four rail writers gate on `isEtCashRth()` independently —
> `wallRailRecordingOpen()` in `vector-snapshot.ts`, the leader, the universe recorder, and the
> backup cron route. Measured on prod 2026-08-07 before that gate existed: SPX carried 5,429
> samples spanning 00:00–19:22 ET with only 28% inside cash RTH, while non-oracle META carried
> 1,445 starting cleanly at 09:30 with 95% in-session. The non-oracle name was accidentally correct.

---

## 3. THE CADENCE LADDER — every clock in the product

All of these are **code constants**, not env-tuned. Verified 2026-08-22 against
`blackout-production/app/env` (98 keys): the **only** Vector-namespaced override in production is
`VECTOR_SEED_CACHE_SEC = 120`. Unlike SPX Slayer — where three lane TTLs are overridden and the
source defaults are wrong by up to 50% — **for Vector the source is the deployed truth.** Two
non-Vector-namespaced keys still reach Vector through the shared GEX matrix:
`GEX_HEATMAP_CACHE_SEC = 30` and `GEX_HEATMAP_MAX_STALE_SEC = 300`.

| Clock | Value | Where | What it governs |
|---|---|---|---|
| SSE hub tick | **1s** | `VECTOR_SPOT_TICK_MS`, `vector-stream-hub.ts` | spot + forming candle + walls frame |
| GEX walls memo | **900ms** | `WALLS_CACHE_MS` | in-process wall recompute floor |
| Gamma flip | **5s** | `FLIP_CACHE_MS` | SWR — served from cache, refreshed behind |
| VEX walls | **8s** | `VEX_WALLS_CACHE_MS` | vanna lens |
| Dark pool (in-process) | **30s** | `DARK_POOL_LOCAL_CACHE_MS` | levels overlay |
| Bead bucket | **5s / 15s** | §2 | one rail row |
| Heatmap grid (Redis) | **5s** | `VECTOR_GEX_HEATMAP_CACHE_SEC` | strike×time surface |
| Heatmap client poll | **5s** | `VECTOR_GEX_HEATMAP_POLL_MS` | + refetch on >0.5% spot move |
| Seed bars (Redis) | **120s** | `VECTOR_SEED_CACHE_SEC` **(prod-set)** | chart seed |
| 4H bars (Redis) | **120s** | `CACHE_TTL_SEC`, `4h-bars/route.ts` | the one route with its own cache |
| SPY volume backfill | **60s** | `VECTOR_SPY_VOLUME_BACKFILL_MS` | SPX volume proxy |
| Universe snapshot | **~5 min** | `vector-universe-snapshot` cron | scanner rows |
| **Full state (Largo)** | **15 min TTL, ~5 min warm** | `vector-full-state-cache.ts` | every Largo Vector read |
| Rail in Redis | **72h** | `TTL_SEC`, `vector-wall-persist.ts` | replay; Postgres is the 15-day durable mirror |

**Consequences that are structural, not surprises:**

1. **The 1s SSE frame is stale-while-revalidate on almost everything it carries.** Only the candle
   is genuinely per-tick; `gammaFlip` is up to 5s old, `vexWalls` 8s, `darkPoolLevels` 30s. This is
   deliberate — awaiting them inline blew the 1s hub budget and froze the whole frame *including
   spot*. The payload discloses it: `gexAsOf`, `vexAsOf`, `darkPoolAsOf`, `t`. **A consumer that
   reads those numbers without their `*AsOf` sibling is reading four different instants as one.**
2. **Largo's Vector state can be 15 minutes old and is cache-first by design.** `fetchVectorFullState`
   serves the cron-warmed Redis snapshot and only computes live on a miss. Off-hours nothing
   refreshes it. This is handled honestly rather than hidden — see §6.
3. **A non-default chart timeframe bypasses the full-state cache entirely** and pays the whole
   fan-out, because only `technicals` and the play's invalidation label vary with timeframe.

---

## 4. Field inventory — by subsystem

Read as: **field → route → engine function → upstream → units → what makes it absent.**

### 4.1 Wall rail (GEX/VEX walls) — the spine

| Field | Route | Function | Upstream | Units / absence |
|---|---|---|---|---|
| `walls.callWalls[]`, `putWalls[]` | `/walls?dte=`, SSE | `getVectorGexWallsForHorizon` → `computeGexWalls` | oracle: UW `gex_strike_expiry` WS; else Polygon chain per expiry | `{strike, pct, notional}`. `pct` is **0–100** (share of total abs gamma), `notional` is $\|gamma\|. Empty walls when the chain resolves nothing |
| `flip` (gamma flip) | `/walls?dte=`, SSE `gammaFlip` | `getVectorGammaFlipForHorizon`, else `getGexPositioning().flip` | shared with SPX + heatmap | price. `null` when positioning has no flip |
| `vexWalls` / `vexFlip` | SSE only | `getVectorVexWalls` / `getVectorVexFlip` | heatmap vanna totals (8s) | same shape; `null` on legacy rows |
| horizon | every wall read | `resolveDteHorizonParam` → `expiriesForHorizon` | — | `0dte≤0 · weekly≤7 · monthly≤35 · all` calendar DTE |

**Two honest-fallback rules that are easy to misread as bugs.** `expiriesForHorizon` returns the
single **nearest** expiry when a bounded horizon matches none (0DTE over a weekend) rather than an
empty set — walls must never vanish because the horizon happened to be empty. And
`pickHorizonScopedValue` falls back to the live stream value when a scoped fetch has not landed, so
a narrowed toggle never blanks the chart. Both mean **an on-screen "0DTE" wall may be a Monday
wall**; the rule is documented at the source and is the reason the two never disagree with the
narration.

### 4.2 Bead trail (wall history) — the temporal lens

One row per bucket: `{time, walls, gammaFlip?, vexWalls?, vexFlip?, modeled?}` — `WallHistorySample`.

- **Built by** `buildWallHistorySample` (`vector-wall-sample.ts`) — the *single* builder shared by
  the live SSE hub and the server-side recorder, so both writers produce byte-identical rows.
  Rounded **once**, at the builder: a float-precision delta between a persisted row and a
  same-bucket live row is exactly what fabricated phantom flip events on the client's first merge.
- **No carry-forward.** A lens with no walls this bucket records an honest gap (empty walls, null
  flip), never a copy of the prior reading.
- **`modeled: true`** = reconstructed from the EOD chain along the observed price path, not
  observed. Renders dim/ghosted; a real sample at the same bucket always overwrites it.
- **Four writers, all `isEtCashRth()`-gated:** the in-process 5s leader
  (`vector-bead-recorder-leader.ts`, fenced Redis lock, 45s TTL, renewed at 15s) is **primary**;
  `recordVectorWallSamplesFromWarm` (walls-warm cron), the universe recorder, and
  `buildVectorStreamPayload` are the others. `/api/cron/vector-bead-record` is the declared
  backup — **and is deliberately not deployed** (§7).
- **Storage:** Redis `vector:wall-history:{ticker[:horizon]}:{ymd}` at **72h** TTL, plus a
  write-through **15-day Postgres** durable mirror. The TTL is not the retention — do not bump it.
- **Derived from the rail:** `eventsFromWallHistory` (building / fading / new / dissolved /
  shifted), `scoreTopWalls` (wall integrity — an empty rail scores *unknown*, never "held all
  session"), and the replay scrubber.

### 4.3 Expected move

`/expected-move` → `getVectorExpectedMove` → `loadCurrentChainContracts` +
`deriveExpectedMoveInputs` → pure `computeExpectedMove`: `move₁ = spot · σ · √(dteDays/365)`,
band = `spot ± k·move₁`. σ is a **real chain-sourced ATM IV** — the engine returns `null` rather
than invent one.

**`movePct` is a FRACTION (`move₁/spot`), `atmIv` is a decimal vol, `dteDays` is fractional for
0DTE.** All three are destroyed by a blanket 2dp — see §5.

### 4.4 Pin forecast · gamma magnet · max pain · confluence

- `/pin-forecast?target=eod|expiry` (default `expiry` — only SPX/SPY/QQQ have a daily expiry that
  makes "eod" a pin rather than a gamma-pull). `null` whenever there is no honest cone.
- `deriveGammaMagnet` — `distancePct` here is a **percent**, deliberately rescaled at source
  because `roundFloats` keys on the immediate key and `proximity.distancePct` in the same payload
  is also a percent, so no single override could serve both.
- `getVectorMaxPainForHorizon` — horizon-scoped; the `?horizon=` alias exists because callers
  passing it used to fall through to `all` and read 7410 next to the desk's 7440.
- `confluenceZones` ranks a cluster only when **≥2 distinct kinds** agree, so a wall repeated is
  never mislabelled confluence.

### 4.5 Universe scan (scanner + comparison strip)

`vector-universe.ts` → Redis `vector:universe:snapshot`, rebuilt ~5 min by cron. Row:
`{ticker, spot, gammaFlip, vexFlip, topCallWall, topPutWall, topCallPct, topPutPct, asOf}`;
`topCallPct`/`topPutPct` are **0–100**. Snapshots carry `attempted`/`produced` so a partial fan-out
merges rather than replaces. `flipDistancePct` is `((flip−spot)/spot)·100` — a **percent**, not a
fraction.

### 4.6 GEX heatmap · depth ladder

`getVectorGexHeatmap` reconstructs a strike×time surface by OI along the **session spot path**;
only the last column optionally includes today's volume (point-in-time honest, never
back-projected). `buildGexLadder` produces the per-strike ladder; `migration` arrows come from
`wallStrengthShift` (**imported from Thermal** — `src/features/thermal/lib/gex-heatmap/shift-math`).
The depth ladder is **anchored** to the matrix's own `gex.total` at spot: our closed-form BS gamma
assumes `r=q=0`, and the raw disagreement with the provider is 0.1–1.7% on single names but
9.5–21.7% on SPY/QQQ/IWM — **the gap is the dividend yield we do not model**
(`gex-depth-validate.mjs`, 2026-08-12).

### 4.7 Alerts

`VectorAlertsPanel` → `persistRules` writes **localStorage** (source of truth for the open tab)
and best-effort mirrors to `PUT /api/vector/alerts/rules` → `vector_alert_rules`.
`evaluateAlerts` (rising-edge + cooldown + hysteresis) runs client-side on each live tick. The
server half that would deliver to a **closed** tab is `/api/cron/vector-alerts` — see §7, it does
not run.

---

## 5. Precision — `VECTOR_FRACTION_DP` adoption

Every Vector read wraps its payload in `roundFloats(...)`, default `dp = 2`. That is right for the
dollar-scale majority and **destroys any field that is a fraction of one**.
`VECTOR_FRACTION_DP` (`vector-response-rounding.ts`) is the centralized override map. A centralized
fix is not adopted until every call site uses it, so here is the current census — verified
2026-08-22:

| Call site | Passes the map | Carries a fraction-of-one field |
|---|---|---|
| `/expected-move` | **yes** | `movePct`, `atmIv`, `dteDays` |
| `/pin-forecast` | **yes** | `pinPct`, `strengthPct`, `p`, `weight` |
| `src/lib/bie/vector-full-state.ts` | **yes** | via the embedded `expectedMove` |
| `/walls`, `/max-pain`, `/flow`, `/gex-ladder`, `/gex-heatmap`, `/bars`, `/daily-bars`, `/4h-bars`, `/prior-day` | no | none found — prices, 0–100 percents, OHLC |
| `vector-wall-sample.ts`, `vector-universe.ts`, `vector-daily-regime-server.ts`, `vector-snapshot.ts` | no | none found — strikes, 0–100 `pct` |
| **`src/lib/largo/vector-analytics.ts`** (`get_vector_analytics`) | **no** | **`fib_swing.retracements[].ratio`** and `golden_pocket.ratios[]` |

**The one live gap is small and it is real:** the Largo analytics payload serves the auto-fib
retracement ratios through a bare `roundFloats(...)`, so `0.382 → 0.38` and `0.786 → 0.79`. Unlike
the `movePct → 0` defect this does not zero a number and the price beside each ratio is unaffected,
so it is a **P4 cosmetic-precision** item, not a correctness one. It is recorded here because the
census, not the severity, is the point: `vector-analytics.ts` is the one Vector consumer that has
never imported the map, and the next fraction field added to it will land at 2dp.

---

## 6. The Largo boundary — three tools

`get_vector_full_state` · `get_vector_pulse` · `get_vector_analytics`.

`computeVectorFullState` (`vector-full-state.ts`) is ONE composer that fans out over the same reads
the chart surfaces, runs the **same pure derivers** the desk renders (`deriveVectorRegime`,
`deriveGammaMagnet`, `deriveWallProximity`, `scoreTopWalls`, `confluenceZones`), and attaches the
same `buildVectorPlay`. It reuses the canonical `VectorSnapshot` contract rather than inventing a
parallel shape, and it fails open **per field**.

This boundary is in good shape, and each of these is a defect already paid for:

| Property | Where | What it prevents |
|---|---|---|
| **C1 session anchor** | `asOf` + `asOfEt` + `sessionDate`, all from ONE `asOfMs` | after ~20:00 ET a bare UTC stamp is already tomorrow's date |
| **Freshness block** | `describeVectorFreshness` — `observed_at`, `age_seconds`, named verdict, plain-language note | a 15-min-old cached state read as live; reuses `freshnessFromAgeMs`, **not** a second scale |
| **Absence report** | `reportVectorAbsences` — `unavailable_sections[]` + `wall_history_empty_reason` | `expectedMove: null` becoming "NVDA has no expected move" |
| **Read-time labelling** | `withReadContext`, on the way OUT | a persisted age would freeze at zero and call every later read instantaneous |
| **No silent caps** | `servePreset` — `matched_universe`, `rankable_rows`, `excluded_no_metric`, `truncated` | a 15-row slice of a 55-name match served as the universe |
| **Scope honesty** | `coaching_scope: "not_applicable_non_spx"` | an SPX-only block reading as an outage on NVDA |

**Known open item:** `scripts/audit/largo-truncation-probe.mjs` has **not** been run against these
three tools. `get_vector_full_state` embeds the whole `wallHistory` rail (up to thousands of
5s rows) plus `ladder` and `wallEvents`, which is exactly the shape that silently truncated
`get_zerodte_record` to 1.5% of itself. **UNKNOWN → the highest-priority Phase 1 item.**

---

## 7. Crons — declared six, deployed four

Verified 2026-08-22 against the deployed EventBridge manifest
(`blackout-infra/terraform/modules/crons/cron-jobs.json` @ `68a0aa0f`, 39 rules) with
`scripts/audit/cron-dst-audit.mjs` and `cron-schedule-coverage.mjs`.

| Cron | Deployed UTC | ET gate | EDT / EST fires in window | Verdict |
|---|---|---|---|---|
| `vector-walls-warm` | `*/5 11-21 * * 1-5` | `isEtCashRth()` | 395 / 395 | **OK both offsets** |
| `vector-universe-snapshot` | `1-59/5 11-21 * * 1-5` | `isEtCashRth()` | 390 / 390 | **OK both offsets** |
| `vector-full-state-snapshot` | `2-59/5 11-21 * * 1-5` | `isEtCashRth()` | 390 / 390 | **OK both offsets** |
| `vector-dark-pool-warm` | `3-59/10 11-21 * * 1-5` | `isEtCashRth()` | 195 / 195 | **OK both offsets** |
| `vector-bead-record` | — | `isEtCashRth()` | — | **Unscheduled, deliberately** |
| `vector-alerts` | — | *(no ET gate in route)* | — | **Unscheduled and unexplained** |

The 11–21 UTC band brackets 09:30–16:00 ET in **both** offsets, so none of Vector's four deployed
crons has DST exposure. This is the first time Vector's crons have been checked against the
deployed manifest rather than the registry mirror.

**`vector-bead-record` is fine.** It is listed in `INTENTIONALLY_UNSCHEDULED` with its reason: the
primary 5s cadence is the in-process leader, which does run. The route's `railway.*.toml` still
declares `* 11-21 * * 1-5`, which is dead config — Railway does not exist any more.

**`vector-alerts` is a real gap, and it is this lane's.** `cron-schedule-coverage.mjs` lists it
under *"UNSCHEDULED AND UNEXPLAINED — a feature may be silently dark"*. What is actually true,
measured:

- it has **no deployed EventBridge rule**, so it never fires on a timer;
- **`VECTOR_ALERTS_PUSH` is not present** in `blackout-production/app/env` (98 keys, checked by
  name), so the route would return `{ok: true, inert: true}` even if it did fire;
- VAPID *is* fully configured and `GEX_ALERTS_PUSH = 1`, so the platform push channel itself is
  live and in use by another product — Vector's is the one that is not;
- meanwhile `VectorPageShell.persistRules` **does** mirror every member's rules to the DB, and its
  in-code comment states *"The mirrored copy is what `/api/cron/vector-alerts` reads to fire push
  alerts to a closed tab."*

So the feature is built end to end, the member's rules really are being written to Postgres, and
the delivery half is off in two independent places. **The UI does not lie about it** — the panel's
tooltip promises only *"while this tab is in the background"* — which is why this is a P3
(dormant-feature / stale-comment / unexplained-absence) and not a P1 broken promise. Correct fix is
one of: list it in `INTENTIONALLY_UNSCHEDULED` with the flag as the reason, or deploy + enable it
deliberately. Leaving it unlisted is exactly what that tool's own message warns about.

---

## 8. The trace — one bead, end to end

Required by the charter. A single wall-rail bead on SPX, 5s bucket, function named at each step:

1. `GET /api/market/vector/stream?ticker=SPX` → `authorizePremiumDeskApi` → `requireToolApi("vector")`
   → `tryAcquireVectorStreamConnection(MAX_STREAMS)` — `SSE_MAX_STREAMS` is **not** set in
   production, so the 2000 default holds — → `ensureDataSockets()` →
   `attachVectorStreamSubscriber("SPX")`.
2. `startTickerPoller` ticks `buildVectorStreamPayload("SPX")` at `TICK_MS = 1000`.
3. Inside it: `refreshSharedUniverseCacheIfStale()` → `resolveWallTrailSampleSec("SPX")` → **5** →
   `joinGexStrikeExpiryTicker("SPX")` (idempotent, leader-only UW WS subscribe).
4. `getVectorLiveCandle("SPX")` → forming candle + `updatedAt`. `getVectorGexWalls("SPX")` reads the
   900ms memo, refilled from the UW `gex_strike_expiry` ladder via `computeGexWalls`
   (`pct = |g| / Σ|g| × 100`, sorted desc); `getVectorVexWalls` the 8s vanna memo.
5. `gammaFlip` is served from `s.cachedFlip` and refreshed **behind** the response by
   `getGexPositioning("SPX")` when older than `FLIP_CACHE_MS = 5000` — never awaited inline.
6. Session boundary: `todayEtYmd()` ≠ `s.sessionYmd` ⇒ `s.wallHistory = []`, so a process surviving
   close→open cannot stitch yesterday's tail onto today's first bead.
7. `wallRailRecordingOpen()` (`isEtCashRth()`) **then** freshness (`nowMs − s.cachedWallsAt ≤
   STALE_RECORD_MAX_MS = 120s`). Both must pass.
8. `bucketWallSampleTime(floor(now/1000), 5)` → the bucket. `buildWallHistorySample({time, gexWalls,
   gammaFlip, vexWalls, vexFlip})` → one rounded row, or `null` if neither lens has walls.
9. `recordWallSample(s.wallHistory, sample)` (in-memory, budgeted) and
   `persistWallSampleDebounced(sessionYmd, sample, "SPX")` → Redis
   `vector:wall-history:SPX:{ymd}` (72h) + the write-through 15-day Postgres mirror.
10. On a bucket rollover only, `buildNarrowedHorizonWallSamples` computes the per-expiry
    `0dte/weekly/monthly` rails and persists them under their own horizon keys — so a narrowed rail
    costs one per-expiry recompute per bucket, not one per 1s frame.
11. `roundVectorStreamPayload` → the SSE frame, carrying `t`, `gexAsOf`, `vexAsOf`, `darkPoolAsOf`,
    `sessionYmd`, `wallTrailSec` alongside the values, so the client can tell four instants apart.
12. Client: `VectorChart` merges the frame into `wallHistoryRef` with `mergeWallHistory` and
    repaints the bead column. (`mergeModeledUnderlay` — a real sample overwriting a modeled one at
    the same bucket — is applied earlier, inside `vector-wall-history.ts`'s seed/backfill builders,
    not at frame merge.)

---

## 9. Where the prior art is now wrong

- **`vector-wall-history.ts`'s sample-budget comment** says *"the universe recorder is not
  RTH-gated, so an oracle ticker keeps writing every 5s all evening."* That described the state
  that motivated the eviction-policy fix; **all four writers now gate on `isEtCashRth()`**. The
  comment reads as a live description of the system and is not one.
- **`railway.vector-*.toml`** files still sit in the repo root declaring schedules. There is no
  Railway. The deployed truth is `blackout-infra`'s `cron-jobs.json`, and for two Vector crons the
  toml declares a schedule that does not exist.
- **`cron-registry.ts`** advertises `vector-bead-record` (`stale_after_min: 1`) and `vector-alerts`
  (`stale_after_min: 10`) as if scheduled. Neither is. The registry is a mirror, not the manifest —
  the same trap `cron-dst-audit.mjs` was written to close for the *timing* question.
- **`docs/vector/VECTOR-*-2026-07-11.md`** and `VECTOR-CTO-AUDIT-2026-08-05.md` predate the tier
  model, the `isEtCashRth` rail gate, the fraction-dp map, and the freshness/absence blocks.
  **UNKNOWN** how much of them still holds — not re-checked for this map.

---

## 10. UNKNOWNs — the Phase 1 queue, ranked

1. **Do Largo's three Vector tools survive `MAX_TOOL_RESULT_CHARS`?** `get_vector_full_state`
   embeds the whole rail. Run `largo-truncation-probe.mjs --tools=...` with a proven control.
2. **Every number, against Polygon, on a live tape.** Nothing in this file is a correctness claim
   about a served value — the market was closed. Walls, flip, expected move, max pain, magnet,
   ladder, universe rows.
3. **`vector-alerts`**: list as intentional, or deploy and enable. §7.
4. **The rail, watched accumulating.** A rail that starts from one bead, stalls, or back-fills
   wrongly is only visible on a moving tape. Also: what happens when the leader lock changes hands
   mid-session, given the backup cron is not deployed.
5. **The UI, at pixels.** `proxy-browser.cjs` at 1440 and 430, plus the `SpxVectorEmbed` view on
   `/dashboard` — one regression there breaks two surfaces. `depth-ladder-ui-audit.mjs` covers the
   Depth tab only.
6. **Performance**: full-state cache hit rate, universe-snapshot cadence vs actual staleness, and
   SSE latency measured separately from REST.
7. **`vector-analytics.ts` fraction-dp** (§5) — P4.
8. **`VectorChart.tsx` is 237KB in one file.** Not a defect; a stated risk. No claim here about
   what is inside it.
