# The agent fleet — how it is launched, found again, and why

**Standing decision (2026-08-21).** Long-lived agents run as **remote sessions**, rediscovered by
listing, never by memory. This file is the source of truth for the lane list and the tags; a
coordinator with no recollection of what was launched can rebuild the whole picture from here plus
one API call.

## The failure this exists to prevent — a wrong tool read as proof

On 2026-08-21 the coordinator concluded the entire fleet had died, and wrote a plan to rebuild it
from scratch. **The fleet was alive.** All six lane sessions were running as remote sessions; two
were actively working at the moment they were declared dead.

The whole error rests on one call. `ListAgents` returned **"No reachable agents"**, and that was
taken as evidence. It is not evidence of anything about this fleet: **`ListAgents` enumerates
in-process subagents only and cannot see remote sessions at all.** Its silence was a statement
about a category the lanes were never in.

Three things turned one bad reading into a lost day, and each is worth naming because each will
recur:

1. **An absence was read as a fact.** "The tool returned nothing" became "there is nothing" —
   exactly the defect class this repo keeps finding in its own products, committed here in the
   coordinator's own reasoning.
2. **The wrong theory explained the evidence too well.** "The agents died with the container"
   accounted for every observation — the empty list, the stalled PRs, the silence — so it was never
   re-tested. A theory that explains everything is not confirmed by explaining one more thing.
3. **The roster lived in memory.** Had the coordinator been listing sessions rather than recalling
   which ones it started, the question would have been settled in a single call at any point.

The work was never at risk — 36 PRs sat safely in GitHub the entire time. What was actually broken
was much smaller and entirely mechanical: agent PRs are born as drafts, no agent can undraft its
own PR, and nothing was releasing them. See **THE DRAFT DEADLOCK** in `CLAUDE.md`.

## The rule

> **The work channel is GitHub. The control channel is disposable. Never let the second one hold
> state the first one cannot rebuild.**

Concretely:

- **Long-lived lane work → remote sessions** (`create_session` on the `claude-code-remote` MCP
  server). Each gets its own container and lifecycle, independent of the coordinator's.
- **`ListAgents` DOES NOT SEE REMOTE SESSIONS.** It enumerates in-process subagents only, so it
  reports "No reachable agents" while a full fleet of remote lanes is running. On 2026-08-21 that
  silence was read as proof the fleet had died; six lane sessions were alive the whole time, two of
  them actively working. **Never conclude the fleet is gone from `ListAgents` — use
  `list_sessions`.**
- **Short, single-shot fan-out → in-process subagents** is still fine. Losing one costs a retry,
  not a day.
- **Before replacing a lane, confirm it is actually gone** with `list_sessions` — not with
  `ListAgents`, and not from silence. If it is genuinely gone, spawn a fresh one pointed at the
  existing branch rather than trying to resurrect the old session: branch plus PR plus review
  comments carry everything a replacement needs.

## Discovery is a query, not a memory

Every lane session is tagged. A coordinator starting cold runs:

```
list_sessions(mine: true)          # then filter client-side on the `tags` field
```

and has the fleet back.

**Do not pass `tags:` to `list_sessions` — the filter is not implemented in this build** and
returns `tags filter is not currently available` (verified 2026-08-21). The tags ARE returned on
every row, so filter the response instead:

```python
lanes = [s for s in rows if "fleet:blackout" in (s.get("tags") or [])]
```

That distinction matters more than it looks: a filter that errors is recoverable, but had it
silently returned an empty list, the drill would have reported "no fleet" for six live sessions —
the same absence-as-fact trap this repo keeps paying for.

Each row carries `session_status`, `status_bucket` and a `post_turn_summary` that usually names
what a lane is waiting on, so one listing gives both the roster and its state. This is the same
principle as `scripts/audit/agent-pr-sweep.mjs`: **sweep by state, never by memory of what was
launched.** A coordinator that keeps a mental roster loses it on every restart; one that queries
never can.

## The control channel — how the coordinator actually talks to a lane

**There is no `send_message` tool on the `claude-code-remote` server, and `SendMessage` cannot
address a remote session.** Both facts led to the wrong conclusion that lanes were unreachable.
They are reachable; the mechanism is just named something else.

```
create_trigger(persistent_session_id: "<session id>", prompt: "<the message>")
fire_trigger(trigger_id: "<returned id>")
```

`create_trigger` with `persistent_session_id` targets ONE existing session, and `fire_trigger`
delivers immediately instead of waiting for a schedule. The prompt arrives in that session as an
ordinary user turn.

**Verified 2026-08-21, by behaviour rather than by return code.** Two lanes changed what they were
doing within seconds of delivery:

| Lane | Before | After |
|---|---|---|
| SEO | "Checking local git state and branch sync" | "#2448/#2454 conflict analysis; folding docs PR into code PR" |
| Meridian | `need_input` — "reopen remaining 6 draft PRs as fresh non-drafts" | `review_ready` — "rebasing branches on latest main" |

