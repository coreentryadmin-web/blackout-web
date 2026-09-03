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

## 2026-09-03 — `.blackout-agent/*` JSON/MD files are hand-authored snapshots, not live-generated
No cron currently regenerates `AGENT_STATE.json`/`ACTIVE_WORK.md`/etc. automatically from GitHub/CI
state. Each file says so explicitly ("re-verify against ground truth"). Building an auto-sync job
was judged out of scope for this bootstrap pass — flagged in `docs/audit/AUTOPILOT-STATUS.md` as a
`PARTIAL` on continuous checkpointing, not silently glossed over.
