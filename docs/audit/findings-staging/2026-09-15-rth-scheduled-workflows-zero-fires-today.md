## 2026-09-15 — [FINDING, P1 CI/infra, REPORTED — NOT FIXED, GitHub Actions scheduler behavior] Multiple RTH-hour scheduled workflows have not fired even once today, ~3 hours into RTH, while other scheduled workflows fired normally in the same window

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED — a real, evidenced gap in today's RTH monitoring/audit coverage. Not fixable from this sandbox (GitHub Actions' own `schedule:` dispatch behavior, not application code) and not the same root cause as the already-merged #4987 Cursor Cloud Agent finding, though it compounds it: today, the Cursor-launch failures aren't even the visible symptom, because the workflows that would surface them never ran. |
| **Severity** | P1 — this is not "one job is late," it's the RTH-hour monitoring/audit surface (`Grid RTH all-day agent`, `SPX RTH all-day agent`, `RTH open check`, `RTH deep audit`) reading as completely silent for the first ~3 hours of a live trading session, with no distinguishable signal between "nothing has gone wrong" and "the watchers themselves aren't watching." |

### What was checked — evidence, not assumption

At 16:15 UTC today (2026-09-15, ~2h45m into RTH — market opened 13:30 UTC), pulled live run history per-workflow via the REST API rather than trusting the failure list:

| Workflow | Cron count | Most recent run | Fired today? |
|---|---|---|---|
| `Grid RTH all-day agent` | 16 | 2026-09-**14**T23:50:07Z | **No** |
| `SPX RTH all-day agent` | 16 | 2026-09-**14**T23:44:41Z | **No** |
| `RTH deep audit` | 6 | 2026-09-**14**T23:55:43Z | **No** |
| `RTH open check` | 2-3 | 2026-09-**14**T19:34:13Z | **No** |
| `Off-hours health` | 1 | 2026-09-**15**T11:14:31Z | Yes |
| `Cron audit query` | 2 | 2026-09-**15**T15:31:36Z | Yes (during RTH) |

All four RTH-specific workflows are confirmed `state: active` (not disabled) via `GET /repos/.../actions/workflows/{id}` — nobody paused them, and no commit touched any of their YAML files recently (checked `git log` on each). They are simply not being dispatched by GitHub's scheduler today, while at least two other scheduled workflows in the same repo, during the same hours (`Cron audit query` fired at 15:31 UTC, squarely mid-RTH), dispatched normally.

### What this is, and isn't

This is the same general phenomenon CLAUDE.md already documents at length — GitHub Actions `schedule:` triggers can be delayed under high load, and this repo's own fleet-commit velocity (multiple merges per minute for most of the last 24 hours, visible in `git log`) is the documented correlate (see the existing `2026-08-31-largo-stress-nightly-schedule-drift.md` finding and this file's own re-confirmations). This entry is **not** a new root cause — it's a significant escalation in observed severity: prior instances were "this one workflow fired hours late." Today is "an entire RTH-hour monitoring cluster fired zero times across the first 3 hours of a live session," while at least one other scheduled workflow in the identical window dispatched fine.

One pattern worth naming, not yet strong enough to call proven: the four silent workflows all have **multiple `cron:` entries** (2-16 each, since GitHub Actions requires one `schedule:` entry per fire time rather than a single richer cron expression), while the two that fired today have only 1-2. More cron entries per workflow means more chances for GitHub's own dedup/rate-limiting behavior under load to suppress a given slot — plausible, but `RTH open check` (only 2-3 entries) also went silent today, so cron-count alone does not fully explain it. Flagging the correlation as observed, not asserting it as the mechanism.

### Why this matters beyond "one more drift data point"

Every prior drift instance still eventually fired, just late — the underlying job still ran and its output was still eventually available, even if delayed. **Today, for these four workflows, nothing has run at all** for the entire RTH session so far. That means:
- No `Grid RTH all-day agent` / `SPX RTH all-day agent` Cloud Agent verify/fix pass has happened today (compounding, not caused by, the already-known #4987 Cursor Cloud Agent outage — even if `CURSOR_API_KEY` were fixed right now, these workflows still wouldn't have run to use it).
- No `RTH deep audit` or `RTH open check` pass has validated the live board/deploy/Postgres/socket-health surface today — the exact checks CLAUDE.md's own runbooks rely on for market-open confidence.

### Not fixed here

Same disposition as the schedule-drift finding chain this extends: whoever owns CI scheduling infrastructure needs to decide whether workloads this schedule-sensitive should move off GitHub Actions' `schedule:` trigger (e.g., to an external cron caller that hits `workflow_dispatch`, or to the same EventBridge-Lambda pattern the application's own crons already use and that CLAUDE.md's `cron-dst-audit.mjs` already audits). That is an infrastructure decision, not something to guess at or change unilaterally from this sandbox.

### Suggested next step

1. Whoever has visibility into GitHub's Actions scheduler/support channel should check whether there's an account- or repo-level scheduled-workflow suppression happening under this repo's sustained high commit/run volume (many workflows firing dozens of times per hour, per `git log` and per CLAUDE.md's own fleet-velocity notes) — this is the kind of thing only GitHub-side telemetry can confirm.
2. If moving off `schedule:` is decided for these four workloads, the EventBridge → Lambda → `workflow_dispatch` (or a direct EventBridge → app-route pattern, matching how the application's own cron jobs already work) is the natural model already used elsewhere in this stack.
3. In the meantime, treat "hasn't fired yet today" as itself an actionable signal worth checking each cycle for these four workflows specifically — not just the failure list, which stays empty on a day like today precisely because nothing ran to fail.
