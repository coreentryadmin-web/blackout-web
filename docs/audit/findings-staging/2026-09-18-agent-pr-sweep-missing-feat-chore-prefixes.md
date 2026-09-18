> **kind:** `FINDING`

## `agent-pr-sweep.mjs`'s default branch-prefix list silently missed `feat/` and `chore/` — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Coordinator tooling (`scripts/audit/agent-pr-sweep.mjs`) — found during a routine coordinator cycle |
| **Severity** | P2 (tooling correctness — the sweep is the one instrument built specifically to catch a jam with no other error signal) |
| **PR** | fix/agent-pr-sweep-missing-feat-chore-prefixes |

### Root cause

`agent-pr-sweep.mjs`'s default `PREFIXES` constant was
`"claude/,cursor/,fix/,batch/,docs/"` — it never included `feat/` at all, and `chore/` (used
alongside `docs/` for maintenance/audit PRs) was also missing. CLAUDE.md's own merge-authorization
section explicitly names `fix/*`/`feat/*`/`docs/*` as the self-authored branch conventions this
sweep exists to track, so the default list had drifted out of sync with the very policy it
implements.

### Evidence

- Live run this cycle: with two real, open, agent-authored PRs on the repo — #5234
  (`chore/fold-findings-staging-backlog-2`) and #5235 (`feat/legacy-desk-playbook-recap`) — the
  default-prefix sweep reported **`(0 open agent PRs)`**, a clean, confident, entirely false
  all-clear.
- Re-run with `--prefix=claude/,cursor/,fix/,batch/,docs/,feat/,chore/` immediately surfaced both:
  `CI-RUNNING (2): #5235, #5234`.
- `git log --oneline` confirms `feat(...)` is a routine, frequently merged PR-title/branch
  convention in this repo (e.g. #5226, #5222, #5217, #5200), not an edge case.
- Post-fix, a plain default-argument run correctly reports the real state (1 open agent PR after
  #5234 merged, #5235 still CI-running) — no `--prefix` override needed anymore.

### Blast radius

Single constant, one file. No other script imports `agent-pr-sweep.mjs`'s `PREFIXES`.

### Fix rationale

Extended the default `PREFIXES` list to `claude/,cursor/,fix/,batch/,docs/,feat/,chore/`, matching
CLAUDE.md's own stated branch conventions. Left `--prefix` overridable exactly as before — this
only changes what a bare invocation defaults to, per this script's own comment block precedent for
why `fix/` and `batch/` were added (2026-08-21, the coordinator's own PRs being invisible to the
sweep it was running).

### Verification

Reproduced the false all-clear live (default-prefix run showed 0 PRs while 2 real ones were open),
confirmed the fix live (default-prefix run now shows both, then correctly shows just the remaining
one after #5234 merged). This is an audit CLI script with no existing test harness (consistent with
the rest of the live-hitting audit toolkit, which is verified by live runs rather than unit tests)
— no test file was added; `npx tsc --noEmit` is not applicable (plain `.mjs`, no TS).
