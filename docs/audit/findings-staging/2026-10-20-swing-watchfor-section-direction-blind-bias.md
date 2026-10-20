## A swing play-brief's "Watch levels"/"What to watch" section badged the wrong market-direction bias for a SHORT play whose thesis broke — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit reading
`watchForSection` (`src/lib/swing/play-brief-intel.ts`) directly, specifically targeting source not
yet audited this cycle, adversarially verified (2-agent pipeline: investigation + independent
skeptic re-trace against current source; confirmed real).

**Root cause:** `watchForSection`'s return statement computed its section-level `bias` as:
```ts
bias: bucket === "closed" ? "neutral" : play.thesisBreak?.level === "break" ? "bearish" : "neutral",
```
with no reference to `play.direction`. `bias` is rendered as a real, color-coded directional-market
pill (`BieSectionCard` → `BiasPill`, `BieChips.tsx`'s own doc comment: "Directional bias pill
(bullish/bearish/neutral/mixed)") — not inert JSON. `thesisBreak.level` (`thesis-health.ts`'s
`thesisBreakFromHealth`/`computeSwingThesisHealth`) is a direction-agnostic "has this setup's own
edge invalidated" verdict (persistence/entry-geometry/flow/regime/theta pillars degrading relative
to the play's OWN entry thesis) — it says nothing by itself about which way the underlying actually
moved. For a SHORT play, a thesis break typically coincides with the underlying breaking UPWARD
(bullish price action — the move that invalidates a short), yet this line still badged the whole
section "bearish," the opposite of what the market evidence actually showed. For a LONG play the
label happened to usually line up, but the code had no direction-aware basis for either case — it
was purely keyed off `thesisBreak.level`, unlike every other bias computation in this same file
(`technicalsBias`, `vectorDeskSection`'s bias mapping, `resolveGammaPosture`'s long/short handling).

**Live impact:** reachable on any OPEN or WATCH swing play (any direction) whose thesis has broken —
not an edge case; thesis breaks are a routine, expected outcome this section exists specifically to
report on.

**Same defect class already found and fixed at a sibling call site:** `thesisHealthSection`
(`play-brief.ts`, Largo C5, 2026-09-15) used to map `h.health` (the same direction-agnostic health
score) straight to bullish/bearish and badged a SHORT play with a healthy (correctly-falling) thesis
"Bullish" — "the literal opposite of what the trade is betting." That fix's own resolution: "No
section-level bias for a non-directional quality signal — `bias` is already optional on
`RichSection`." `watchForSection`'s line did the identical direction-blind mapping and was never
swept for the same fix.

**Fix:** `watchForSection`'s `bias` field is now unconditionally `"neutral"`, applying the identical
resolution already established at the sibling site rather than attempting a new direction-aware
mapping this section doesn't have the signal to support correctly.

**Fix rationale:** Followed the existing precedent exactly rather than inventing a different
resolution for the same defect class — `bias` is optional on `RichSection`, so simply not asserting
a market-direction claim this section cannot support is the same honest choice already made at
`thesisHealthSection`.

**Blast radius:** single call site (`watchForSection`'s return statement). No other function in this
file maps `thesisBreak.level` to a bias value.

**Tests:** 2 new regression tests — a SHORT play with a broken thesis no longer badges "bearish"
(asserts `bias === "neutral"`); a LONG play with a broken thesis also stays "neutral" (confirming the
fix removes the mapping for both directions uniformly, not just the SHORT case). RED→GREEN proven
via `git stash` (2/2 fail pre-fix — old code returned "bearish" for both directions — pass
post-fix). Zero prior test coverage existed for this branch at all (confirmed via grep for
`level: "break"` fixtures in the test file before this change — zero matches). `tsc --noEmit` clean.
Full suite green on Node 20.
