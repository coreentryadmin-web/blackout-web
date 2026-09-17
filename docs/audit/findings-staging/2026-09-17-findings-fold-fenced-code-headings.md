> **kind:** FINDING

## `findings-fold-staging.mjs` mistook quoted `## ` headings inside evidence code fences for real sub-headings — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Shared audit tooling (`scripts/audit/`, used by every lane) |
| **Severity** | P3 (tooling — findings silently never reach `FINDINGS.md`, not a product defect) |
| **File** | `scripts/audit/findings-fold-staging.mjs` (`normalizeEntry`) |
| **Found by** | Standing "Ask Largo × Night Hawk Swings" mandate — discovered while folding my own staged findings after a merge wave |

### Root cause

`normalizeEntry`'s multi-heading guard exists to catch a real defect: a staged finding that writes
its own body using `## `-level sub-headings (`## Root cause` / `## Fix` / `## Evidence`) at the
SAME heading level `FINDINGS.md` reserves for entry boundaries — folding one of those in raw
fragments a single finding into several headless sub-"entries." The guard counted every line
starting with `## ` in the whole file to detect this.

But it never distinguished a real, structural `## ` heading from one that is merely **quoted**
inside a fenced code block (` ``` `) as evidence — and quoting a live product's own markdown
output is a normal, encouraged evidence pattern per this repo's own PR write-up policy ("Evidence:
live numbers, header captures... whatever actually proved the bug"). A finding whose Evidence
section quotes an Ask Largo play-brief's own markdown (which itself contains real `## Why this
setup` / `## Entry` / `## Trade manager read` headings) has exactly one REAL heading but multiple
literal `## ` lines once the fenced quote is counted — indistinguishable, to the old scanner, from
the genuine multi-heading defect it exists to catch.

### Evidence

Live repro: two well-formed, single-real-heading swing findings never folded across multiple runs
of the fold script (2026-09-17), both because their own Evidence section quotes a live play-brief
excerpt inside a fence:

- `2026-09-17-lane-rank-score-precision-mismatch.md` — one real heading (`## Ask Largo "Lane rank"
  section...`), plus a fenced quote containing `## Why this setup` and `## Trade manager read`.
- `2026-09-17-watch-entry-geometry-duplication.md` — one real heading, plus a fenced quote
  containing `## Entry` and `## Watch levels`.

Running `node scripts/audit/findings-fold-staging.mjs` reported both under "Skipping — ... more
than one '## ' line" alongside the genuinely malformed files, with no way to tell the two cases
apart from the script's own output short of reading each skipped file by hand.

Regression tests added to `src/findings-fold-staging.test.ts`: `"a '## ' heading inside a fenced
code block does not count as a real sub-heading"` (confirmed RED — the pre-fix script skipped the
fixture with the exact same "more than one '## ' line" message) and a companion `"a real '## '
sub-heading OUTSIDE any fence still trips the multi-heading guard"` proving the fix didn't also
blind the guard to the genuine defect it exists to catch.

### Blast radius

Single function (`normalizeEntry`), the only place in the script that scans for headings. Affects
every lane, not just Swing — any staged finding whose evidence quotes markdown/code containing a
`## `-level line was silently stuck in staging forever, with no error distinguishing it from a
genuinely malformed file. Given this lane's own convention of quoting live Ask Largo brief output
as evidence (used in nearly every recent swing finding), this was actively blocking real findings
from ever reaching `FINDINGS.md`.

### Fix rationale

Added a `realLineMask` helper that tracks fenced-code-block state (toggled by any line whose
trimmed content starts with three backticks) and marks every line inside a fence as not counting
toward heading/kind detection — the fence delimiter line itself never counts either way. Applied
consistently to `headingIdx`, `kindIdx`, `headingCount`, and the post-reorder `newHeadingIdx`
lookup (factored into a shared `findRealHeadingIdx` helper) so the fix is uniform across every
place the script looks for a heading. The genuine multi-heading guard (unfenced `## ` sub-sections)
is untouched — it still rejects those files exactly as before.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/findings-fold-staging.test.ts` — 11/11 pass (Node 20); new fence test confirmed RED before the fix (same "more than one '## ' line" skip message as a genuinely malformed file).
- `npx tsc --noEmit` — clean.
