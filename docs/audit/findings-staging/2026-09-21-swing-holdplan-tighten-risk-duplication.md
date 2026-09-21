> **kind:** FINDING

## Ask Largo: `holdPlanSection` restates the low-thesis-health "tighten risk" advisory that "Trade manager read" already carries — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) |
| **Severity** | P3 (bullet-dump/restatement quality defect, not a data-correctness bug — same class as #4261/#5362) |
| **Status** | FIXED |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate deep-dive, 2026-09-21 |

### Root cause

`actionNarrative`'s HOLD branch (`src/lib/swing/play-brief-narrative.ts`, feeds "Trade manager
read") renders, whenever `rec` is neither `TRIM` nor `SELL` (the common HOLD case) and thesis
health is calibrated and `< 45`:

```
**Hold the line** — thesis health **X%**. Health fading — tighten stop or trim into any bounce.
```

`holdPlanSection` (same file, feeds "Hold plan") independently renders, for the identical
`health < 45` condition:

```
Thesis health **X%** (rung)
**Tighten risk** — thesis fading; don't add size
```

Both sections render together for every live OPEN play (`buildIntelSections` pushes `narrative`
unconditionally and `hold` for `bucket === "open"`), so a member expanding the brief
(`expandIntel=1`) reads the same underlying advice — thesis health has degraded, tighten/reduce
risk — twice, in two different phrasings, one section after the other.

This is the 4th instance of this exact file's own restatement class: `holdPlanSection` already
carries dedup guards for the `round_trip` giveback fact/advice and the `capture` giveback advice
(`narrativeAlreadyNoted.roundTrip`/`.capture`, derived from `narrative.body` at the call site) —
but the call site only ever derived those two flags. The HOLD-branch "tighten" advisory was never
covered because nobody had traced `actionNarrative`'s HOLD branch specifically against
`holdPlanSection`'s own health<45 line — the doc comment sitting directly above the `Tighten risk`
line even claimed (correctly, for a *different* clause) that "advisory is NOT repeated here",
which read as covering this case too on a fast pass.

### Evidence

RED→GREEN test added: `src/lib/swing/play-brief-intel.test.ts`, `buildIntelSections: does not
restate the low-thesis-health tighten-risk advisory twice for an OPEN HOLD play`. Composes the
real `buildIntelSections(ctx, "open", { collapseIntel: false })` (the expanded-view shape) with a
HOLD-recommendation play carrying a calibrated `thesisHealth.health = 30` — pre-fix, "Hold plan"
independently rendered `**Tighten risk** — thesis fading; don't add size` alongside "Trade manager
read"'s `Health fading — tighten stop or trim into any bounce.`; confirmed RED via `git stash` on
just the implementation file (test failed: `not ok ... does not restate ...`), GREEN restored on
`git stash pop`. Full suite: 182/182 pass in `play-brief-intel.test.ts`.

Live verification: scanned all 59 currently-committed OPEN Night Hawk Swings positions
(`GET /api/market/nighthawk/horizons?view=SWING` → each ticker's
`GET /api/market/swing/play-brief`) for a HOLD-rec + calibrated-health<45 combination — none
currently live (most either carry TRIM/SELL recs, uncalibrated/withheld health, or health ≥ 45),
so this is a structurally-proven-but-not-yet-observed-live defect, same evidentiary shape as the
`capture<35 && peak<=20` gap documented a few lines above this one in the same file
(`lessonsSection`, FINDINGS 2026-09-20) — will fire on its own the next time a live OPEN position's
thesis health degrades below 45 while its recommendation is still HOLD (the common early-fade
case, before the desk escalates to TRIM/SELL).

### Fix

Added a third `tighten` flag to `holdPlanSection`'s `narrativeAlreadyNoted` parameter, derived at
the `buildIntelSections` call site from `narrative.body.includes("Health fading — tighten stop or
trim into any bounce")` — same pattern as the existing `roundTrip`/`capture` flags. The raw
`Thesis health **X%** (rung)` fact line is untouched (same "compact number, not a repeated
sentence" discipline the file already applies) — only the restated advice sentence is suppressed
once "Trade manager read" already carries the equivalent one.

### Blast radius

Single call site (`buildIntelSections`), single consumer (`holdPlanSection`). No other section
renders this exact "Tighten risk" string. Checked `lessonsSection` (CLOSED-play sibling) for the
same pattern — it has its own, already-covered dedup flags for a different set of advisory
sentences (round-trip/strong-discipline/gave-back-the-move), not this one, so no additional gap
found there.
