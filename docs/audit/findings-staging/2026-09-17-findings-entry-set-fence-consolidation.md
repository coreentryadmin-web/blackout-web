> **kind:** FINDING

## Fence-aware heading detection was fixed in the fold script but not in four other independent reimplementations of the same split — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Shared audit tooling (`scripts/audit/`, used by every lane) |
| **Severity** | P3 (tooling — findings can fold cleanly yet still be silently fragmented by downstream tools) |
| **Files** | `scripts/audit/lib/findings-entry-set.mjs`, `findings-reconcile.mjs`, `findings-verify-stale.mjs`, `findings-resolve-prs.mjs`, `src/findings-hygiene.test.ts` |
| **Found by** | Standing "Ask Largo × Night Hawk Swings" mandate — discovered immediately after PR #5136 (the fold-script fence fix) merged, while attempting to actually fold the two findings that fix unblocked |

### Root cause

PR #5136 fixed `findings-fold-staging.mjs`'s own multi-heading guard to ignore a `## ` line quoted
inside a ``` evidence fence. But folding the two findings that fix unblocked
(`2026-09-17-lane-rank-score-precision-mismatch.md`, `2026-09-17-watch-entry-geometry-duplication.md`
— each quotes a live Ask Largo play-brief's own markdown, containing real `## Why this setup` /
`## Entry` headings, as evidence) immediately broke `findings-hygiene.test.ts`'s "every entry
declares a kind" and "the reconciler is idempotent" tests.

Root cause: `findings-entry-set.mjs`'s own header comment describes itself as "Shared entry-level
reasoning about `docs/audit/FINDINGS.md`" — but nothing actually shared it. A repo-wide grep found
**five** independent reimplementations of "split FINDINGS.md into entries at `## ` boundaries,"
none importing the others:

1. `findings-entry-set.mjs`'s own `splitEntries` (the intended canonical one).
2. `findings-hygiene.test.ts`'s bespoke `entries()` — `src.split(/\n(?=## )/)`.
3. `findings-reconcile.mjs` — same naive split, twice (main entry loop + RUN-LOG dedup).
4. `findings-verify-stale.mjs` — same naive split.
5. `findings-resolve-prs.mjs` — same naive split.

Every one of them counted/split on every `## `-starting line unconditionally, so the SAME fenced-
heading bug PR #5136 fixed in the fold script was independently present in all five — fixing only
the fold script moved the failure one step downstream (from "silently never folds" to "folds, then
gets fragmented by the next tool that reads the file") instead of eliminating it.

### Evidence

Folding the two unblocked findings and re-running the hygiene suite:

- `"every entry declares a kind"` failed, reporting 7 fake headless entries — the quoted section
  titles (`## Entry`, `## Watch levels`, `## Why this setup`, `## Trade manager read`, etc.) from
  inside the two findings' evidence fences, each misread as its own entry with no kind tag.
- `"the reconciler is idempotent — a second --apply is a no-op"` failed (`11 !== 4` UNRECONCILED
  count), because `findings-reconcile.mjs`'s own naive split saw the same fake entries.

Regression tests added to `scripts/audit/lib/findings-entry-set.test.mjs`: `splitAtHeadingBoundaries`
verified byte-identical to native `text.split(/\n(?=## )/)` on five plain-text cases (confirms it's
a safe drop-in replacement, not just "doesn't crash"), plus a fenced-quote case proving it does NOT
split on a `## ` line inside a fence; `splitEntries` verified to keep a fence-quoting entry as one
entry, not fragments.

A second, unrelated false positive surfaced while re-testing the full 41-file staging batch:
`"entry headings are never glued onto the end of another line"` flagged
`2026-09-16-stale-open-summarizegroupgreekflow-fixed.md` (a different lane's staged finding), which
quotes an old entry's heading text inline in single backticks (an inline code span, not a fenced
block) — e.g. `` `## 2026-08-29 — [FINDING, ...] summarizeGroupGreekFlow...` `` inside a markdown
table cell. That is a genuinely different defect class (inline-backtick quoting vs. triple-backtick
fencing) in a different detector, pre-existing and unrelated to this fix's scope — NOT addressed
here. To avoid taking on someone else's unrelated bug in this PR, only the two swing findings this
fix was built to unblock were folded directly (verified clean); the other 39 pending staged files,
including the one that trips the inline-backtick false positive, are left in staging for a
follow-up pass.

### Blast radius

Affects every lane that stages a finding whose evidence quotes markdown containing a `## `-level
line — a pattern this lane (Ask Largo swing) uses constantly. Before this fix, such a finding could
pass the fold script's own guard (post-#5136) yet still corrupt `findings-hygiene.test.ts`'s entry
count and `findings-reconcile.mjs`'s classification the moment it landed in `FINDINGS.md`, with no
warning until a human happened to run the hygiene suite.

### Fix rationale

Added `splitAtHeadingBoundaries` (fence-aware, drop-in replacement for
`text.split(/\n(?=## )/)`, verified byte-identical to the native split on non-fenced input so
existing callers' non-fence behavior is unchanged) to the shared `findings-entry-set.mjs` module,
and made `splitEntries` itself fence-aware the same way. Migrated all five sites — `entries()`
in `findings-hygiene.test.ts`, both split sites in `findings-reconcile.mjs`,
`findings-verify-stale.mjs`, and `findings-resolve-prs.mjs` — to import and use the shared
function instead of their own copy of the regex, so this class of bug can no longer drift back in
independently at any one of them. A single source of truth rather than patching five call sites
identically and separately.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/findings-hygiene.test.ts src/findings-no-loss.test.ts src/findings-fold-staging.test.ts scripts/audit/lib/findings-entry-set.test.mjs` — 32/32 pass (Node 20).
- `npx tsc --noEmit` — clean.
- `node --check` on all three migrated `.mjs` scripts — clean.
- The two previously-blocked findings folded cleanly into `FINDINGS.md`, verified against the full hygiene suite (11/11) with the fold actually applied.
