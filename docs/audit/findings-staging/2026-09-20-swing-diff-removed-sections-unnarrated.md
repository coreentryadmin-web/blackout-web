## Swing "What changed" diff engine never narrated a section DISAPPEARING between refreshes — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play brief — `diffBriefSnapshots` (`src/lib/swing/play-brief-diff.ts`) |
| **Severity** | P3 (member-facing signal loss — no crash, no wrong number, but a real, previously-shown warning could vanish with zero notice) |
| **Status** | FIXED |

### Root cause

`composeSwingPlayBrief` (`play-brief.ts`) builds its `sections` array by conditionally
`sections.push(...)`-ing many intel sections only when the underlying data genuinely supports
them — "Book context" only while `checkPortfolioOverlap` finds real theme/direction
concentration, "Cortex read" only while a cortex blob is pinned, "Catalysts & news"/"Meridian
catalysts" only while a catalyst read exists and hasn't gone stale, "GEX posture"/"Wall dynamics"
only while the matrix is fresh, etc. This is deliberate and correct per
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle — a section is omitted rather than
padded when a product genuinely has nothing to show.

The consequence nobody had traced: because a section's presence is data-driven, it can genuinely
**disappear** between two refreshes of the same play — e.g. a portfolio-overlap warning clears, a
Cortex source starts timing out, a catalyst read goes stale and gets dropped. `diffBriefSnapshots`
already compares `prev.sectionTitles` against `next.sectionTitles` for exactly this class of
change, but only in one direction:

```ts
const newSections = next.sectionTitles.filter((t) => !prev.sectionTitles.includes(t));
if (newSections.length) {
  lines.push(`New sections: ${newSections.join(", ")}`);
}
```

A title present in `prev` but missing from `next` produced **zero lines** — silently identical to
a refresh where nothing changed at all, even though a member had genuinely been shown a warning
(e.g. "Book context" concentration) that then quietly went away with no "What changed" callout.
This is the exact same shape as two bugs already fixed in this file (the roll-candidate-clearing
gap and the DTE-rollover headline bug) — a materially informative refresh event that produced no
signal — just on the generic section-list path instead of a specific field.

### Evidence

Wrote a RED→GREEN regression test (`play-brief-diff.test.ts`): built two envelopes whose sections
differ only by "Book context" being present in `prev` and absent in `next`, and asserted
`diffBriefSnapshots` returns a `"No longer showing: Book context"` line.

- **Before the fix:** `git stash` on `play-brief-diff.ts` alone (test file untouched) →
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-diff.test.ts` → the new
  test failed: `expected a "No longer showing" line, got: []` (33 pass / 1 fail).
- **After the fix (`git stash pop`):** same command → 34/34 pass.

### Blast radius

Single call site — `diffBriefSnapshots` is the only place `sectionTitles` is diffed (confirmed via
repo-wide grep). No other consumer duplicates this comparison, so this is a one-file fix with no
other lane to touch.

### Fix rationale

Added the symmetric check — `prev.sectionTitles` minus `next.sectionTitles` — and pushed a plain
`No longer showing: <titles>` line, deliberately **not** inventing a reason for *why* a section
left (the diff engine has no visibility into which specific upstream condition flipped, and
guessing one would risk stating something untrue — the same "name the fact, don't fabricate the
cause" discipline `narrateStructuralLevelShift`'s direction-neutral framing already uses in this
same file). Left the existing `newSections` behavior, threshold, and 8-line cap on
`diffBriefSnapshots`'s output completely unchanged.
