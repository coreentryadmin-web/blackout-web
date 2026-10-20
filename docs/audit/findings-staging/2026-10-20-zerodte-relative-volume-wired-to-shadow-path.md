## 2026-10-20 — [FINDING, P3 Night Hawk 0DTE] RVOL shadow signal wired into a real evaluation path with persisted baseline-vs-candidate records — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Context.** Direct follow-up to `2026-10-19-zerodte-relative-volume-shadow-signal.md` (PR #6287,
merged). That PR shipped `src/lib/zerodte/relative-volume.ts` — a pure, fully-tested,
standalone RVOL function — but deliberately left it unwired, imported by nothing in the live
path. The operator correctly pushed back on treating that as done: *"Wire the RVOL function into
an actual shadow evaluation path and persist timestamped baseline-versus-candidate results. An
unused function is a tested component, not an operational shadow system."* This finding is that
wiring.

**Also addressed in the same pass, per explicit operator feedback on the original module:**
*"Use historical volume at the same time of day as the RVOL baseline where available. Simply
prorating daily volume evenly across the session can distort comparisons around the open and
close."* The original module used FLAT proration only (expected volume = avgDailyVolume ×
elapsed-fraction), which assumes a constant intraday pace — real volume is U-shaped (heavier at
the open/close, lighter at midday), so flat proration systematically overstates RVOL at the open/
close and understates it at midday.

### What changed

**1. `relative-volume.ts` — real time-of-day volume profile, additive.**
- New `buildTimeOfDayVolumeProfile(dailyMinuteVolumes: number[][])`: pure, averages a ticker's OWN
  real per-minute volume across >=5 trailing real trading days (`RVOL_PROFILE_MIN_DAYS`), takes the
  cumulative sum, normalizes — a real measured pace curve, never an assumed shape. Returns null
  (never fabricated) below the minimum real-day floor.
- `computeRelativeVolume` gained an optional `timeOfDayProfile` param: when supplied and
  well-formed, the expected-volume-by-now uses the real profile instead of flat proration; omitted
  or malformed → falls back to flat proration, byte-identical to the original shipped behavior
  (verified: the original 11 tests still pass unmodified).
- New `expected_fraction_source: "time_of_day_profile" | "flat_proration" | null` field on the
  result so a caller logging both reads side by side can tell which is which.
- 7 new tests (18 total, up from 11), including a direct demonstration that a real U-shaped pace
  front-loads more cumulative volume by midday than flat proration assumes, and that an ordinary
  open-minute volume reads `normal` under the real profile where flat proration would misclassify
  it `very_high`.

**2. `relative-volume-source.ts` (new) — the wiring layer.** Assembles the REAL inputs
`computeRelativeVolume` needs (today's cumulative volume, trailing avg daily volume, the
time-of-day profile) via Polygon, and computes BOTH the baseline (flat proration) and candidate
(real profile) reads side by side — the literal "log baseline and candidate signals side by side
before outcomes" instruction. Cost-disciplined for a live cron path (`zerodte-warm`, ~every 5 min):
the expensive minute-bar profile fetch is cached per ticker per session day (`sharedCacheGetWithTtl`/
`sharedCacheSet`, ~20h TTL) so it runs via a live fetch at most once per ticker per day, not once
per scan pass. Every fetch is try/caught; `computeRelativeVolumeShadow` never throws and degrades
to `null` (no shadow signal that commit) rather than ever blocking or failing a real commit.

A real bug was caught and fixed while building this: the cache helper initially used
`sharedCacheGet`, whose plain-`null` return cannot be distinguished from a true cache miss — so a
confirmed "no profile for this ticker today" verdict was silently NEVER actually cached, defeating
the whole point of caching it. Caught by a test asserting the profile fetch only runs once per
ticker per day; fixed by switching to `sharedCacheGetWithTtl`, whose wrapped `{value, ttl}` shape
makes a cached `null` distinguishable from a miss.

**3. `scan.ts` — the actual live wiring.** `persistZeroDteScan` now computes the shadow read for
every FRESHLY-committed setup (never `refresh` — avoids a repeated real Polygon fetch on every
5-minute refresh tick for an already-open position; the upsert's own COALESCE pin would discard a
refresh-lane recomputation anyway) and attaches it additively onto
`entry_context.shadow_signals.relative_volume`, in the exact same `...(x ? {...} : {})` idiom this
ledger already uses for `thesis_first`/`why_now`. `Promise.allSettled` wraps the batch as a second,
redundant safety net on top of `computeRelativeVolumeShadow`'s own try/catch, so one slow/hung
ticker's fetch can never block or fail the whole commit batch. **Still does not gate, score, or
alter entry/exit/stop/target in any way** — this is a diagnostic attachment only, exactly the
"keep member-facing behavior and existing hard stops unchanged" instruction.

### Evidence

- `relative-volume.test.ts`: 18/18 pass. RED→GREEN proven (reverted to the pre-change file,
  confirmed 7 new assertions fail; restored, confirmed 18/18 pass).
- `relative-volume-source.test.ts` (new, 4 tests): real behavioral tests mocking the Polygon fetch
  layer and shared cache per this repo's `mock.module` convention — assembles a real read end to
  end, confirms the cache prevents a second profile fetch, confirms a daily-bars or minute-bars
  fetch failure degrades to `null` rather than throwing or fabricating.
- `scan.test.ts`: 46/46 pass (unchanged) — the wiring is additive-only and does not alter any
  existing assertion about `entry_context`'s shape.
- `npx tsc --noEmit`: clean.
- All test runs executed on the REAL Node 20 binary (`/opt/node20/bin/node` — this sandbox's
  default `node` silently resolves to v22, which this repo's own environment notes document as
  producing phantom failures/missing real ones; re-verified on the correct binary after catching
  that mismatch mid-session).

### What this is NOT

Still not registered as a cortex source, discovery gate input, or scoring factor of any kind — the
module's own header (unchanged) still names that as a SEPARATE, explicitly-reviewed future PR, to
be opened only once real paired (reading, outcome) data justifies it. This PR makes that real data
start accumulating (`entry_context.shadow_signals.relative_volume.{baseline,candidate}`, joinable
against the same row's own `entry_context.exit`/graded outcome via the existing `/record` API) —
it does not act on it yet.

### Remaining / explicitly not done here

- The RVOL classification thresholds (`RVOL_VERY_HIGH`/`RVOL_HIGH`/`RVOL_LOW`) remain the
  originally-shipped, uncalibrated starting points — calibrating them against real outcomes is the
  explicit next step once enough shadow rows accumulate, not this PR's job.
- `AVG_DAILY_VOLUME_LOOKBACK_CALENDAR_DAYS`/`PROFILE_LOOKBACK_CALENDAR_DAYS` are reasonable,
  bounded starting windows (30 and 12 calendar days respectively) — not backtested against
  alternatives.
- No live CloudWatch/cron-invocation access this sandbox session to directly measure the real
  added latency this wiring contributes to a live `zerodte-warm` pass; the design (cached profile,
  Promise.allSettled, try/catch-everywhere, fresh-commits-only) bounds the WORST case but the
  actual production number is unmeasured here.
