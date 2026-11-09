> **kind:** `FINDING`

## `findings-fold-staging.mjs` ignored `--dry-run` entirely and ran a real, destructive fold — FIXED

| | |
|---|---|
| **Area** | `scripts/audit/findings-fold-staging.mjs` (coordinator-run tool that folds `docs/audit/findings-staging/*.md` into `docs/audit/FINDINGS.md`) |
| **Severity** | P1 — tooling footgun with real destructive blast radius: a flag typo deletes every other concurrent lane's staged work |
| **Status** | FIXED |

### Root cause

The script never read `process.argv` anywhere. It parsed zero CLI flags — not `--dry-run`, not
anything else. A sibling agent ran `node scripts/audit/findings-fold-staging.mjs --dry-run`
expecting the universal CLI convention (preview only, write nothing), and the unrecognized flag was
silently dropped by Node's own arg handling: the script proceeded straight into its real fold logic
exactly as if it had been invoked with no arguments at all. That performed a REAL, full fold —
appending every staged file's content into `FINDINGS.md` and then deleting every staged file in
`docs/audit/findings-staging/`, including dozens of unrelated, concurrently-in-flight staged
findings from completely different lanes (largo/swing/spx/meridian/vector), not just the one file
the agent was trying to sanity-check. Caught immediately via `git status` and reverted
(`git checkout -- docs/audit/FINDINGS.md docs/audit/findings-staging/`) inside that agent's own
isolated git worktree, before anything was pushed or merged — no lasting damage, but the footgun
stayed live in the script for the next person or agent to hit, possibly without noticing in time.

This is not specific to `--dry-run`. ANY unrecognized flag had the identical silent-pass-through
failure mode, because nothing in the script ever checked `process.argv` against a known set — an
unrecognized flag and no flags at all were indistinguishable to the script.

### Why this wasn't caught sooner

The script has existed and been iterated on heavily (see its own extensive in-file history of
fold-logic corrections), but every prior fix targeted the FOLD LOGIC itself (heading detection,
kind-line normalization, idempotency, fence-awareness) — never its argument parsing, because it had
none to get wrong in an obviously-visible way. A missing `--dry-run` is invisible until someone
actually reaches for it, which is presumably why it went unnoticed through all of those corrections.

### Evidence (RED → GREEN)

Reproduced live against a throwaway fixture directory (never the repo's real `FINDINGS.md`/
`findings-staging/`), using the pre-fix script (`git show HEAD:scripts/audit/findings-fold-staging.mjs`,
run from a scratch copy, never from inside this repo's own tree) via its own env-var overrides
(`FINDINGS_STAGING_DIR`/`FINDINGS_STAGING_TARGET`):

```
$ FINDINGS_STAGING_DIR=<fixture>/staging FINDINGS_STAGING_TARGET=<fixture>/FINDINGS.md \
    node old-findings-fold-staging.mjs --dry-run
Folded 1 staged finding(s) into <fixture>/FINDINGS.md:
  + 2026-11-09-red-proof-finding.md
```

FINDINGS.md was mutated and the staged file was deleted — under `--dry-run`. The identical
silent-fold-anyway behavior reproduced with `--bogus-flag-xyz` in place of `--dry-run`, exit code 0
both times. The same two regression tests committed with this fix (below) were run against this
pre-fix script and failed exactly as expected (2/17 failing: the `--dry-run` preview test and the
unrecognized-flag test; the other 15, including the pre-existing suite, still passed), confirmed
RED before the fix and GREEN after.

After the fix, the same two invocations against the fixed script: `--dry-run` prints a `[DRY RUN]`
preview (which files it would fold, which it would delete) and leaves both the fixture `FINDINGS.md`
and the staged file byte-for-byte untouched; `--bogus-flag-xyz` prints `Unrecognized flag(s): ...`
and exits 1, FINDINGS.md and the staged file again untouched. A real invocation with no flags still
folds and deletes exactly as before.

Added regression coverage to `src/findings-fold-staging.test.ts` (the existing, established test
file for this script): a `--dry-run` preview test (asserts the output names the file it would fold,
FINDINGS.md stays byte-identical, the staged file survives), a `--dry-run`-still-catches-a-malformed-
file test, an unrecognized-flag test (non-zero exit, FINDINGS.md untouched, staged file survives),
and a flagless-real-fold-still-works test. Full relevant file: 17/17 pass (13 pre-existing + 4 new).
`npx tsc --noEmit` clean. Full suite on Node 20 (`npm test`): 18696 tests, 18693 pass, 0 fail, 3
skipped (same 3 pre-existing skips as the baseline run before this change) — exit 0.

### Fix rationale

Two classes of risk share one root cause (no flag validation at all), so both are fixed together
rather than just patching `--dry-run` in isolation:

1. **A real `--dry-run`.** It runs the exact same discovery/parsing/validation logic as a real fold
   (so a malformed staged file is still reported, same as today) but gates every filesystem WRITE
   (`writeFileSync` on `FINDINGS.md`, every `rmSync` on a staged file) behind a `DRY_RUN` check,
   printing `[DRY RUN]`-prefixed summaries of what would happen instead. This is deliberately a thin
   layer over the existing control flow — no restructuring of the fold/discovery/validation logic
   itself.
2. **Any other unrecognized flag now exits non-zero with a clear error** listing the flags the
   script actually supports, before any file I/O that could mutate state. This is the blanket guard
   against the broader failure class — the same silent-fallthrough would otherwise still be live for
   the NEXT typo'd flag, not just this one.

What was deliberately left unchanged: the fold/discovery/validation logic itself (heading detection,
kind-line normalization, idempotency, fence-awareness) — none of that needed to change to fix this;
only the argument-handling surface around it did.

### Blast radius

Single file, single script: `scripts/audit/findings-fold-staging.mjs`. No other script imports or
shells out to it (it is invoked directly by the coordinator via
`node scripts/audit/findings-fold-staging.mjs` with no flags, which is unaffected — the real-fold
path is byte-for-byte the same when no flags are passed). No change to
`docs/audit/findings-staging/README.md`'s documented convention or to `lib/findings-entry-set.mjs`.
