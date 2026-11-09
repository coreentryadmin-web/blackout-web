# CLOSED swing play-briefs: "Since it closed" narrates an absent GEX read, but `unavailableSources` omits it — Largo C3 prose-vs-chip contradiction

> **kind:** `FINDING`

### Summary
For a CLOSED (or dead-WATCH) swing play, when `ctx.ecosystem.gex_positioning` is entirely absent
for the ticker (cold matrix / no positioning read at all — distinct from a fetch failure),
`watchForSection`'s "Since it closed" section (`src/lib/swing/play-brief-intel.ts`) correctly
discloses the absence in prose ("No gamma flip / GEX wall read available for this name since the
play closed."), but `collectBriefUnavailableSources` (`src/lib/swing/play-brief-absence.ts`) emits
nothing in `envelope.unavailableSources` about it — so the UI's `UnavailableChip` (or any consumer
reading only the structured chip array) sees a clean read while the prose two inches below says the
opposite. Confirmed live on two real CLOSED briefs (MSTR#72, GOOG#71): both envelopes' "Since it
closed" body is exactly "No gamma flip / GEX wall read available for this name since the play
closed." while `unavailableSources` for both contains only earnings/fundamentals/peers/news
entries, no GEX-related entry at all — a direct Largo C3 (absence) violation.

### Root cause
A 2026-10-26 fix (`collectGexFlipAbsence`, `play-brief-absence.ts` lines ~938-957, called
unconditionally regardless of `isNotLive` at the call site a few lines below) was added
specifically to override the blanket `!isNotLive` exemption for CLOSED/dead-WATCH plays — its own
doc comment states the exact rationale: `gexPostureSection`/`chartLevelsSection` render a "Current
..." read for CLOSED plays too, so the matrix-present-but-flip-null disclosure needed to survive
close. But that fix's guard clause is `if (!gex || gex.flip != null) return null;` — it only
produces a disclosure when `gex` (the ecosystem's `gex_positioning` object) is PRESENT but its
`flip` field is null. When `gex` itself is entirely absent (the common "cold matrix" case — the
same condition the still-`!isNotLive`-gated cold-matrix check a few lines above exists for), this
function silently returns null, so the 2026-10-26 override never fires for the more common sibling
case. The "Since it closed" prose fallback (`play-brief-intel.ts`) renders the IDENTICAL "No gamma
flip / GEX wall read available..." sentence for BOTH sub-cases (`gex` entirely null, or `gex`
present with a stale-excluded null flip) — so the chip and the prose must agree for both, not just
one.

Found by a parallel live-production audit workflow (5-engine live monitor + Ask Largo deep-dive,
run against `blackouttrades.com` under the standing Ask Largo mandate), independently verified by
reading the actual source and cross-checking against two real CLOSED play-brief envelopes before
trusting the probe's own self-reported confidence rating.

### Fix
Added a new, independent check in `collectBriefUnavailableSources`, gated on `isNotLive` (the
mirror image of the existing `!isNotLive`-gated cold-matrix check): when `gex_positioning` is
entirely absent for a CLOSED/dead-WATCH play (and the ecosystem fetch itself didn't fail — that
case is already always disclosed), push the same "GEX positioning: cold matrix / no positioning
read" entry the live case already gets. Mirrors the 2026-10-26 fix's own reasoning: "is the matrix
present at all" is, like "is there a structural reason for no flip", a question about the matrix's
own state, independent of whether the play is still live.

A sibling, pre-existing test (`CLOSED play suppresses live-desk-freshness noise`) asserted the
OLD (now-incorrect) behavior — that a CLOSED play never surfaces a "GEX positioning" chip at all.
That assertion predates both the 2026-10-26 fix and this one; it was updated to assert the new,
correct behavior (the chip DOES surface for the cold-matrix case), with a comment explaining why.

### Evidence
- RED: two new tests (`a CLOSED play with an entirely-absent GEX matrix also surfaces a
  cold-matrix chip` / the dead-WATCH sibling) fail against the pre-fix source (confirmed via
  `git stash` of just `play-brief-absence.ts`: 115/117 pass, 2 fail).
- GREEN: same two tests pass post-fix, plus the stale pre-existing assertion was updated to match
  the new intentional behavior — full file 117/117 pass.
- Full `src/lib/swing/*.test.ts` regression: 2284/2284 pass.
- `npx tsc --noEmit` clean project-wide.
- Live cross-check: the exact scenario (CLOSED, `gex_positioning: null`) reproduced via an isolated
  call to the real, unmodified `collectBriefUnavailableSources` with a fixture matching the real
  MSTR#72/GOOG#71 shape — returns the expected chip in 0ms.

### Blast radius
Only the "Since it closed" GEX-absence disclosure path for CLOSED/dead-WATCH swing plays. The
analogous "Vector desk state" cold-snapshot disclosure (same `!isNotLive` gating pattern, no
sibling override) likely has the identical gap, but with lower direct live evidence this round
(no narrative line in the samples checked explicitly states a Vector-specific absence for a closed
play the way "Since it closed" does for GEX) — left as a follow-up, not fixed here, per the
standing "never guess" discipline. Severity P3 — a narrative-honesty/absence-disclosure gap, not a
crash, wrong number, or anything affecting position sizing/risk.

| **Status** | FIXED — this PR. |
