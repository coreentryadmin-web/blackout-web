## 2026-10-21 — [FINDING, swing] evidence[] book-overlap fact never got the same-ticker split on the OPPOSED-direction side — Ask Largo round-3 deep-dive

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (evidence[] disagrees with the section body it's meant to corroborate — Largo C7 violation) |
| **Surface** | `src/lib/swing/play-brief.ts` — `composeSwingPlayBrief`'s evidence feeder |

### Root cause

`composeSwingPlayBrief`'s evidence[] feeder (the "Book overlap: ..." fact) mirrors
`bookContextSection`'s same-ticker/other-ticker split for `overlap.sameThemeSameDirection`
(concentration) — but never applied the identical split to `overlap.sameThemeOpposedDirection`
(internal conflict). The `sameThemeSameDirection` block got its split fixed earlier the same day
(2026-10-21), mirroring a fix `bookContextSection` itself shipped the day before (2026-10-20,
distinguishing a same-underlying opposed position from a same-theme/different-ticker one) — but the
mirror-image `sameThemeOpposedDirection` block was left exactly as it was: a generic
`${count} opposed position(s) in the same theme`, with no same-ticker branch at all.

The evidence feeder's own adjacent comment states the explicit invariant this violated: "Same
gating as the sections themselves... so this can never disagree with what the member reads in the
section body" — for the opposed bucket it did disagree.

### Evidence

Live-reproduced on the TSLA WATCH short brief fetched during the round-3 deep-dive (book already
holding TSLA 352.5C LONG #60 and TSLL LONG): the "Book context" section body correctly separated the
two conflicts ("Internal conflict — same underlying — ... one of these two positions is mechanically
wrong" vs "Internal conflict — theme 'ev-auto' already has an OPPOSED position: TSLL LONG"), but the
same envelope's `evidence[]` carried only `"Book overlap: 2 opposed position(s) in the same theme."`
— collapsing the literal same-underlying TSLA-vs-TSLA conflict and the sector-level TSLA-vs-TSLL
conflict into one generic count.

Added a new test (`play-brief.test.ts`) with the real coupled shape (a SHORT candidate while already
LONG the same ticker, plus a second cross-ticker same-theme opposed position) — RED (161/162,
collapsing to the generic framing) before the fix, GREEN (162/162, "1 same-ticker + 1 other opposed
position in ...") after. Also ran `portfolio.test.ts` + `play-brief-intel.test.ts` (323/323) as a
broader regression sweep — no other consumer of `sameThemeOpposedDirection` was touched.

### Blast radius

`checkPortfolioOverlap`'s `sameThemeOpposedDirection` field is the identical `PortfolioPosition[]`
shape as `sameThemeSameDirection`, so the same split logic was mechanically applicable — no type or
structural change needed. Confined to the one missed branch in the evidence feeder; `portfolio.ts`
and `bookContextSection` (which already has its own correct split) are untouched.

### Fix

Mirror the same-ticker/other-ticker split already used in the preceding `sameThemeSameDirection`
block: filter `overlap.sameThemeOpposedDirection` on ticker match, and push one of three phrasings
("N same-ticker + M other opposed position(s) in {theme}" / "N same-ticker opposed position(s) on
{ticker} itself (opposite side)" / the existing generic fallback) depending on which buckets are
non-empty.

### Why not a bigger fix

No change needed to `bookContextSection`, `checkPortfolioOverlap`, or any other call site — this is
localized to the single missed branch in the evidence feeder, the exact shape of fix already applied
to its sibling block earlier the same day.
