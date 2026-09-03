# `.blackout-agent/` — durable operational state (not the constitution)

**This directory is state, not policy.** The permanent operating rules — the 24/7 mandate,
issue-handling policy, merge authorization, PR write-up policy, environment realities — live in
`CLAUDE.md` at the repo root, which every Claude session in this repo auto-loads on start. Nothing
in here duplicates or overrides `CLAUDE.md`. If you're looking for "how should I operate," go
there. This directory answers "what is happening right now, and what's next."

Built 2026-09-03 in response to the BLACKOUT AUTOPILOT bootstrap request. **Read
`docs/audit/AUTOPILOT-STATUS.md` for the honest, line-by-line readiness verification** (what's
proven vs. not) before trusting any claim below at face value.

## RECOVER → RESUME → DISCOVER

Every new Claude (or Cursor, once integrated) invocation in this repo should read, in this order,
**before starting unrelated work**:

1. `CLAUDE.md` (auto-loaded — the constitution)
2. `.blackout-agent/LAST_HANDOFF.md` — what the last session was doing and why
3. `.blackout-agent/AGENT_STATE.json` — the live snapshot: active work, owners, phases, leases
4. `.blackout-agent/ACTIVE_WORK.md` — human-readable detail on each in-flight item
5. `.blackout-agent/HEARTBEAT/*.json` — is any owner's claim still alive?
6. `.blackout-agent/WORK_QUEUE.json` — unclaimed queued work, if any active item needs a successor
7. `.blackout-agent/ROADMAP.md` — pointers to the standing roadmap docs (not duplicated here)
8. Open PRs (`gh`/GitHub MCP) + `git branch -a` — ground-truth check against what state *claims*
9. `docs/audit/FINDINGS.md` + `docs/audit/findings-staging/` — has this exact issue been seen before?

**Resume unfinished high-priority (P0/P1) work before entering discovery.** If `WORK_QUEUE.json`
has no claimable actionable item and no active-work item needs a successor, enter DISCOVERY MODE
per `CLAUDE.md`'s `NEVER SIT IDLE` section and the pre-existing `DISCOVERY lane — 24/7 new-work
sweep` scheduled trigger (`15 * * * *` — see `docs/audit/AUTOPILOT-STATUS.md` §6 for the full
scheduler inventory).

## Files

| File | Purpose |
|---|---|
| `AGENT_STATE.json` | Machine-readable snapshot: active work items, owner, phase, lease, branch, PR |
| `ACTIVE_WORK.md` | Human-readable detail per active item — same items as AGENT_STATE, prose form |
| `WORK_QUEUE.json` | Unclaimed queued work (empty right now — see DISCOVERY note above) |
| `LAST_HANDOFF.md` | The 9-question handoff doc: what/why/who/proven/changed/branch/PR/remains/next |
| `FINDINGS.json` | Lifecycle INDEX for items currently in-flight only — NOT a duplicate of `docs/audit/FINDINGS.md`, which remains the historical source of truth |
| `ROADMAP.md` | NOW/NEXT/LATER pointer into the existing roadmap docs (certification-mandates, INTENTIONAL-DESIGN, 0DTE-RESEARCH) — does not re-author them |
| `DECISIONS.md` | Pointer: `docs/audit/INTENTIONAL-DESIGN.md` already IS the deliberate-decisions log — add new decisions there, not here |
| `COVERAGE.json` | QA coverage seed — last-known-tested dates per product surface, from existing audit scripts |
| `REGRESSIONS.json` | Index of regression tests added per real fix this session/recent sessions |
| `PRODUCT_STATE.json` | Per-product current-state summary (Vector/Night Hawk/SPX Slayer/Thermal/Helix/Meridian/Largo) |
| `PRODUCTION_HEALTH.json` | Last-known production health readings, honestly timestamped/staled |
| `PERFORMANCE_BASELINE.json` | Measured perf numbers already established in CLAUDE.md, structured |
| `SEO_GEO_BACKLOG.md` | Pointer into the existing SEO lane state, not a new backlog |
| `HEARTBEAT/<agent>.json` | Per-agent liveness: last_seen, task, phase, branch, PR, healthy |
| `LOCKS/<task_id>.lock` | Atomic per-task claim files — see `scripts/agent-ops/claim-task.mjs` |
| `RUN_HISTORY/<agent>/*.json` | One file per completed work cycle, for audit trail |
| `EVENTS/*.jsonl` | Append-only event log (finding created, PR opened, merged, deployed, ...) |

## Task IDs

Format: `BO-P<priority>-<pr-or-finding-number>` for anything tied to a real PR/finding, or
`BO-<SLUG>-NNNN` for infrastructure work with no PR yet. IDs are never reused.

## Lease / claim protocol

```
node scripts/agent-ops/claim-task.mjs <task_id> <owner> [lease_minutes=30]   # atomic claim, fails if already held
node scripts/agent-ops/heartbeat.mjs <agent> '<json-fields>'                 # renew liveness
node scripts/agent-ops/recover-stale-lease.mjs <task_id> [--max-age-min=30]  # verify heartbeat, reclaim ONLY if truly dead
node scripts/agent-ops/release-task.mjs <task_id> <owner>                    # release your own claim
```

Never hand-edit `LOCKS/*.lock` or `HEARTBEAT/*.json` — always go through the scripts, so the
staleness checks stay honest (a hand-edited heartbeat can lie about liveness).
