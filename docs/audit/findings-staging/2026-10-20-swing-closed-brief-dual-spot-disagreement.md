## A CLOSED swing play-brief showed two disagreeing "current" underlying spot prices in the same envelope, neither flagging the other — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | Fixed (`src/lib/swing/play-brief-intel.ts`) |
| **Found via** | Ask Largo standing audit mandate (5-engine monitor cycle), live CLOSED play-brief sweep |

### Live repro

`GET /api/market/swing/play-brief` for `SWING:TSLA` (positionId 57, status CLOSED) rendered:

- **"Chart technicals"**: `Spot: **368.95**` (raw `vec.spot`, Vector's own stale snapshot)
- **"GEX posture"** / **"Since it closed"**: `spot **367.43**` (the GEX-matrix fallback spot via
  `preferredGexWalls`)

1.52 pts / 0.41% apart, both framed as the position's "current" read with near-identical disclosure
text ("_Current chart read — not the technicals this trade closed under._" vs "_Current dealer
posture — not what this trade traded under._") — neither section's text acknowledges the other
disagrees. A trader reading top-to-bottom gets two different "where it trades now" numbers in one
brief with nothing telling them which is fresher.

### Root cause

`chartTechnicalsSection`'s CLOSED-bucket branch deliberately bypasses the early return that
normally suppresses the whole section when `vectorSnapshotStale()` is true (`if (vectorStale &&
bucket !== "closed") return null` — a correct, intentional 2026-10-17 fix so CLOSED briefs don't
vanish once Vector goes stale, which is the common case by the time a position closes). But once
past that gate, the section rendered the raw, stale `vec.spot` **unconditionally** for its own
"Spot:" line and VWAP above/below comparison.

Meanwhile `gexPostureSection`/`chartLevelsSection` (same envelope, same stale condition) already
resolve "the" current spot through `preferredGexWalls()`: prefer the live Vector spot, fall back to
the GEX matrix's own spot when Vector is stale. This is the exact same "two different precedence
rules for one conceptual level" defect class the king-strike (2026-09-09) and call/put-wall
(2026-09-11, MSTR:33) fixes in this same file already cover — it was just never applied to spot
itself, because spot is read directly off `vec.spot` in `chartTechnicalsSection` rather than
through the shared resolver the sibling sections use.

### Fix

`chartTechnicalsSection` now computes `displaySpot = vectorStale && ctx ? preferredGexWalls(ctx).spot
: vec.spot` and uses it for both the "Spot:" line and the VWAP above/below comparison. Since the
early return above already excludes every case except CLOSED-with-stale-Vector from reaching this
point, this only changes that one path; callers that don't pass `ctx` (none in production — the
real call site always does) keep the old raw-`vec.spot` behavior unchanged, matching how every
other `ctx`-gated read in this file already degrades gracefully.

### Blast radius

Single function, single file. `preferredGexWalls` was already exported and already computed exactly
this fallback for its sibling sections — no new logic, just reusing the existing resolver at one
more call site. No other caller of `chartTechnicalsSection` passes a different `vec`/`ctx` pair (the
only non-test caller, `buildIntelSections` in the same file, derives both from the same `ctx` via
`vectorOf(ctx)`).

### Regression test

Added to `src/lib/swing/play-brief-intel.test.ts`: a CLOSED brief with Vector stale (10 min old,
`dataAgeMs` past `VECTOR_STALE_MS`) and a fresh GEX matrix reproduces the live TSLA:57 numbers
(Vector spot 368.95 vs GEX-matrix spot 367.43) and asserts `chartTechnicalsSection` now shows the
SAME 367.43 `gexPostureSection` shows, never Vector's stale 368.95, and that the VWAP above/below
call agrees with the displayed spot.

RED→GREEN proven via `git stash` isolation on `play-brief-intel.ts` alone (pre-fix: `Spot:
**368.95**` / "price above session VWAP"; post-fix: `Spot: **367.43**` / "price below session
VWAP" — the live, correct answer). Full `play-brief-intel.test.ts`: 271/271 pass. `tsc --noEmit`:
clean. No other test file calls `chartTechnicalsSection` or `preferredGexWalls`.
