# Vector bead cadence investigation — 2026-08-19

**Question:** “Why is Vector broken? I don’t see beads every 5 seconds.”

**Verdict:** On current `main`, the **recorder and SSE contract are 5s for universe tickers**. What members often experience as “missing beads” is usually a **display / viewport / membership / recent-regression** issue — not a dead recorder. One shipped paint change (#2321) **did** silently discard most samples; it was **reverted same day** (#2326).

**Probe window:** 2026-08-19 ~00:53 ET (off-hours). Cadence probes ran live against prod; gap analysis needs RTH replay.

---

## Executive summary

| Layer | 5s beads? | Notes |
|-------|-----------|-------|
| **Universe recorder** (background, ~122 tickers) | Yes — `VECTOR_BEAD_RECORD_TICK_MS = 5000` | Append-only rails since #2322; every horizon every tick |
| **SSE `wallTrailSec`** | Yes for SPX/NVDA/META/AMD/TSLA (probed live) | Was 15s for non-oracle until Aug 2026 fix in `vector-wall-sample-server.ts` |
| **Client paint (`displayBucketSec`)** | Yes during live session | #2321 pixel-stride bucketing **reverted** #2326 — draw every recorded sample |
| **What you *see* on chart** | Often **not** one dot every 5s per row | Membership hysteresis, live-follow 45m trim, DTE horizon, zoom/timeframe, Compare 4-up |

**Off-hours note:** Live probe at 00:53 ET returned **0 wall-history samples** for SPX/SPY/QQQ/NVDA — expected pre-RTH. Walls endpoint still returns current ladder; trail builds once RTH recording starts.

---

## Live evidence (prod, 2026-08-19 off-hours)

### SSE cadence contract — PASS

```
node --import tsx scripts/audit/vector-wall-trail-sec-validate.mjs --tickers=SPX,NVDA,META,AMD,TSLA
```

| Ticker | `wallTrailSec` | Expected |
|--------|----------------|----------|
| SPX | 5 | 5 |
| NVDA | 5 | 5 |
| META | 5 | 5 |
| AMD | 5 | 5 |
| TSLA | 5 | 5 |

All universe names report **5s** on the stream frame. The Aug 2026 bug where the SSE hub re-stamped universe tickers at 15s is fixed (`vector-wall-sample-server.ts` static-universe test).

### Wall-history density — empty pre-open

```
node --import tsx scripts/audit/vector-bead-probe.mjs
```

- `wall-history` **200** but **0 samples** for SPX/SPY/QQQ/NVDA (session date 2026-08-19).
- Current walls present (20 call / 20 put on SPX; NVDA 20/4).
- SSE stream carried candles but **no history tail** in first 10s off-hours.

**Interpretation:** Not a regression — beads accumulate during the session. Opening Vector before 09:30 ET shows candles + current walls but an empty trail until the recorder’s first buckets land.

---

## Why it *looks* broken (even when recording is fine)

### 1. #2321 briefly made the chart lie (FIXED #2326)

**Shipped:** `displayBucketSec` bucketed by **pixels** (~11px stride) so zoomed-in rows would not fuse.

**Member feedback (on record before revert):** “It’s painting a bead every 5 seconds which is correct … at the end of the day it looks like a bar.” After #2321: **one bead per ~15 candles** vs reference product’s dense ribbon.

**Mechanism:** A 3m candle at normal zoom ≈ 5.4px wide → 36 samples/bar at 5s cadence. Pixel bucketing kept ~1 bead per 11px → **~34/36 samples discarded at paint time**. Silent data loss reads as “recorder broken.”

**Current `main`:** Reverted. Live session uses recorder cadence (`minBucketSec`, floored by candle width). Size adapts via `clampTuningToSpacing`; **count** is the data.

### 2. Row membership hysteresis — holes *inside* a row (#2309)

The recorder writes **20 strikes per side every bucket**. The renderer does **not** draw all 20 every tick.

`vector-wall-membership.ts` keeps a strike alive across buckets with enter/hold/grace ranks. A strike that drops out of the top-N for a bucket emits **nothing** for that bucket — intentional, not backfilled.

Measured 2026-08-18 (before fix): SPX mean row fill **0.35** at cap=5 (two-thirds of buckets empty per row). After hysteresis at holdRank=8: **~0.77** fill.

**What members see:** A row exists, but dots are **not** every 5s along it — gaps are **selection**, not missing Redis samples.

### 3. Viewport mode — session vs live-follow (#1844 / #2184 class)

| Mode | Bead time domain |
|------|------------------|
| **Session overview** (default load, live-follow OFF) | Full ET session rail |
| **Live-follow** ON | `trimHistoryForLiveTrails` → **last 45 minutes only** |

If live-follow is enabled, mid-session history vanishes from the chart even though Redis holds the full rail. Candles may still show the whole day depending on zoom.

**Fixed 2026-08-14:** Session viewport no longer applies 45m trim when `wantsSessionOverviewViewport("session", false)`.

### 4. DTE horizon — “All” vs narrowed

- **DTE = All (blended):** Chart reads the **5s universe recorder rail** — densest path.
- **0DTE / weekly / monthly:** Separate composite keys; narrowed rails were historically sparse for unviewed names (#2322 fixed write rationing).

Default for non-oracle tickers is now **All** (was weekly → sparse weekly rail for META/NVDA).

### 5. Compare 4-up — background panes half speed

`VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER = 2` — unfocused quadrants poll overlays at **2× interval** (10s effective for 5s tickers).

### 6. Sweep budget history (mostly fixed #2320 / #2324)

Shared universe ≈122 tickers; sweep runs every 5s. When concurrency limit < roster size, tickers were **fair-rotated** but still only half recorded per tick → **10s median gap** (measured 2026-08-07 on AMD/TSLA/META).

Fix trajectory on `main`:
- #2320 — rotate roster (fairness, still rationing)
- #2324 — separate in-flight max from pool width; **serve whole roster every 5s**
- #2322 — append-only Redis writes; narrowed horizons no longer minute-rationed

SPX/SPY masked the defect because oracle tickers also get SSE live-scope 5s writes.

### 7. Non-universe tickers — 15s by design

Tickers outside static allowlist + dynamic universe cap: **15s** trail (`VECTOR_NON_UNIVERSE_WALL_TRAIL_SEC`). Only recorded while someone has Vector open (active lane).

---

## Cadence source of truth (code map)

| Constant / function | Value | File |
|---------------------|-------|------|
| `VECTOR_WALL_TRAIL_SEC` | 5 | `vector-cadence.ts` |
| `VECTOR_NON_UNIVERSE_WALL_TRAIL_SEC` | 15 | `vector-cadence.ts` |
| `VECTOR_BEAD_RECORD_TICK_MS` | 5000 | `vector-bead-recorder-logic.ts` |
| `wallTrailSampleSecForTicker(..., "universe")` | 5 | `vector-wall-sample-server.ts` |
| `LIVE_TRAIL_LOOKBACK_SEC` | 45 × 60 | `vector-wall-history.ts` |
| `displayBucketSec` (live) | `min(candleSec, minBucketSec)` | `vector-wall-history.ts` |

Recorder leader: `vector-bead-recorder-leader.ts` (Redis elected, 5s tick, drops overlapping sweeps).

---

## Recent `main` commits (bead-related, newest first)

```
80572a35 fix(vector): draw every recorded bead again — revert pixel-stride (#2326)
788d2058 fix(vector): serve WHOLE roster every 5s (#2324)
b0661027 fix(vector): every universe ticker every rail every 5s (#2322)
b03e681b fix(vector): bucket beads by pixels (#2321)  ← reverted
2ae78793 fix(vector): rotate bead recorder roster (#2320)
ceb0292a fix(vector): bead row lifecycle hysteresis (#2309)
```

---

## Recommended validation (RTH)

Run during 09:35–16:00 ET:

```bash
# Cadence contract on stream + REST
node --import tsx scripts/audit/vector-wall-trail-sec-validate.mjs --tickers=SPX,NVDA,META

# Wall-history gap histogram
node --import tsx scripts/audit/vector-bead-probe.mjs

# Full surface + cadence poll
node --import tsx scripts/audit/vector-live-e2e.mjs --tickers=SPX,NVDA,META,TSLA
```

**Pass criteria (universe tickers):** median inter-sample gap **≤ 7s** (5s + jitter); p90 **≤ 15s**. Sustained 10s median → sweep still dropping ticks (check CloudWatch `vector-bead-recorder` leader logs for `deferred` / `busy`).

**UI checklist for member reports:**
1. DTE horizon = **All**?
2. Live-follow **off** for full-session view?
3. Compare 4-up — is this ticker a **background** pane?
4. Timeframe — 3m at session zoom shows **ribbon** (touching beads), not isolated dots?
5. NODES row cap — fewer rows, same cadence per row?

---

## Answer to “is Vector broken?”

**Recorder / contract on `main`:** No — universe names are spec’d and probed at **5s**; the worst recent regression (#2321 paint decimation) is **reverted**.

**Member-visible chart:** Can still look “broken” because:
- rows are **sparse within themselves** (membership hysteresis — by design),
- **live-follow** hides history,
- wrong **DTE** horizon,
- **off-hours** empty trail,
- or **Compare** background throttling.

None of those mean the 5s recorder stopped; they mean the **path from Redis sample → pixel** filtered or trimmed what you see.

---

## Follow-ups (if RTH probe fails)

1. Leader sweep `elapsedMs` > 5000 sustained → tune `VECTOR_BEAD_RECORD_CONCURRENCY` or shard replicas.
2. Single-ticker dark rail with `failedTickers` in leader metrics → per-ticker heatmap timeout.
3. Post-deploy mixed ECS builds (#2319) → self-reload / stale client; confirm single task definition on `/api/health` build sha.

**Status:** Investigation doc only — no product code in this PR.
