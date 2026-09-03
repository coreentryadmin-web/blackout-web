# BLACKOUT AUTOPILOT — readiness verification (2026-09-03)

Strict, evidence-based readiness check, written in response to a direct operator demand for
verification rather than a summary. Format follows the operator's own checklist. Every claim below
either cites a file/command/live-tested output, or is explicitly marked unverified. Nothing here
was written first and then justified — every PASS below has a command or file behind it that a
skeptical reader can re-run.

## 1. Shared durable state

Location: `.blackout-agent/` at repo root (committed to git, so it survives a container restart
the same way any other file does). Actual files, all real, all present as of this commit:

```
.blackout-agent/README.md, AGENT_STATE.json, ACTIVE_WORK.md, WORK_QUEUE.json, ROADMAP.md,
FINDINGS.json, LAST_HANDOFF.md, DECISIONS.md, COVERAGE.json, REGRESSIONS.json,
PRODUCT_STATE.json, PRODUCTION_HEALTH.json, PERFORMANCE_BASELINE.json, SEO_GEO_BACKLOG.md,
HEARTBEAT/claude.json, HEARTBEAT/cursor.json (placeholder, see §11),
LOCKS/ (currently holds LOCKS/BO-AUTOPILOT-0001.lock),
RUN_HISTORY/claude/2026-09-03-bootstrap.json, RUN_HISTORY/cursor/.gitkeep,
EVENTS/2026-09-03-events.jsonl
```

**Confirmed a fresh session can recover current task, owner, phase, branch, PR, evidence,
blockers, and next action** — see §2, this is not asserted, it was tested live.

## 2. Session recovery — does NOT depend on chat history

**Test performed:** spawned a brand-new subagent (`general-purpose`, zero conversation history,
same repo checkout) and told it only: read `CLAUDE.md`'s AUTOPILOT section, follow whatever
recovery order it finds, read the state it's pointed to, then report the current highest-priority
task, owner, branch, PR, proven evidence, and exact next action — without being told any of it.

**It correctly reported, unprompted:** task `BO-AUTOPILOT-0001`, owner `claude`, branch
`fix/blackout-agent-autopilot`, no PR yet, all 4 pieces of proven evidence (shared gamma matrix,
atomic lease, stale-lease refuse/reclaim, live scheduler), and named the exact next action from
`LAST_HANDOFF.md` §9 correctly.

