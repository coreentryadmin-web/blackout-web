> **kind:** FINDING

## Ask Largo swing play-brief's HELIX flow anomaly line read as a flat self-contradiction of the tape line right above it — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo (coordinator sweep, standing ownership mandate) |
| **Severity** | P2 (a Largo-facing narrative reads as internally contradictory — Largo Product Contract point 1, time) |
| **File** | `src/lib/swing/play-brief-narrative.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-absence.ts` |

### Root cause

`flowNarrative()` (`play-brief-narrative.ts`) builds the "Trade manager read" section's HELIX tape
sentence from `trustedHelixFlow(ctx.ecosystem)` — a **6-hour** rolling window (`flow.window_hours`)
— then immediately appends a second, unrelated fact in the same sentence:
`ctx.ecosystem?.recent_anomalies?.[0]`, which `ecosystem-context.ts`'s own doc comment
(`recent_anomalies: "Pattern-detected flow anomalies ... from the last 24h."`) declares is a
**24-hour** feed. The two reads can legitimately disagree in direction — the last 6h can be
call-heavy while an anomaly detected earlier in the same 24h window was a put surge — without
either being wrong. Concatenated with no time label, the two clauses read as one flat, undated
statement about "the tape," which presents as a direct contradiction rather than two different
reads at two different times. `play-brief-intel.ts`'s "Flow anomalies" bullet list carried the
same gap — `a.detected_at` was available on every `EcosystemAnomaly` row but never rendered.

### Evidence

Live repro, 2026-09-16 (`GET /api/market/swing/play-brief?playId=SWING:CRWD&ticker=CRWD&positionId=39&status=HOLD`,
authenticated, real committed HOLD position): the "Trade manager read" section rendered —

> **HELIX tape** (6h) — **call-heavy** · calls $376K · puts $0 · 1 prints. Flow stepping in on the
> call side **supports** the long swing. Latest anomaly: **DIRECTIONAL_FLOW_SKEW** — CRWD:
> one-sided put flow — $0.7M puts vs no call premium.

Read literally: "call-heavy, $376K calls, $0 puts, supports the long" immediately followed by
"one-sided PUT flow, $0.7M puts, no call premium" for the same ticker with no indication these are
two different measurement windows. A member (or Largo, reasoning over this text) has no way to
tell the anomaly is a stale, separate-in-time signal rather than the tape flatly contradicting
itself one sentence later.

### Blast radius

Two call sites read `recent_anomalies` without its `detected_at`: `flowNarrative()`
(`play-brief-narrative.ts:326-329`, the "Trade manager read" tape sentence) and the "Flow
anomalies" bullet list in `play-brief-intel.ts:573-580`. Both fixed with the same new helper
rather than two divergent inline date-math implementations.

### Fix rationale

Added `relativeAgeLabel(isoTimestamp, nowMs?)` to `play-brief-absence.ts` beside the existing
`ageSecondsLabel` — same null-safety/clock-skew discipline (`null` for missing/unparseable,
`"clock-skewed"` for a negative age), but renders "Nm ago"/"Nh ago" rather than raw seconds, since
`recent_anomalies` spans up to 24h and a seconds label would be unreadable at that scale.
`flowNarrative()` now labels the anomaly line `Earlier anomaly (Nh ago): ...` (renamed from
"Latest anomaly" — "latest" implied currency the 24h-old fact doesn't have) so it reads as a
distinct, dated read rather than a live contradiction of the sentence before it.
`play-brief-intel.ts`'s bullet list appends `[Nh ago]` per anomaly for the same reason. Did not
attempt to reconcile or filter conflicting anomalies against the tape's own bias — cross-product
disagreement is supposed to be represented, not reconciled by the lane itself (Largo Product
Contract), so the fix is purely presentational: give the reader (or Largo) what it needs to tell
the two reads apart, not decide which one wins.

### Tests

`src/lib/swing/play-brief-absence.test.ts` — 4 new tests for `relativeAgeLabel` (null/undefined/
unparseable → null, sub-hour → "Nm ago", hour-plus → "Nh ago", future/clock-skewed → "clock-skewed").
Full `src/lib/swing/*.test.ts` suite: 1215/1215 pass (was 1211 before). `tsc --noEmit` clean.