Meridian's is the one that matters: it **abandoned** a plan the message explicitly told it to
abandon. A tool returning 200 proves delivery to an endpoint; a peer changing course proves the
message was read and understood.

Two cautions:

- **`ListAgents` is not the discovery tool for this.** It sees in-process subagents only, so it
  reports "No reachable agents" for a healthy fleet. Use `list_sessions`.
- **Triggers created this way carry no MCP connectors.** Firing into a PERSISTENT session is fine
  — it keeps its own tool configuration, as the verification above shows. A trigger that SPAWNS a
  fresh session would give it no connector tools, which is a different and much worse outcome.

## Keeping lanes alive without a coordinator — the heartbeat

A lane session persists, but a lane that finishes its work and goes IDLE stays idle until something
pokes it. If the only thing that pokes it is a coordinator session, the fleet stalls the moment
that session ends. So each lane owns a **recurring trigger into itself**:

```
create_trigger(persistent_session_id: "<lane id>", cron_expression: "0 */6 * * *", prompt: ...)
```

Every 6 hours the lane is handed a turn that tells it to re-fetch `main`, run
`agent-pr-sweep.mjs`, re-read its brief if it has lost context, rebase anything conflicted, and go
find work if it has none. Nothing outside the lane has to be alive for that to happen.

**This is why the connector caveat does not bite.** A trigger created from here stores no MCP
connectors, and the `connectors` parameter is *not available for this organization* (verified —
the call is rejected outright). That would cripple a trigger which **spawns a fresh session**: it
would come up with no connector tools at all. A trigger firing into a **persistent** session has
no such problem — the lane keeps its own configuration, and the fired prompt is just another turn
in a session that is already correctly equipped.

So the rule is: **schedule INTO existing sessions, never schedule sessions into existence.** If a
fresh-session Routine is ever genuinely needed with tools, it has to be created from the claude.ai
Routines UI, which can attach connectors.

The heartbeats are staggered by a minute each (the server anchors an every-N-hours cron to the
creation minute), so six lanes do not wake simultaneously.

**Cost is the thing to watch, not reliability.** Each firing is a real turn on a real model. Six
lanes × four firings a day is 24 wakeups; the interval is the dial to turn if that is too much,
and `update_trigger` changes it without disturbing the lane.

### Tags

| Tag | Meaning |
|---|---|
| `fleet:blackout` | Member of this fleet. Every lane session carries it. |
| `lane:<name>` | Which product lane — `helix`, `thermal`, `vector`, `meridian`, `nighthawk`, `spx`, `seo` |
| `role:lane` / `role:coordinator` | Lane worker vs the session that reviews and merges |

Branch prefix stays `claude/<lane>-<slug>` so `automerge.yml` and `agent-pr-release.yml` both match.

## Lanes

| Lane | Scope |
|---|---|
| `helix` | HELIX flow/tape reads exposed to Largo |
| `thermal` | Dealer-gamma matrix, heatmap, compare cards |
| `vector` | Wall rails, beads, expected move, pin forecast |
| `meridian` | Earnings, OpEx history, macro timeline |
| `nighthawk` | 0DTE board, ledger, grading, edition |
| `spx` | SPX Slayer surfaces |
| `seo` | Search, authority, backlinks — weekly, Monday 06:00 PT |

## What every lane brief must carry

The brief is the only durable instruction a replacement agent gets, so it states the things a dead
predecessor cannot pass on:

1. **Branch prefix** `claude/<lane>-<slug>`, one issue per branch.
2. **Node 20 is mandatory** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`. A Node 22
   run is not evidence, in either direction. Install with `bash -lc 'nvm install 20'` if a restart
   wiped it.
3. **You cannot undraft your own PR, and that is expected.** REST `PATCH {"draft": false}` silently
   returns `draft: true` — the field is read-only on update. GraphQL's
   `markPullRequestReadyForReview` is blocked for agent sessions. `agent-pr-release.yml` sweeps
   every 15 minutes and releases any agent draft whose `verify` is green. **Open the PR, get CI
   green, stop. Do not burn turns trying to undraft it, and do not treat a draft as a failure.**
4. **Ask the coordinator, never the user.** Questions go in a PR comment or a message to the
   coordinator session.
5. **FINDINGS.md collides with every other lane** — that is normal and not your bug. The
   coordinator resolves it with `scripts/audit/findings-merge-resolve.mjs`.
6. **Merged is not done.** Re-validate against production after deploy; a merge is a step, not a
   finish line.

## Restart drill

When a coordinator finds itself with no memory of the fleet:

1. `list_sessions(mine: true)`, then keep rows whose `tags` contain `fleet:blackout` — who is
   alive. Read `session_status` and `status_bucket`, not just presence: `SESSION_STATUS_IDLE` with
   bucket `BLOCKED` means the lane is waiting on something, and each row's `post_turn_summary`
   usually names exactly what.
2. `node scripts/audit/agent-pr-sweep.mjs` — what is green, blocked, conflicted, or jammed.
3. Re-launch any missing lane from the table above; the branch and its PR carry the work.

Nothing in that sequence depends on remembering anything. That is the whole design.
