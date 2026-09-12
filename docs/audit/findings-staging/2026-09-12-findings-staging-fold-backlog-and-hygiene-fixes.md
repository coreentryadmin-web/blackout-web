## 2026-09-12 — [FINDING, P3 audit-hygiene] `findings-staging/` had never been folded — 346 files backlogged since 2026-09-04; folded 59, fixed 3 hygiene defects the fold surfaced, 286 remain (format-incompatible, flagged not fixed)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | PARTIALLY ADDRESSED — 59 well-formed staged files folded into `FINDINGS.md` and their source files deleted (the fold script's own behavior); 286 remain staged, skipped by the script for format reasons it correctly refuses to guess at (see below) — a follow-up for a dedicated pass, not fixed here. |
| **Severity** | P3 — no product risk; this is entirely about the audit trail's own integrity/discoverability. But real: it produced one confirmed live bug (below) — a stale FINDINGS.md entry telling a future session/lane a bug was still `OPEN` when it had actually shipped. |

### What was found

`docs/audit/findings-staging/README.md`'s own stated process — *"Run [the fold] after a merge
wave — the coordinator does this routinely"* — had not run in at least 8 days: 346 staged `.md`
files sat in the directory, dated from 2026-09-04 through today, none folded into `FINDINGS.md`.
Noticed while re-verifying an old `FINDINGS.md` claim (this DISCOVERY cycle's own standing brief):
the 2026-09-10 entry *"`vectorBoardRowGivebackPct`/`vectorBoardRowAtRisk`... — OPEN, write-up
only"* was stale — this session had already fixed the giveback half directly (PR #4763, earlier
today) and staged `2026-09-11-vector-board-giveback-percentage-point-fixed.md` documenting it, but
that staged file was still sitting unfolded, so `FINDINGS.md` itself still read `OPEN` and would
have misled any future session into thinking the bug was still live and unowned.

### What was done

Ran `node scripts/audit/findings-reconcile.mjs --apply` and `node
scripts/audit/findings-fold-staging.mjs` per the README's own instructions ("anyone can run it any
time"). **59 of 346 staged files folded cleanly** (`FINDINGS.md` grew from 36,275 to ~38,945+
lines); their source files were deleted by the fold script itself, as designed.

**The fold surfaced 3 real hygiene defects in the freshly-folded content, caught by
`findings-hygiene.test.ts` going from 9/9 to 7/9 immediately after folding — fixed before
committing:**
1. **A stale "OPEN" claim, corrected** — the exact staleness this fold was meant to catch: the
   Swing play-brief Verdict-line entry ("Verdict line showed raw SKIP under a headline that said
   HOLD") carried `| **Status** | FIXED, PR pending |`. Verified directly against
   `src/lib/swing/play-brief.ts` (both fallback chains — the headline's and the Verdict line's —
   now read `action?.label ?? play.recommendation ?? play.status`, confirming the fix is live on
   `main`, not still pending). Corrected the status line to state that plainly rather than leaving
   an ambiguous "PR pending" for the NEXT session to have to re-verify from scratch.
2. **Two of my own staged entries missing a `Status` row entirely** — this session's own
   `2026-09-11-svix-2.2-verify-drops-return-value.md` and
   `2026-09-11-next-config-unused-remote-image-pattern.md` used a `Severity`-first table without a
   `Status` row (both PRs — #4810, #4809 — were already confirmed merged earlier this session).
   Added `Status` rows citing the merged PR numbers.
3. **A line-wrap artifact breaking the heading-detection regex** — the 2026-09-10 "Night Hawk
   Swings has ZERO public content representation" entry quoted another `FINDINGS.md` heading
   verbatim inside backticks, but the quote's hard line-wrap happened to land exactly on `## ` at
   the start of a line, which `findings-hygiene.test.ts`'s "no heading glued to the previous line"
   check (correctly) cannot distinguish from a real malformed heading. Reworded to describe the
   referenced entry by title instead of reproducing its literal `## ` prefix mid-paragraph.

**Verification**: RED→GREEN confirmed via `git stash` (original pre-fold `FINDINGS.md`: 9/9 pass;
immediately post-fold, pre-manual-fix: 7/9; post-fix: 9/9 again). All 4 `findings-*` test files
(`findings-hygiene.test.ts`, `findings-fold-staging.test.ts`, `findings-no-loss.test.ts`,
`findings-merge-resolve.test.ts`) + `findings-entry-set.test.mjs`: 27+9=36 total, all pass.
`npx tsc --noEmit`: clean (docs-only change, expected). The reconciler's own second `--apply` run
after the manual fixes reports **0 entries needing a human/next-session decision** (was 3).

### What was deliberately NOT done — 286 files remain staged

`findings-fold-staging.mjs` skipped 286 of the 346 staged files for format reasons it explicitly
documents as unsafe to auto-repair (`normalizeEntry`'s own comment block): no `## ` heading found,
no `> **kind:**` line found, or (10+ of them, per the script's own prior measurement) MORE THAN ONE
`## `-level heading in a single staged file — a write-up using `## Root cause`/`## Fix`/`## Evidence`
sub-sections at the SAME heading level `FINDINGS.md` reserves for entry boundaries, which would
fragment one finding into several headless pieces if folded naively. The script's own design
principle, quoted directly in its source: *"Left in staging for a human pass, not silently
mishandled."* This write-up follows that same discipline rather than guessing at 286 individual
reformats. **Next step for whoever picks this up**: re-run `node
scripts/audit/findings-fold-staging.mjs` (it prints exactly which files it skips and why-shaped —
missing heading vs. missing kind vs. multiple headings) and fix the format of each skipped file
in place (or accept the fold's normalization) before re-running; do not bulk-edit blindly, since a
few of the skipped files are likely SCOPED/design-proposal writeups whose body legitimately uses
`## ` sub-sections for a different reason than the entry-boundary convention.

### Blast radius

`docs/audit/FINDINGS.md` only (additive — 59 entries appended, 3 of them corrected in the same
pass) and the 59 corresponding `findings-staging/*.md` source files (deleted, per the fold script's
normal, documented behavior). No application code touched.
