# DECISIONS — pointer

`docs/audit/INTENTIONAL-DESIGN.md` already IS BlackOut's deliberate-decisions log (0DTE-scoped) and
predates this bootstrap. Add new deliberate-design decisions there, in its existing format, rather
than starting a second log here.

Decisions specific to the Autopilot system itself (not a product decision, an infra one) are
recorded below instead:

## 2026-09-03 — Reuse existing scheduler rather than build a new one
The Autopilot bootstrap request asked to "determine what durable execution mechanisms are actually
available... do not assume, inspect first." `list_triggers` showed dozens of live, firing,
cron-based Routines already running in this account/repo — hourly coordinator cycles, 10-minute
4-engine monitors, and a `DISCOVERY lane — 24/7 new-work sweep` trigger. Building a second scheduler
would have been the exact "blindly duplicate existing infrastructure" failure mode the request
itself warned against. Decision: `.blackout-agent/` is state for that existing scheduler to read,
not a new runner.

## 2026-09-03 — Lease staleness requires heartbeat evidence, not just lease_until expiry
`recover-stale-lease.mjs` refuses to reclaim a task whose lease_until has passed if the owner's
heartbeat is still fresh, per the explicit "never steal a task merely because an agent is
temporarily slow" requirement. Verified live in both directions (see
`docs/audit/AUTOPILOT-STATUS.md` §4).

## 2026-09-03/04 — REAL collision: Cursor independently built a competing `.blackout-agent/` in PR #3436
Not a hypothetical — Cursor opened `cursor/blackout-autopilot` (PR #3436) ~5 minutes after this PR
(#3435), building the exact same directory structure (`AGENT_STATE.json`, `ACTIVE_WORK.md`,
`LAST_HANDOFF.md`, `HEARTBEAT/`, `RUN_HISTORY/`, `README.md`, `ROADMAP.md`, `DECISIONS.md`) with no
shared lease to prevent it, because the lease system that would have prevented this didn't exist
yet when either of us started building it — a genuine chicken-and-egg bootstrap collision, not a
process failure by either agent. Cursor's build is broader (event-driven GitHub Actions dispatch
workflow, 13 scripts vs. this PR's 4) but has a real correctness bug: `claimLock` in
`scripts/blackout-agent/lib/locks.mjs` reclaims any lock past `lease_until` unconditionally, with
NO heartbeat check — violating the operator's explicit "never steal from a merely-slow agent,
verify heartbeat first" requirement, which THIS PR's `recover-stale-lease.mjs` does implement and
has proven live (both branches). Posted a full review on #3436
(https://github.com/coreentryadmin-web/blackout-web/pull/3436#issuecomment-5533797276) flagging
the heartbeat-gate gap and an open CodeQL high-severity alert as merge blockers. **Not resolving
by unilaterally closing either PR** — recommended consolidating on #3436's broader scope once its
blockers are fixed, tracked as `BO-CONSOLIDATE-AUTOPILOT` in `WORK_QUEUE.json`. The lesson for any
future bootstrap-shaped task: the very first thing built under a NEW shared-state scheme is the
one thing that scheme itself cannot yet protect against duplication — check for a competing PR
touching the same novel directory before assuming a clear field, even directly after opening one.

## 2026-09-03 — `.blackout-agent/*` JSON/MD files are hand-authored snapshots, not live-generated
No cron currently regenerates `AGENT_STATE.json`/`ACTIVE_WORK.md`/etc. automatically from GitHub/CI
state. Each file says so explicitly ("re-verify against ground truth"). Building an auto-sync job
was judged out of scope for this bootstrap pass — flagged in `docs/audit/AUTOPILOT-STATUS.md` as a
`PARTIAL` on continuous checkpointing, not silently glossed over.
