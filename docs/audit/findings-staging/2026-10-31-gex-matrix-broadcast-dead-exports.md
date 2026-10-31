# 2026-10-31 gex-matrix-broadcast.ts: `clearSubscribers`/`getSubscriberCount` dead-on-arrival since the module's creation

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead-code removal (confirmed zero behavior change) |

## Root cause

`src/lib/gex-matrix-broadcast.ts` is the server-side SSE subscriber registry for GEX matrix delta
broadcasts (`heatmap-warm` cron → `broadcastMatrixDelta()` → all open `/api/market/gex-matrix-deltas`
connections). It exported four functions. Only two are ever imported anywhere in the repo:

- `broadcastMatrixDelta` — imported by `src/app/api/cron/heatmap-warm/route.ts`.
- `subscribeMatrixDeltas` — imported by `src/app/api/market/gex-matrix-deltas/route.ts`.

The other two, `getSubscriberCount` (doc comment: "for monitoring") and `clearSubscribers` (doc
comment: "used in tests"), have **zero call sites anywhere in the repository, including the test
tree** — neither function is referenced by any `.ts`/`.tsx`/`.mjs`/`.cjs`/`.js` file outside their
own definitions (verified with a repo-wide grep). The "used in tests" claim in `clearSubscribers`'s
own doc comment was never actually true: there has never been a `gex-matrix-broadcast.test.ts` (or
any other test file) that imports it — this module had **no test coverage at all** before this fix.

This had been flagged across rounds 157-159 of the ongoing dead-code sweep as "weakest narrative,
needs full independent re-trace" — specifically because a monitoring-only getter and a
test-only reset function are exactly the shape of code that's often intentionally parked for a
near-future consumer (e.g. an admin monitoring endpoint, or a test suite not yet written), not
necessarily abandoned scaffolding. That re-trace is what this entry does:

- `git log --all --oneline -S"clearSubscribers"` and the same for `"getSubscriberCount"` each
  return exactly **one** commit: `a05cf3245` — the 2026 "replace blackout-web with sandbox
  codebase" migration squash (#770). The module has had no commits since. There is no later PR
  that adds a consumer, no feature flag gating a monitoring route behind these, and no TODO/WIP
  marker anywhere in the file referencing planned work — unlike `isAmendmentOf` in
  `flow-amendment.ts` (correctly ruled OUT in round 159 for being part of a cohesive, deliberately
  flagged-off WS-22 feature). This is dead-on-arrival code carried in by a bulk migration, not
  parked work with a traceable plan.
- No admin/monitoring route anywhere in `src/app/api/` reads subscriber counts for this channel
  (grep for `getSubscriberCount`/`gex-matrix-broadcast` across `src/app/api/admin` returns
  nothing), so the "for monitoring" comment describes a consumer that was never built.

## Evidence

- Repo-wide grep for both symbol names, before the fix, matches only their own `export function`
  lines in `src/lib/gex-matrix-broadcast.ts` — no import, no call, no test reference anywhere else
  in the tree.
- `git log --all -S"clearSubscribers"` / `-S"getSubscriberCount"` each return exactly one commit
  (the migration squash), confirming these were never wired to a caller at any point in this
  repo's history, not just currently unused after a refactor.
- Zero-reference proof stands in for a RED→GREEN stash proof here (per the dead-code removal
  discipline): there is no caller-observable behavior to regress, because no caller exists.

## Blast radius

None beyond the file itself. The two real consumers (`heatmap-warm` cron and the
`gex-matrix-deltas` SSE route) only ever imported `broadcastMatrixDelta` and
`subscribeMatrixDeltas` respectively — both untouched by this fix, confirmed by re-grepping their
imports post-fix.

## Fix

Removed the unused `getSubscriberCount` and `clearSubscribers` exports and their doc comments.
`broadcastMatrixDelta` and `subscribeMatrixDeltas` are unchanged.

Also added `src/lib/gex-matrix-broadcast.test.ts` — this module previously had **no test file at
all** despite being a real, live-traffic SSE fan-out path (cron-driven broadcast to member
connections). The new tests cover the two real exports: a subscriber receives a broadcast payload,
a subscriber whose `write()` rejects is pruned and does not receive subsequent broadcasts, and an
unsubscribed writer stops receiving broadcasts. This gives the surviving code real regression
coverage it never had, rather than leaving the fix as a pure subtraction with nothing added back.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/gex-matrix-broadcast.test.ts` — 3/3
  green (new file).
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/gex-matrix-broadcast.ts src/lib/gex-matrix-broadcast.test.ts` — clean.
- Confirmed `src/app/api/cron/heatmap-warm/route.ts` and
  `src/app/api/market/gex-matrix-deltas/route.ts` still import only `broadcastMatrixDelta` and
  `subscribeMatrixDeltas` respectively, post-fix.
