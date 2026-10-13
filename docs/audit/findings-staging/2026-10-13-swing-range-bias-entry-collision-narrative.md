## 2026-10-13 — [FINDING, P3 product-enhancement, Ask Largo / Night Hawk Swings] WATCH play-brief never flagged an entry trigger colliding with Vector's own range-fade rail — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `src/lib/swing/play-brief-narrative-coaching.ts` (Ask Largo swing play-brief, WATCH-bucket Trade manager read) | P3 — trader-clarity gap, no gate/logic change | FIXED — `rangeBiasEntryCollisionCoaching`, wired into `collectCoachingBullets` |

**What's wrong.** Raised by a prior Ask Largo deep-audit session as a live-repro enhancement idea
(PR #4076 comment 6131711926, unanswered by Cursor for 8.5+ hours before this session picked it
up): a live-audited WATCH candidate, `SWING:SNOW` (2026-10-12), is a LONG pullback-continuation
setup with entry trigger **369.49**. The same brief's Vector desk read is `POSITION · range —
fade extremes toward 350 range mid`, with an explicit entry zone `buy dips 330 · sell rips 370`.
The swing's entry trigger (369.49) sits essentially right inside Vector's own "sell the rip" zone
(370, the same price as the GEX call wall) — the setup wants to buy almost exactly where Vector's
own dealer-gamma-structure read says breakouts get faded in a long-gamma regime. Nothing in the
brief surfaced this: a member watching this setup had no way to know their planned entry collides
with the specific rail the desk reading dealer structure would fade.

**Root cause / why it wasn't already covered.** `crossDeskCoaching`/`vectorPlayCoaching` (same
file) only treat Vector as a directional conflict/alignment signal when `vp.bias === "long"` or
`"short"` — a `"range"` bias correctly gets neither framing, per an existing 2026-09-15 fix
(live TDOC/ASAN repro: "no opinion" ≠ disagreement, a real and correct fix for the general case).
But a range bias *with specific numeric levels* is a narrower, still-checkable claim that fix never
addressed: nothing compared the swing's own `entryTriggerUnderlyingPx` against Vector's own
range-fade rails. `entryZone` (`vector-play-engine.ts`) is only a pre-formatted string ("buy dips
330 · sell rips 370") — but the underlying call-wall/put-wall numbers it's built from are already
on the envelope via the GEX-levels path every other wall-citing bullet in this file already reads.

**Fix.** New pure function `rangeBiasEntryCollisionCoaching(ctx, play, bucket, vec, readMs)`
(`play-brief-narrative-coaching.ts`), wired into `collectCoachingBullets` in the WATCH-bucket
block, right after `watchGateCoaching`. Fires only when: bucket is `watch` (entry trigger is a
pre-entry concept, same scoping as the existing "Entry"/"Watch levels" sections); Vector's snapshot
is fresh; `vec.play.bias === "range"` (which, per `resolveVectorPlaySetup`'s own branching, is
reached *only* from the long-gamma posture branch — no separate gamma-posture check needed); and
the swing's `entryTriggerUnderlyingPx` sits within 2.5% of the matching-direction rail (call wall
for LONG, put wall for SHORT). Deliberately does **not** reuse `vectorPlayCoaching`'s
"aligned"/"cross-check" directional-conflict framing — the message says explicitly "Not a
directional call either way" — since a range bias is not a "Vector bearish/bullish" claim and
reusing that framing would misrepresent what Vector is actually saying, the exact failure mode the
2026-09-15 fix this builds on already corrected once.

**Implementation note — avoided a circular import.** The call-wall/put-wall numbers are normally
read via `collectFocalLevels` in `play-brief-narrative.ts`, but that module imports
`collectCoachingBullets` *from* `play-brief-narrative-coaching.ts` — importing `collectFocalLevels`
back would create the exact play-brief.ts/play-brief-narrative.ts circular-import shape this
codebase has hit (and fixed the same way) several times before. Instead, a small local helper
(`callPutWallForCollisionCheck`) duplicates only the minimal vec-first/GEX-matrix-fallback/
staleness-gated wall extraction, mirroring `collectFocalLevels`'s logic for just those two levels
rather than importing it — the same "duplicate the minimal check locally" pattern this repo already
uses for the sibling `blendedPnlPct` case (see `FINDINGS.md`'s entry on that fix).

**Gating (deliberately conservative):**
- WATCH-bucket only.
- Vector snapshot must be fresh (same staleness gate every other wall-citing bullet in this file
  uses).
- `vec.play.bias` must be exactly `"range"`.
- The entry trigger must sit within **2.5%** of the matching-direction wall — "essentially at" the
  level, not merely in its general vicinity.
- Honest-null on any missing input (no entry trigger, no Vector snapshot, no matching wall) — never
  a fabricated comparison.

**Evidence.** 6 new regression tests in `play-brief-narrative-coaching.test.ts`: the live
SNOW-shaped LONG repro (fires, names both the trigger and the wall, uses "sell-the-rip" framing),
the symmetric SHORT case (put wall, "buy-the-dip" framing), silence when the trigger has real room
from the wall (outside the 2.5% band), silence on a directional bias (`"long"`/`"short"` — this is
explicitly not `crossDeskCoaching`'s job), OPEN/CLOSED-bucket scoping (never fires — entry trigger
is pre-entry), and honest-null on each missing input individually (no trigger, no Vector snapshot,
no call wall). `npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief-narrative-coaching.test.ts`: 169/169 pass (including the 6 new ones).
Broader regression sweep (`play-brief`/`play-brief-intel`/`play-brief-narrative`/`play-brief-diff`):
496/496 pass — no fixture regressions from the new bullet. `tsc --noEmit`: clean. Full `npm test`:
see PR for the run confirming 0 regressions repo-wide.

**Blast radius.** Single new call site in `collectCoachingBullets`'s WATCH-bucket block, plus one
small local helper function. No other consumer of Vector's GEX walls or `entryTriggerUnderlyingPx`
touched. No gate, score, or exit-management logic changed — purely an additive, narrowly-scoped
WATCH-bucket narrative bullet, per the original ask's own stated boundary.

**Collaboration note.** The original ask (PR #4076 comment 6131711926) explicitly asked for a
go/no-go from Cursor before scoping the diff. No response arrived after 8.5+ hours of waiting
across multiple check-ins (per the standing "track open asks, follow up each cycle" discipline) —
implemented independently per the Ask Largo ownership mandate's "drive this automatically and
autonomously" instruction and the standing "NEVER SIT IDLE" policy, staying strictly inside the
boundary the original ask drew (not touching `crossDeskCoaching`'s existing directional logic, a
narrowly-scoped new check in its own function). Same precedent as the sibling idea #1
(`ivLeverageDivergenceCoaching`, implemented the same session after a similar unanswered wait).
Flagged back on the #4076 thread for visibility.
