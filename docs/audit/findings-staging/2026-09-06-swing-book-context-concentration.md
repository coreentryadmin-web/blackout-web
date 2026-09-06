# Ask Largo swing brief — no book/portfolio-concentration awareness

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product enhancement — genuine gap, not a defect) |
| **Area** | Swing / Ask Largo play brief |
| **Files** | `src/lib/swing/play-brief-types.ts`, `src/lib/swing/play-brief-context.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-intel.test.ts` (new) |

## Root cause / gap

`checkPortfolioOverlap()` in `portfolio.ts` already answers whether a candidate stacks or fights an existing theme exposure, but the swing play brief never imported or called it. A trader could see a BUY on NVDA while already holding AMD + SMH LONG in the same semis theme with zero mention.

## Fix

- `SwingPlayBriefContext` gains optional `openBook: PortfolioPosition[]`.
- `loadSwingPlayBriefContext` fetches `fetchOpenSwingPositions()` and maps ledger direction to `PlayDirection`.
- New `bookContextSection()` wired after "Why this setup" in `buildIntelSections`.

## Evidence (RED → GREEN)

`play-brief-intel.test.ts`: 5 book-context tests — concentration, internal conflict, clean book, no false self-overlap.