**It also independently cross-checked ground truth (per the README's step 8) and caught a real
staleness bug**: `AGENT_STATE.json` said PR #3425 was still `TESTING`; the subagent queried the
GitHub API itself and found it was actually **merged and closed**. That state entry has since been
corrected (see `git log` on `AGENT_STATE.json` / `FINDINGS.json`). This is the single strongest
piece of evidence in this whole report — it proves both that fresh recovery works AND that the
system's own designed ground-truth-check step catches drift rather than propagating it silently.

**Unfinished work resumed before unrelated discovery:** yes — the subagent named
`BO-AUTOPILOT-0001` as top priority and did not go looking for unrelated work, matching the
"resume before discover" rule.

## 3. Continuous checkpointing

**What exists:** `scripts/agent-ops/heartbeat.mjs` (renew liveness), `claim-task.mjs`/
`release-task.mjs` (lease transitions), and an `EVENTS/*.jsonl` append-only log format. `CLAUDE.md`
and `.blackout-agent/README.md` both document *when* to checkpoint (after finding, reproduction,
root cause, implementation milestone, test, commit, PR, review, merge, deploy, prod verification,
blocker, or priority change).

**What does NOT exist:** no hook or CI step forces a checkpoint write. It is a documented
discipline, not code-enforced. §2's finding is direct proof this matters: `AGENT_STATE.json` went
stale within the same session because nothing re-synced it automatically when PR #3425 merged.

**Honest verdict: PARTIAL.** The mechanism and the trigger-event list are real; automatic,
enforced checkpointing is not built. Recommendation before calling this fully solved: a cheap
periodic job (could ride the existing hourly coordinator trigger) that re-derives `AGENT_STATE.json`
active-work phases from live PR state rather than trusting the last hand-edit.

## 4. Task claiming / leases

Schema (see `AGENT_STATE.json` entries and `LOCKS/*.lock`):
```json
{ "task_id": "...", "owner": "...", "claimed_at": "ISO8601", "lease_until": "ISO8601" }
```
**Collision test, run live, this session** (not simulated, not asserted):
```
$ node scripts/agent-ops/claim-task.mjs BO-TEST-COLLISION claude 5 &
$ node scripts/agent-ops/claim-task.mjs BO-TEST-COLLISION cursor 5 &
A: CLAIMED BO-TEST-COLLISION by claude, lease until 2026-09-03T23:38:04.270Z   (exit 0)
B: NOT CLAIMED: BO-TEST-COLLISION already held by claude ...                   (exit 1)
```
Exactly one claim succeeded — arbitrated by the filesystem's `O_EXCL` open, not by application
logic that could race. **Stale-lease recovery: PASS**, see §5.

## 5. Heartbeat

Location: `.blackout-agent/HEARTBEAT/<agent>.json`. Real content, Claude side, as of this report:
```json
{ "agent": "claude", "last_seen": "2026-09-03T23:33:25Z", "run_id": "session_01Qtnftc...",
  "task": "BO-AUTOPILOT-0001", "phase": "IMPLEMENTING", "branch": "fix/blackout-agent-autopilot",
  "pr": null, "healthy": true }
```
Tracks `last_seen`, `task`, `phase`, `run_id`, `branch`/`pr`, `healthy` — all present.

**Stale/dead detection, both directions proven live this session:**
- Expired `lease_until` + **fresh** heartbeat → `recover-stale-lease.mjs` printed `NOT RECLAIMED`
  and exited 1 (refused to steal from a slow-but-alive agent).
- Expired `lease_until` + heartbeat **213.3 minutes** stale → printed `RECLAIMED` with the computed
  age as evidence, exited 0, lock removed.

**Cursor's heartbeat: not yet real.** `HEARTBEAT/cursor.json` is a placeholder with the expected
schema and an explicit note that no Cursor session has ever written it. Marked honestly, not
faked.

## 6. Scheduler / runner — THE important part

**Actual mechanism:** Claude Code Remote Routines — server-side, cron-driven, independent of any
running session. Confirmed live via `list_triggers` (not assumed, not described from memory):
dozens of enabled Routines already exist in this account/repo, including:
- Hourly coordinator-cycle triggers (two, offset 30min apart)
- Six "4-engine live monitor" triggers at `:00/:10/:20/:30/:40/:50` past every hour
  (`cron_expression`: `"10 * * * *"` etc.)
- **`DISCOVERY lane — 24/7 new-work sweep`** at `15 * * * *` — this is the pre-existing mechanism
  that already satisfies §7's "empty queue enters discovery mode" requirement
- A PR-activity subscription trigger, plus numerous one-shot "chase/nudge" triggers for specific
  stalled PRs

**Cadence:** hourly for the coordinator cycle; every 10 minutes for the 4-engine monitor;
hourly (`:15`) for discovery. **What launches it:** the Claude Code Remote platform itself — not
this repo, not a GitHub Action, not something this session controls or could disable/misconfigure
from inside the repo. **Where it runs:** server-side, outside any single session's container —
confirmed by the fact this exact session has been woken by these triggers dozens of times across
its own history (visible in this conversation's own prior turns), i.e. survival across container
restarts is not hypothetical, it already happened repeatedly before this bootstrap existed.
**Overlap prevention / crash / restart behavior:** owned by the Claude Code Remote platform, not
by repo code — this session has no visibility into its internal retry/backoff implementation and
this report will not claim knowledge it doesn't have. What IS observable: multiple named triggers
(hourly, 10-min offsets) have continued firing across this session's whole lifetime without this
session ever seeing a duplicate/overlapping wakeup collide destructively.

**Honest verdict: PASS for "scheduler exists and can invoke Claude."** This is **pre-existing
infrastructure this bootstrap did not build** — it was discovered and is now documented/relied-on,
per the instruction to reuse rather than duplicate existing mechanisms.

## 7. Scheduled invocation test

**Historically:** yes, repeatedly, throughout this session's lifetime (multiple coordinator-cycle
and 4-engine-monitor firings are part of this conversation's own history, prior to this bootstrap).

**Specifically exercising the NEW `.blackout-agent/` state built in this bootstrap: NOT YET
VERIFIED.** These files were created within this same turn; no scheduled trigger has fired since
they were written. The closest available proof is §2's fresh-subagent test, which is a manually
launched proxy for "a new invocation with no history," not literally "the configured scheduler
fired and read this state." **This is marked exactly as the operator instructed — not yet
verified — rather than rounded up to a pass.** Expect real confirmation on the next `:15` DISCOVERY
firing or hourly coordinator cycle after this is merged; check `.blackout-agent/EVENTS/` and
`HEARTBEAT/claude.json`'s `last_seen` after that time to confirm.

## 8. Zero-idle / work discovery

Enforced today by two independent things: (a) `CLAUDE.md`'s pre-existing `NEVER SIT IDLE WHILE
WAITING` section (confirmed 2026-08-28, predates this bootstrap), and (b) the live `DISCOVERY
lane — 24/7 new-work sweep` trigger (§6). This session's own history already demonstrates the
behavior working end-to-end without code: directly challenged twice this session ("what's in your
backlog," "so you don't have any work") and both times found real, verifiable work rather than
reporting idle. **PASS**, evidenced by actual session behavior, not just a rule existing on paper.

## 9. Finding lifecycle

14-state vocabulary defined in `CLAUDE.md`'s new section and `.blackout-agent/README.md`/
`FINDINGS.json`. Applied live in this bootstrap: `BO-P2-3425` was carried at `TESTING`, corrected
to `MERGED` once ground-truth showed it, and still needs `DEPLOYED`/`PROD_VERIFY`/`CLOSED` before
it's fully done — the file says so explicitly rather than rounding up to done. Duplicate check:
`.blackout-agent/FINDINGS.json` + `docs/audit/FINDINGS.md` + `findings-staging/` are the three
places checked before filing anything new (documented in `FINDINGS.json`'s own header note).

**Honest verdict: PARTIAL.** The vocabulary and the duplicate-check discipline are real and were
just used correctly on a real item. What's NOT done: the hundreds of historical entries in
`docs/audit/FINDINGS.md` have not been retroactively tagged with a lifecycle state — out of scope
for this pass, flagged rather than silently skipped.

## 10. PR / review model

Schema supports it (`reviewer` field on every `AGENT_STATE.json` entry, `DECISIONS.md`/`README.md`
state the "any commit after approval invalidates prior approval" rule matches `CLAUDE.md`'s
existing "a merge is not a verification" / re-check-against-current-head discipline). **No actual
Claude↔Cursor cross-review has been exercised** — this session cannot invoke a real Cursor session
to test it. **Honest verdict: PARTIAL** (schema-ready, integration-tested only for the
human/CI-review path that already existed, not for agent-to-agent review).

## 11. Cursor readiness

- **Can join without a separate roadmap/findings/queue:** yes — `.blackout-agent/*` is plain
  JSON/Markdown with no Claude-specific API, and `.cursor/rules/blackout-agent-autopilot.mdc`
  (new, `alwaysApply: true`) now points Cursor at the same files.
- **Files Cursor should read:** the same RECOVER order as Claude — `.blackout-agent/README.md`
  first, then everything it points to.
- **Files Cursor may update:** `HEARTBEAT/cursor.json` (via `heartbeat.mjs cursor`), its own
  `LOCKS/<task_id>.lock` entries it claims, `RUN_HISTORY/cursor/*`, and — like any contributor —
  `AGENT_STATE.json`/`ACTIVE_WORK.md`/`FINDINGS.json` when it advances a task's phase. It should
  NOT hand-edit another agent's lock or heartbeat file.
- **How it claims work without colliding with Claude:** same `claim-task.mjs` — the OS-level
  `O_EXCL` guarantee is agent-agnostic, proven in §4.
- **What's still missing before real integration:** (1) no actual Cursor session has ever run
  these scripts — zero live evidence Cursor's harness can/will execute them; (2) no event-driven
  "Claude opened a PR → Cursor wakes to review it" wiring exists — Cursor's own scheduling is a
  platform this session doesn't control from here; (3) `HEARTBEAT/cursor.json` is a placeholder,
  not real data.

## 12. Crash recovery — what would the next instance resume RIGHT NOW

Live contents of `.blackout-agent/AGENT_STATE.json`'s top active-work entry, at the moment of
writing this report:
```json
{ "task_id": "BO-AUTOPILOT-0001", "priority": "P2",
  "title": "Build .blackout-agent/ durable-state + lease/heartbeat/recovery system",
  "owner": "claude", "phase": "IMPLEMENTING", "branch": "fix/blackout-agent-autopilot", "pr": null,
  "lease_until": "2026-09-04T01:33:25Z" }
```
This is not hypothetical — §2's fresh subagent read exactly this and correctly resumed from it.

## 13. Acceptance status

| Item | Verdict | Evidence |
|---|---|---|
| Durable state | **PASS** | `.blackout-agent/` committed, real content, listed in §1 |
| Fresh-session recovery | **PASS** | §2 — live subagent test, correctly resumed + caught real drift |
| Continuous checkpointing | **PARTIAL** | §3 — mechanism exists, not enforced/automatic; drift observed |
| Task leases | **PASS** | §4 — real schema, live-tested |
| Collision prevention | **PASS** | §4 — live concurrent-claim test, exactly one winner |
| Heartbeat (Claude) | **PASS** | §5 — real file, real fields |
| Heartbeat (Cursor) | **FAIL** | §5/§11 — placeholder only, never written by a real Cursor session |
| Stale-session recovery | **PASS** | §5 — both refuse/reclaim branches proven live |
| Autonomous work discovery | **PASS** | §8 — pre-existing trigger + demonstrated session behavior |
| Finding lifecycle | **PARTIAL** | §9 — vocabulary + dedup real; historical corpus untagged |
| Claude→Cursor review readiness | **PARTIAL** | §10 — schema-ready, never exercised live |
| Cursor→Claude review readiness | **PARTIAL** | §10 — same |
| Scheduler configured | **PASS** | §6 — `list_triggers`, dozens of live Routines |
| Scheduler can actually invoke Claude | **PASS** | §6 — empirically true across this session's history |
| Successful scheduled invocation (of THIS new state) | **NOT YET VERIFIED** | §7 — no trigger has fired since these files were created |
| Crash recovery | **PASS** | §12 — live state shown, independently confirmed correct in §2 |

## What's missing, why, and what's recommended

1. **Continuous checkpointing isn't automatic.** Fix now: add a cheap "re-sync `AGENT_STATE.json`
   phases from live PR state" step to the existing hourly coordinator-cycle trigger's routine
   prompt. Not built in this pass — flagging rather than pretending it's done.
2. **Cursor has never actually run this.** Cannot be fixed from this sandbox — there is no way to
   invoke a real Cursor session here. What IS fixed now: the `.cursor/rules/` pointer file, so the
   next real Cursor session that reads its own rules will find the protocol.
3. **No scheduled fire has exercised the new state yet.** Not fixable synchronously — it requires
   waiting for the next real trigger fire. Check `EVENTS/` and `HEARTBEAT/claude.json` after the
   next `:15` or top-of-hour fire to close this out.
4. **Cross-agent review is unexercised.** Requires an actual second Cursor PR or Cursor reviewing
   an actual Claude PR to prove — recommend the first real integration test be exactly that: open
   this bootstrap's own PR, and have a real Cursor session review it.

## Verdict

**NOT READY FOR CURSOR** — specifically because §11's three missing items (no real Cursor
invocation has ever touched this, no event-driven review wiring, `HEARTBEAT/cursor.json` still a
placeholder) are integration gaps only a real Cursor invocation can close, not something provable
from this sandbox. Structurally ready (files, scripts, rules pointer all in place); operationally
unverified for Cursor specifically. Recommendation: give Cursor the integration prompt now — the
first real Cursor session against this repo IS test B/F, there's no further sandbox-side work that
can substitute for it — but expect this document's Cursor-related rows to move from PARTIAL/FAIL to
PASS only after that session actually runs `heartbeat.mjs cursor` and this file is updated with its
real output, not before.
