# validate-deploy's Postgres catch block under-classified transient errors — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## What broke

`scripts/validate-deploy.mjs`'s post-deploy Postgres check caught connection failures with
`isPrivateDbUnreachableError(e.message)` and reported the bare `e.message` on failure. The
sibling scripts (`scripts/rth-open-check.mjs`, `scripts/gha-rth-audit.mjs`) hit the identical
connection-classification bug this week (closed PR cluster: #6584, #6576, #6595, #6592 — "RTH
open/deep audit red on transient Postgres disconnects") and fixed it there, but
`validate-deploy.mjs` carries the same catch-block shape and was never updated — the same root
cause, left open in a second file (blast radius this session's earlier duplicate-PR triage
flagged but didn't yet fix — see the closing comment on #6587).

Two gaps specifically:
- `isPrivateDbUnreachableError` is the narrower helper; `isTransientAuditPgError` (which already
  subsumes it) also catches `connection terminated`, `server login has been failing`, `too many
  clients`, and `remaining connection slots` — proxy/PgBouncer blips `isPrivateDbUnreachableError`
  alone treats as a hard `fail` instead of a benign skip.
- `e.message` alone drops any detail carried only on `e.cause` (a chained/wrapped connection
  error) — `describeConnectError` walks the whole cause chain and never returns an empty string.

## Fix

Swap to the same `describeConnectError` + `isTransientAuditPgError` / `isStaleAuditDbAuthError`
pattern already shipped in `rth-open-check.mjs`, with a new regression test
(`validate-deploy.test.mjs`, new file — none existed for this script) asserting the source uses
the wider classification and not the old narrow-helper-plus-bare-message pairing.

Deliberately NOT adding a retry loop here (unlike `rth-open-check.mjs`/`gha-rth-audit.mjs`) —
`validate-deploy.mjs` runs once per deploy as a smoke check, not on a tight CI schedule, so the
retry complexity those scripts needed isn't warranted; this fix is scoped to the misclassification
only.

## Also checked, NOT a bug

The same file area has a vestigial `railway logs --service blackout-web | rg 'uw-socket' | ...`
check (Railway was fully decommissioned 2026-07-25 — no `railway` CLI exists in any current
environment). Initially flagged this as an `rg`-vs-`grep` portability risk, but the whole
`execSync` call is already wrapped in try/catch with an explicit `GITHUB_ACTIONS === "true"` skip
message — the command throws (no `railway` binary), is caught, and silently no-ops exactly where
it matters. Not touching it; a plain `rg`/`grep` swap would not change behavior, and ripping out
the dead Railway reference is a separate, non-urgent cleanup.

## Verify

- `node --import tsx --experimental-test-module-mocks --test scripts/validate-deploy.test.mjs` —
  1/1 pass post-fix; fails (RED) against the pre-fix source (git-stash confirmed).
- Next scheduled `validate-deploy` run after a production deploy.
