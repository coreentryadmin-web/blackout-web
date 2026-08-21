# Vector bead cadence investigation — 2026-08-19

**Question:** “Why is Vector broken? I don’t see beads every 5 seconds.”

**Verdict (CORRECTED 2026-08-19, see “What this investigation got wrong” below):** the **recorder and SSE contract are 5s for universe tickers** — every probe below stands. But the original conclusion, that the remaining gaps were viewport/membership/configuration, was **wrong**: the RENDERER was hard-capped at **one bead per candle** for every ticker at every zoom, independent of everything measured here. Root cause and fix: #2328. The paint decimation this doc did catch (#2321, reverted #2326) was a second, additive loss stacked on top of that cap.

**Probe window:** 2026-08-19 ~00:53 ET (off-hours). Cadence probes ran live against prod; gap analysis needs RTH replay.

---

## Executive summary

| Layer | 5s beads? | Notes |
|-------|-----------|-------|
| **Universe recorder** (background, ~122 tickers) | Yes — `VECTOR_BEAD_RECORD_TICK_MS = 5000` | Append-only rails since #2322; every horizon every tick |
| **SSE `wallTrailSec`** | Yes for SPX/NVDA/META/AMD/TSLA (probed live) | Was 15s for non-oracle until Aug 2026 fix in `vector-wall-sample-server.ts` |
| **Client paint (`displayBucketSec`)** | Yes during live session | #2321 pixel-stride bucketing **reverted** #2326 — the bucketer keeps every recorded sample |
| **Canvas projection (`WallRailPrimitive`)** | **NO — one bead per candle, until #2328** | `ts.timeToCoordinate(bucketTime)` resolves only times present in the SERIES data, so 35 of every 36 5s buckets returned `null` and were dropped by a `continue` commented as an off-screen skip |
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

---

## What this investigation got wrong — and the lesson worth keeping

This doc originally concluded *“recorder OK, display filters explain the gaps”* and listed viewport
mode, membership hysteresis, DTE horizon and Compare throttling as the causes. **Every probe it ran
passed, and the conclusion was still wrong.** The renderer could not draw more than one bead per
candle:

```ts
// vector-wall-rail-primitive.ts, before #2328
const x = ts.timeToCoordinate(p.time as Time);
if (x == null) continue; // "off-screen bucket — skip (its neighbours still draw)"
```

`timeToCoordinate` resolves a time to a pixel **only when that time exists in the series data**. The
bar grid is 3-minute candles; the bucket grid is 5 seconds. 35 of every 36 buckets are therefore not
bar times, it returned `null` for each, and that `continue` — commented as an off-screen skip, which
is exactly what it looks like — discarded them. On any ticker, at any zoom, all session.

**Why the probes could not see it.** Everything this doc measured sits UPSTREAM of the canvas:

| Layer probed | Result | Could it have caught the cap? |
|---|---|---|
| Recorder tick / roster | 5s, whole roster | No — writes Redis |
| SSE `wallTrailSec` | 5 for every universe name | No — a contract field |
| `wall-history` REST | SPX 3964 samples, median gap 5s | No — serves what was written |
| `bucketWallHistoryForInterval` | keeps all 720 of an hour | No — returns an array |
| **Pixels on the canvas** | **never measured** | **yes — the only layer that could** |

A green result at every layer above the failing one is not evidence of health; it is the *shape* of a
last-hop bug. The correct response to “all my probes pass but the member still sees it” is to probe
one layer FURTHER DOWN, not to reclassify the report as a configuration issue.

**Standing rule this earns:** a cadence claim is only closed by counting **rendered beads**, not
samples. `scripts/audit/vector-bead-pixel-audit.cjs` clusters drawn bead pixels off the real canvas
and is the only tool in the kit that can falsify “beads render every 5s”. Note it must run at a zoom
where beads resolve, and against a screenshot stamped with the build that served it
(`vector-rail-visibility-shot.cjs`) — a capture taken mid-rollout is evidence of nothing and looks
exactly like evidence of something.

**What stands unchanged.** Sections 2–5 and 7 below (membership hysteresis, live-follow 45m trim,
DTE horizon, Compare 4-up throttling, non-universe 15s) are real, verified against `main`, and
independent of the renderer cap. They are genuine reasons a row can be sparser than the recorder —
they were simply not the reason for THIS report.

