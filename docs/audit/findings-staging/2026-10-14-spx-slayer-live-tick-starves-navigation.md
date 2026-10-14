> **kind:** FINDING

## SPX Slayer: ungated live-tick chart recompute starves navigation after sustained time on the page — FIXED

**Status** | FIXED

### Symptom (operator-reported, live)

A member reported needing to refresh the website every time they tried to click another feature
while on SPX Slayer specifically — screenshot showed a customer complaint in the same shape
("every time try to click other feature, you have to refresh the website all the time"). Narrowed
live: navigating away from SPX Slayer to any other desk silently does nothing — the URL never
changes, with **zero console errors, zero failed network requests, zero page errors** — but only
after the tab has been open and live for a while. A fresh tab navigates away instantly and cleanly.

### Root cause

`VectorChart.tsx`'s live SSE tick handler (the chart `SpxVectorEmbed` embeds continuously on SPX
Slayer) ran `displayBarsFromMinute()` (full non-incremental rebuild of the entire bar history,
`vector-bar-timeframes.ts`) plus two O(n) volume recomputations (`volumeHistogramData`,
`volumeAverageLineData`) **on every single live tick, ungated**. SSE ticks can arrive sub-second.

Live CDP profiling of a real, authenticated SPX Slayer tab (15 consecutive 1-minute samples via
`Performance.getMetrics()`) measured `TaskDuration` increasing by ~60s of main-thread work in
every single 60s wall-clock window — the main thread was continuously ~100% busy, with **zero**
user interaction and the market closed overnight (so this isn't even driven by real price
movement — the recompute fires regardless). DOM node count stayed flat the whole time (18,690 →
18,693), ruling out a classic DOM/array leak; the cost is pure repeated CPU churn, not growing
state.

Next.js's `<Link>` client-side navigation runs inside React's `startTransition`, which is
explicitly low-priority and interruptible. With the main thread continuously saturated by this
ungated per-tick rebuild, the navigation transition never gets an uninterrupted window to commit —
it's repeatedly discarded and restarted, forever, as long as ticks keep arriving faster than one
transition can land. This produces exactly the observed symptom: the click registers (browser-level
input handling isn't starved), but the RSC fetch a completed transition would trigger never fires,
so there's nothing in Network or Console — and it scales with time-on-page, not any specific user
action, since tick volume compounds with uptime.

Confirmed via three independent live reproductions this session (two ~1hr sessions, one dedicated
15-minute CDP-profiled session) — all three showed instant/clean navigation from a fresh tab and
stuck navigation from a sustained one, with the 15-minute profiled run directly measuring the
near-100% main-thread occupancy underlying it.

### Fix

Throttled the live-tick display-bar/volume recompute to a minimum 200ms interval (5Hz —
imperceptible as a price feed, but bounds the O(n) rebuild's cost regardless of actual tick
frequency): `VECTOR_LIVE_TICK_DISPLAY_RECOMPUTE_THROTTLE_MS` + `liveTickDisplayRecomputeDue()` in
`src/features/vector/lib/vector-cadence.ts` (this file is already the single source of truth for
every other Vector live-data cadence constant), gating the existing block in `VectorChart.tsx`'s
SSE handler via a new `lastDisplayRecomputeAtRef`. No behavior change to the aggregation logic
itself — only how often it's invoked. `displayBarTimeRef` (also written in the throttled block) was
confirmed read nowhere else in the codebase, so the throttle has zero downstream timing
dependency.

**Why this fix and not a deeper incrementalization of `displayBarsFromMinute`/
`aggregateVectorBars`:** a genuinely incremental rebuild (only recompute the forming bucket instead
of the whole history) is the architecturally "correct" long-term fix, but it's a materially larger,
riskier change to a 5,800-line, heavily shared chart component used across multiple desks
(Vector proper, SPX Slayer embed, compare-mode). The throttle is a single, narrowly-scoped gate
around the already-identified expensive block, verified via live profiling to target the actual
measured mechanism, with no behavior change elsewhere in the handler (wall history diffing, spot
structure events, overlay refresh all remain ungated and unaffected).

**Blast radius:** `VectorChart.tsx` is shared by the standalone Vector desk and compare-mode panes
in addition to the SPX Slayer embed — all benefit from the same fix, since all mount this same SSE
handler continuously.

### Evidence

- RED→GREEN: `src/features/vector/lib/vector-cadence.test.ts` — 4/6 new assertions fail with
  `liveTickDisplayRecomputeDue is not a function` when the implementation is stashed; all 6 pass
  restored (git-stash verified this session).
- `npx tsc --noEmit`: clean.
- `npm test`: 15,964 pass / 0 fail / 3 skipped (full suite, Node 20).
- Live CDP profiling data (15 one-minute samples, `TaskDuration` delta ≈59.9s in every window):
  recorded in this session's investigation, not re-pasted here — see PR description for the full
  table.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` for the next-session RTH check: confirm SPX Slayer's
price/volume chart still updates visibly live (no perceptible lag from the 200ms throttle) under
real intraday tick volume, and confirm navigating away from a long-open SPX Slayer tab during RTH
now succeeds.
