# Ask Largo swing brief — "brief v4" collapse silently deleted book/desk concentration warnings (shipped despite a pre-merge flag)

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (member-visible, safety-relevant content silently missing — a real risk warning, not cosmetic) |
| **Area** | Swing / Ask Largo intel-section collapse layer |
| **Files** | `src/lib/swing/play-brief-intel-collapse.ts`, `src/lib/swing/play-brief-intel-collapse.test.ts` |

## Context

PR #4119 ("brief v4 — collapse intel, narrative pulse, Meridian peers") added `collapseRedundantIntelSections()`: when "Trade manager read" (the narrative coaching block) is present, it drops a fixed set of intel sections on the theory their content is folded into the narrative, replacing them with a footnote ("Desk detail for N sections folded into Trade manager read above").

Its `NARRATIVE_COVERED_TITLES` set was built against a branch forked **before** two already-merged fixes:
- **#4116** removed `bookContextCoaching()` (the narrative bullet that used to duplicate `bookContextSection`'s "Book context" concentration warning) — so by the time #4119 was written, "Book context" no longer had ANY narrative-bullet equivalent, but the collapse list still assumed one existed and dropped the section anyway.
- **#4111** renamed "Desk consensus" to "Desk context" and deliberately kept NH outcome-history + flow-anomaly content in the dedicated section (only the direction-conflict piece moved into `crossDeskCoaching`) — the collapse list's stale `"Desk consensus"` string never matched the real title, so this one was accidentally safe, not correctly designed.

**This was flagged in a PR comment before merge** with a concrete reproduction (checked out the branch in an isolated worktree, removed `bookContextCoaching` to simulate the post-#4116 state, and showed the exact composed envelope: no "Book context" section, no concentration bullet anywhere, yet the footnote still claimed detail was "folded into Trade manager read above"). The PR was merged **23 seconds later** by `cursor[bot]` itself, on the same stale base, without addressing the comment — the same pattern already recorded in CLAUDE.md's "THE MIRROR FAILURE" section for #4110. This finding documents the second occurrence and the fix.

## Root cause

`NARRATIVE_COVERED_TITLES` is a fixed set of section titles collapsed whenever `hasNarrative` is true, with no check that the narrative's actual bullet content covers what's being dropped. It silently drifts out of sync whenever another PR changes what the narrative covers (removes a duplicate bullet, renames a section, moves content between the two layers) — exactly the "an allowlist entry that assumes a fact about a sibling PR" ordering-dependency shape CLAUDE.md's own "CROSS-PR ORDERING DEPENDENCIES" section already warns about, just inside a single file's own constant instead of across files.

**Live-verified on `main` after #4119 merged:** composed a full envelope for an NVDA HOLD play against an `openBook` holding AMD/SMH (theme "semis") — "Book context" absent, no concentration bullet anywhere in "Trade manager read," yet the footnote read "Desk detail for 5 sections folded into Trade manager read above." A member with a theme-overlapping book got **zero** concentration warning, with a note falsely implying one was available.

## Fix

Removed `"Book context"` from `NARRATIVE_COVERED_TITLES` entirely (no narrative bullet has covered it since #4116 — the dedicated section is the only source now) and replaced the stale `"Desk consensus"` entry with... nothing, rather than the new `"Desk context"` title — `crossDeskCoaching` only covers direction-conflict, not the NH-outcome-history/flow-anomaly content #4111 deliberately kept in `deskConsensusSection`, so re-adding it under its current name would repeat the identical bug for a second section. Added a doc comment on the remaining set explaining why each excluded title stays excluded, so the next section rename doesn't reintroduce this.

## Evidence (RED → GREEN)

Two new regression tests directly assert both excluded titles survive collapse when `hasNarrative: true`. `git stash` on `play-brief-intel-collapse.ts` alone (keeping the new tests) → the "Book context" test **fails** (`Book context must survive the collapse`, exactly reproducing the live bug); the "Desk context" test passes even pre-fix (it was accidentally safe due to the stale string, not by design — the new test now protects it deliberately going forward). Restored → **4/4 pass**. Re-ran the live-envelope repro against the fixed code: "Book context" section present with the correct concentration text. `tsc --noEmit` clean. Full `npm test` (Node 20): **12914/12914 pass, 0 fail, 3 skipped**.

## Blast radius

Only `play-brief-intel-collapse.ts`'s constant set changes. The other 8 titles in the set (`Lane rank`, `Levels on chart`, `GEX posture`, `Wall dynamics`, `Flow & positioning`, `Macro tape`, `Hold plan`, `Vector desk`) were checked against `play-brief-intel.ts`'s actual section titles and all still match real, current sections — no other stale entries found this pass.

## Fix rationale — what was deliberately left unchanged

- Did not add a general "verify narrative actually covers X before collapsing X" runtime check — that would require threading narrative-content awareness into the collapse function, a larger design change. The scoped fix (correct the two known-stale entries, document why) matches the size of what's actually broken today.
- Did not touch `collapseRedundantIntelSections`'s core logic (the footnote-append behavior, the `dropped === 0` early return) — only the constant set was wrong.
