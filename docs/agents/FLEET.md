# The agent fleet — how it is launched, found again, and why

**Standing decision (2026-08-21).** Long-lived agents run as **remote sessions**, discovered by
**tag query**, never by memory. This file is the source of truth for the lane list and the tags; a
coordinator with no recollection of what was launched can rebuild the whole picture from here plus
one API call.

## The failure this replaces

The fleet was originally spawned as **in-process subagents** (the `Agent` tool). Those run inside
the coordinator's own container. The container restarted — twice in one session on 2026-08-21 — and
every agent died with it. `ListAgents` returned "No reachable agents", with no session file, no
reconnect, and nothing to recover.

That is not a misconfiguration to be tuned away. It is what in-process means, and **no setting
makes an in-process subagent outlive its parent container.** Anyone proposing to "fix the
connection" is proposing something that does not exist.

What made it expensive was not the loss itself but the misreading. The agents' work was safe the
whole time — 36 PRs, 28 with `verify` green, sitting in GitHub. The lost thing was the coordinator's
*control channel*, and because the coordinator tracked its fleet by memory, losing the channel
looked identical to losing the work. It was diagnosed as "the agents are stuck" for far longer than
it should have been.

## The rule

> **The work channel is GitHub. The control channel is disposable. Never let the second one hold
> state the first one cannot rebuild.**

Concretely:

- **Long-lived lane work → remote sessions** (`create_session` on the `claude-code-remote` MCP
  server). Each gets its own container and lifecycle, independent of the coordinator's.
- **Short, single-shot fan-out → in-process subagents** is still fine. Losing one costs a retry,
  not a day.
- **Re-engaging a dead agent means spawning a fresh one pointed at the existing branch**, never
  resurrecting the old session. Branch plus PR plus review comments carry everything the
  replacement needs.

## Discovery is a query, not a memory

Every lane session is tagged at creation. A coordinator starting cold runs:

```
list_sessions(mine: true, tags: ["fleet:blackout"])
```

and has the fleet back. `send_message` addresses any of them by id. This is the same principle as
`scripts/audit/agent-pr-sweep.mjs`: **sweep by state, never by memory of what was launched.** A
coordinator that keeps a mental roster loses it on every restart; one that queries never can.

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

1. `list_sessions(mine: true, tags: ["fleet:blackout"])` — who is alive.
2. `node scripts/audit/agent-pr-sweep.mjs` — what is green, blocked, conflicted, or jammed.
3. Re-launch any missing lane from the table above; the branch and its PR carry the work.

Nothing in that sequence depends on remembering anything. That is the whole design.
