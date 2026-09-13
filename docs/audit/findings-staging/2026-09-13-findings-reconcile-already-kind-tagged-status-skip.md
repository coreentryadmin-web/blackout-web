> **kind:** FINDING

# `findings-reconcile.mjs --apply` never checked status on an entry that already had a kind line

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `scripts/audit/findings-reconcile.mjs` — the `--apply` tagging pass that flags entries missing a real outcome |
| **Severity** | P3 — audit-tooling correctness. The bug hides exactly the class of entry (a real finding with no status, or a stale mid-flight one) this script exists to surface for next-session review. |

## Root cause

```js
const tagged = keep.map((r) => {
  if (/\n> \*\*kind:\*\*/.test(r.block)) return r.block.replace(/\s+$/, ""); // already tagged
  ...
  const needsStatus = r.status == null;
  const note = needsStatus ? "...UNRECONCILED..." : r.stale ? "...UNRECONCILED..." : null;
  ...
});
```

The "already tagged" shortcut treated the mere presence of a `> **kind:**` line as proof the whole
entry had already been reconciled by THIS script, and returned it byte-for-byte unchanged —
skipping the status/staleness check entirely.

That assumption is false: `findings-fold-staging.mjs` (a separate script) stamps
`> **kind:** \`FINDING\`` on every staged file it folds into `FINDINGS.md`, per the standing
issue-handling policy requirement that every staged entry carry a kind line — independently of
whether that staged file's own author ever wrote a real status. So a freshly-folded entry with no
status line at all (or a stale "PR pending"/"auto-merge" one, never revisited) already has a kind
line the moment it lands in `FINDINGS.md`, and `findings-reconcile.mjs --apply` would return it
unchanged on every single run, forever — its missing/stale status never flagged UNRECONCILED, no
matter how many times the "safe to re-run" reconciler ran.

Found live 2026-09-13 while folding this session's own staged findings via
`findings-fold-staging.mjs`: the fold brought in two long-standing entries exactly matching this
shape (one with no status line, one with a stale "Fixed, PR pending"), and a subsequent
`findings-reconcile.mjs --apply` left both with 0 `UNRECONCILED` tags. `findings-hygiene.test.ts`'s
own idempotency test caught the resulting inconsistency — a from-scratch regeneration (which strips
all kind/status lines first, so the buggy shortcut never fires there) produced 2 `UNRECONCILED`
tags while the just-applied committed file had 0.

## Blast radius

Only `findings-reconcile.mjs`'s `--apply` tagging pass. No effect on classification counts (the
dry-run summary already correctly counted these 2 entries as needing a decision) — only the
WRITTEN file silently never got the flag. Also fixed a looser-than-intended guard regex in
`findings-hygiene.test.ts`'s own idempotency test (`/> \*\*kind:\*\*/` with no line anchor), which
false-failed the moment any folded entry's own prose quoted the tag syntax as a documentation
example (`` "no `> **kind:**` line found" ``) — anchored it to match the actual stripping regex
exactly (`^> \*\*(kind|status):\*\*`, `m` flag).

## Fix

Compute `needsStatus`/`note` unconditionally (not gated behind "no kind line yet"), and only truly
skip a block when it has BOTH a kind line already AND (no note is needed, or the UNRECONCILED note
is already present). When a kind line exists but a note is still needed, strip the existing kind
line back out and re-run the exact same insertion logic used for a from-scratch block — this
guarantees byte-identical formatting whether the kind line came from this script or from
`findings-fold-staging.mjs`, rather than maintaining a second insertion path.

## Why this fix, not an alternative

Considered inserting the note directly after the existing kind line via a splice, without
normalizing back through the from-scratch path first — rejected because it would require
duplicating the exact spacing/ordering rules the from-scratch path already encodes and tests,
risking the two paths drifting apart over time. Stripping-then-reusing keeps one formatting
implementation.

## Evidence

- Reproduced directly: `--apply` on the real (pre-fix) `FINDINGS.md` left the "Ask Largo
  `ticker-verdict.ts`..." entry (status `Fixed, PR pending`, stale) and the "`tsx` >=4.23.10..."
  entry (no status at all) both with 0 `UNRECONCILED` tags, despite the dry-run summary correctly
  counting both as needing a decision.
- New dedicated test file `scripts/audit/findings-reconcile.test.mjs` (5 tests) drives the REAL
  script over small throwaway fixtures via its existing env-var path overrides (same mechanism
  `findings-hygiene.test.ts` already uses).
- RED: reverted `findings-reconcile.mjs` only (kept the new tests) — exactly the 2 tests targeting
  this bug failed (`no status line` and `stale status`, both already-kind-tagged); the 3 tests for
  unaffected behavior (fully-reconciled-already, fresh-no-kind-line, double-apply-is-a-fixed-point)
  still passed, confirming the fix is scoped to the actual gap.
- GREEN: restored the fix — 5/5 new tests pass.
- `findings-hygiene.test.ts`: 9/9 pass (was 8/9 before both fixes — the guard-regex fix and the
  reconcile-script fix together, applied to the real file via `findings-reconcile.mjs --apply`).
- `--apply` run twice on the real `FINDINGS.md`: byte-identical (md5 match) — confirmed idempotent.
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14040/14043 pass, 0 fail, 3 skipped.

## What was deliberately left unchanged

The classification logic (`classify`, `statusOf`, `HEADING_OUTCOME`, `STALE_STATUS`, etc.) and the
PASS-LOG move-to-RUN-LOG.md path are untouched — this only changes which blocks the tagging pass
treats as "nothing left to do." The original stale/missing status text in an entry's body is never
deleted, only annotated, matching the script's existing "erring toward flagging is the safe
direction" philosophy stated in its own header.
