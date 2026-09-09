> **kind:** FINDING

## Ask Largo swing narrative — two more absolute-premium formatters carried the same signed-delta "+" defect — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief narrative (`src/lib/swing/play-brief-narrative.ts`, `src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P2 (same class as #4645 — a stop-loss trigger price can read as a gain) |

### Root cause

PR #4645 fixed `play-brief.ts`'s `fmtUsd` — a signed-delta formatter (`n >= 0 ? "+" : ""`)
misapplied to absolute per-contract premium prices (entry/mark/stop/target are never negative
deltas). A standing Ask Largo deep-dive, explicitly asked to scan the surrounding narrative
composition code for other instances of the *same* defect pattern, found the identical bug
copy-pasted into two more files:

- `play-brief-narrative-coaching.ts`'s own file-local `fmtUsd` — the only call site,
  `progressRatchetCoaching`, renders `exitPolicy.stop_premium`/`target_premium` (the "Manage
  rails" line) with the same spurious "+".
- `play-brief-narrative.ts`'s `fmtOptionUsd` — three call sites (`tradeManagerNarrativeSection`'s
  live mark, its Break-watch stop_premium line, and its `railsFallback` stop/target rails) all
  render the identical absolute-price fields with the same spurious "+".

Left unfixed, these would have made #4645's fix *worse*: the Position section (fixed) would read
the correct sign-free `$1.95` while the Trade-manager narrative two sections below (unfixed) kept
`+$1.95` for the identical field in the same document — a fresh cross-section contradiction of
exactly the kind `play-brief-narrative.ts`'s own doc comment already warned about for a different
historical mismatch.

### Fix

Both formatters had their sign branch removed, matching `play-brief.ts`'s already-fixed
`fmtUsd` and `play-brief-intel.ts`'s already-correct sign-free absolute-price formatter. Purely
additive doc comments explain the fix and cross-reference #4645 as the root-cause sibling.

### Evidence

- `progressRatchetCoaching` regression test: RED pre-fix (assertion for sign-free `$2.10`/`$8.00`
  fails against the old `+$2.10`/`+$8.00` output), GREEN post-fix.
- `tradeManagerNarrativeSection` existing Break-watch/Live-read tests updated to assert sign-free
  output; new `railsFallback` regression test added (a separate code path/call site from the
  Break-watch fallback, previously untested for this specific defect).
- Full `src/lib/swing/*.test.ts` suite: 839/839 pass, 0 fail (verified against fresh `main`,
  after #4644/#4645 both merged).
- `npx tsc --noEmit`: clean.
- RED→GREEN proven via `git stash` (source-only revert): 4 test failures pre-fix, 0 post-fix.

### Blast radius

Two files, three call sites total (`progressRatchetCoaching`'s rails line;
`tradeManagerNarrativeSection`'s live-mark line, Break-watch stop line, and `railsFallback` rails
line). Grepped both files for any other `n >= 0 ? "+" : ""`-shaped formatter — none found. No
other file in `src/lib/swing/` still carries this pattern for an absolute-price field as of this
fix (`play-brief.ts` fixed in #4645, `play-brief-intel.ts` was already correct).
