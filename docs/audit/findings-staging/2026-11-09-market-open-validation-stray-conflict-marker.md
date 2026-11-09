> **kind:** FINDING

## `docs/audit/MARKET-OPEN-VALIDATION.md` carried a leftover `>>>>>>> origin/main` conflict-marker artifact in `main` itself — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P4 (doc-only artifact, no code/behavior impact — tooling hygiene) |
| **Surface** | `docs/audit/MARKET-OPEN-VALIDATION.md` (WATCH LIST section, `redis_ttl`/`pg_editions` entry boundary) |
| **Found by** | Coordinator, while resolving an unrelated append-collision merge conflict on this same file for PR #7792 |

### Root cause

This shared, append-only file has had its WATCH LIST section repeatedly edited to resolve
append-collision merge conflicts (multiple sibling PRs appending a new entry at the same
insertion point against a moving `main` — the standing CLAUDE.md "CROSS-PR ORDERING
DEPENDENCIES"-shaped pattern this file is especially prone to). One earlier such resolution left
a bare `>>>>>>> origin/main` closing marker behind as literal text — confirmed present on `main`
directly (not merely in an open PR's diff) by diffing `origin/main`'s own copy of the file. The
line sat immediately after a complete, well-formed "redis_ttl" WATCH LIST entry and immediately
before an equally complete "pg_editions" entry, with no matching opening marker nearby — pure
leftover text from a merge resolution that removed the `<<<<<<<`/`=======` markers but missed
this one.

### Why it wasn't caught earlier

The file is markdown documentation, not code — no linter, test, or `tsc` pass reads it, so a
stray marker line renders as oddly-placed prose rather than failing any check. It was only
surfaced incidentally while diffing `origin/main`'s copy of the file against a PR branch during
an unrelated conflict resolution.

### Fix

Deleted the single orphaned `>>>>>>> origin/main` line. No other content changed — both
surrounding WATCH LIST entries were already complete and correct.

### Evidence

`grep -n "<<<<<<<\|^=======$\|>>>>>>>" docs/audit/MARKET-OPEN-VALIDATION.md` returns no matches
post-fix (returned the single stray line pre-fix). Doc-only change; no test/tsc surface to run.

### Blast radius

Single line, single file. No other conflict-marker artifacts found anywhere else in this file
(full-file grep, not scoped to one region).