## Why it can *still* look sparse (independent of the renderer cap)

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
4. Timeframe — 3m at session zoom shows **ribbon** (touching beads), not isolated dots? *(Only true from #2328 onward. Before it, isolated dots were the CORRECT symptom of the renderer cap, not a member misconfiguration — do not send a member hunting through settings for this.)*
5. NODES row cap — fewer rows, same cadence per row?

---

## Answer to “is Vector broken?”

**Recorder / contract on `main`:** healthy — universe names are spec’d and probed at **5s**.

**Renderer:** it WAS broken, and none of the probes above could see it — capped at one bead per
candle until #2328. #2321’s paint decimation (reverted #2326) was an additional loss on top.

**Member-visible chart:** Can still look “broken” because:
- rows are **sparse within themselves** (membership hysteresis — by design),
- **live-follow** hides history,
- wrong **DTE** horizon,
- **off-hours** empty trail,
- or **Compare** background throttling.

None of those mean the 5s recorder stopped; they mean the **path from Redis sample → pixel** filtered
or trimmed what you see. That path is exactly where the real defect lived — at its very last step,
which is the one step this investigation never measured.

---

## Follow-ups (if RTH probe fails)

1. Leader sweep `elapsedMs` > 5000 sustained → tune `VECTOR_BEAD_RECORD_CONCURRENCY` or shard replicas.
2. Single-ticker dark rail with `failedTickers` in leader metrics → per-ticker heatmap timeout.
3. Post-deploy mixed ECS builds (#2319) → self-reload / stale client; confirm single task definition on `/api/health` build sha.

## Competitor comparison — strength swell/fade along a row (member screenshot 2026-08-19)

### What the reference product shows (red circles)

On SPY, each horizontal bead **row** is a time series at one strike. Beads **swell vertically** where that strike’s gamma share was heavy at that moment, and **thin + dim** where it was weak. Reading left→right on one row answers: *“When was this level hot, and when did it die?”*

That is the core job of the rail — not just “a wall existed here.”

### What BlackOut is supposed to do on `main` (post #2312 / #2313)

The canvas rail (`WallRailPrimitive`) uses **two channels on purpose**:

| Channel | Input | Question it answers |
|---------|--------|---------------------|
| **Size (radius)** | Raw `pct` at that bucket via `beadRadiusForPctShare` | “How big was this wall **at that moment**?” (absolute share of the book) |
| **Brightness** | `pct` vs **that bucket’s** king via `maxPctByTime` | “How much did it **dominate the board right then**?” |
| **Velocity** | `beadModulation` (fast bucket + slow 15m trailing ref) | “Is it **stacking or bleeding** right now?” |
| **Recency** | `ageTaperAlpha` on alpha only | “How **old** is this sample?” (not strength) |

So along one row, a wall that went **20% → 2%** over the session should render **fat bright beads early, thin dim beads late** — same idea as the competitor circles.

**Deliberate constraint:** we do **not** re-tint old beads using **today’s** strength. A bead at 10:15 stays a statement about 10:15. That avoids the old kingStrike bug (crown painted retroactively across history).

### Why ours still reads “all beads look alike” (three remaining gaps)

**1. This exact report was filed and fixed in code — but visual sign-off is still open**

FINDINGS 2026-08-18 (#2312): *“Against the reference product a single row visibly SWELLS and FADES… Ours rendered every bead in a row alike.”* Fix: split size vs alpha curves, point-in-time contrast (#2313), spacing budget correction.

That entry ends with: **“Still unverified visually at time of writing.”** Code landed; desk-side before/after on SPY/NVDA may not have been closed.

**2. Spacing budget vs dynamic range (the tradeoff that keeps biting us)**

At 3m zoom (~5.4px/bar), `clampTuningToSpacing` caps bead radius so rows don’t bury candles. Tests require `halfMax - halfMin >= 1px` — a **1px size range** is technically “passing” but **human-invisible**. When the ceiling collapses, every magnitude maps to one thickness → flat row (looks like competitor’s opposite).

`BEAD_BAR_FILL = 2.4` allows horizontal overlap (touching ribbon, like reference). Side effect: overlapping circles **union** to the max thickness in that stretch — a row of varying radii can still **look** uniform (slab texture).

**3. Velocity modulation is subtle vs competitor swell**

`decayModulation` / `growthModulation` move size by at most ~±22–28% **on top of** the pct ladder. If `pct` in the payload is flat (wall stays ~same share all day), modulation stays neutral. The competitor swell in the screenshot is mostly **absolute strength over time** (pct changing), not a separate velocity channel.

### What to check on desk (SPY, session overview, DTE All, 3m)

Pick **one circled row** in the competitor shot — same strike on our chart:

1. Hover/scrub time → does `pct` in the payload actually move (e.g. 8% → 2%) or stay flat?
2. Do bead radii change along that row, or is every dot the same px height?
3. If data moves but pixels don’t → **render budget** still crushing the size channel (regression or deploy skew).
4. If data is flat → **upstream wall ladder** not changing enough at that strike (data/GEX path, not paint).

### Recommended product fix (future PR — not in this doc PR)

Priority order if visual check fails:

1. **Strength-over-time sizing:** map bead **height** to `pct / trailingPeakPct` on the same strike (self-relative swell like the screenshot), while keeping absolute pct for cross-strike comparison.
2. **Spacing:** decouple vertical swell from horizontal overlap — e.g. allow taller beads without wider diameter (competitor reads vertical thickness, not circle union).
3. **Widen enforced size range** at 3m — test `halfMax - halfMin >= 3px` at measured geometry, not 1px.
4. **RTH visual gate** in CI or audit screenshot script — encode the competitor criterion: same-row early vs late bead height ratio ≥ 2× when pct ratio ≥ 3×.


---

**Status:** Reference doc. The defect it originally cleared is fixed in #2328; this doc is kept
because its layer map, its list of independent sparsity causes, its swell/fade comparison, and its
record of a green-probe false negative are all worth having.

**One correction to the section above, now that the renderer cap is known.** Its three "remaining
gaps" for why a row reads uniform were written while the rail was still drawing at most ONE BEAD PER
CANDLE, so the first thing to re-check on desk is no longer the size budget — it is whether the row
now has enough beads to swell across at all. A row of ~130 beads (one per 3m candle over a session)
cannot show a swell that happens over ten minutes; a row of ~4700 (one per 5s) can. Re-run the
"what to check on desk" list against a post-#2328 build before acting on items 1-4 of the recommended
fix, or the measurement will attribute a sampling limit to the sizing curve.
