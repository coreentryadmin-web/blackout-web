## 2026-09-04 — [FINDING, P2 Observability] cron-staleness-watchdog's self-heal outcome never reached the persisted `cron_job_runs` record — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 observability (self-heal itself was working; its outcome was invisible to anything but raw CloudWatch) |
| **Surface** | `src/app/api/cron/cron-staleness-watchdog/route.ts` |
| **Status** | FIXED |

### Root cause (two independent halves)

**Half 1 — the array was never populated.** `runSelfHeal` (the function `dispatchHeal`
fires in the background) computed a per-job `res` (`ok`/`status`/`error`/`detail`) for every stale
cron it re-warmed via `dispatchCronWarm`, but only `console[res.ok ? "warn" : "error"](...)`-logged
it. The `healed: Array<{ key; ok; status; detail? }> = []` declared a few lines above — specifically
typed to carry this — was never `.push()`-ed into anywhere, so it stayed `[]` for the lifetime of
every request.

**Half 2 — even a fixed push could never reach the persisted row.** Self-heal is deliberately
dispatched via Next's `after(dispatchHeal)` (with a `catch { dispatchHeal(); }` fallback for when
`after()` isn't available), and the route's own comment explains why: several warmers re-run in
sequence can exceed Cloudflare's ~100s origin timeout, so self-heal must never block the response
(mirrors `nighthawk-edition`'s pattern). But that means the `result` object embedding
`self_healed: healed` is built and handed to `await logCronRun("cron-staleness-watchdog", ...)`
— which performs the actual Postgres `INSERT INTO cron_job_runs` and returns the HTTP response —
**before** the background `runSelfHeal` loop's first `await dispatchCronWarm(...)` has even had a
chance to resume. So a naive `healed.push(...)` fix alone would still leave the *persisted* record
at `self_healed: []` — the array would only ever contain real data after the row recording it was
already written and the response already serialized.

Net effect: an operator (or any future audit) reading `cron_job_runs` for
`cron-staleness-watchdog` — rather than grepping live ECS logs — always saw `self_healed: []` and
`ok:true` on the watchdog's own run, regardless of whether a dispatched re-warm attempt actually
succeeded or failed. The only trace of a self-heal failure was a `console.error` line in raw
CloudWatch, invisible to `admin-cron-health.ts` or anything else reading the DB.

### Failure scenario

`CRON_WATCHDOG_SELF_HEAL=1` is set and a market-hours cron goes stale during RTH. The watchdog
dispatches a self-heal re-warm via `dispatchCronWarm`, and that re-warm itself fails (e.g. the
target route also errors, or `CRON_SECRET` is misconfigured on the deployment). An operator
checking the persisted `cron_job_runs` row for this watchdog tick sees
`self_heal_dispatched: ["<job>"]`, `self_healed: []`, `ok:true` — no way to tell, from the durable
record alone, whether the re-warm attempt actually succeeded or silently failed.

### Fix

Kept the response-latency guarantee (self-heal still dispatches via `after()`/fallback, still
never awaited by the handler), but:

1. `runSelfHeal` now actually accumulates each `dispatchCronWarm` result into a local `healed`
   array (fixing half 1), **and**
2. once the background loop finishes, it persists a **second, distinctly-keyed** `cron_job_runs`
   row — `cron-staleness-watchdog-self-heal` — via `logCronRun`, carrying the real per-job outcome
   (fixing half 2: the truth now lands somewhere durable and queryable, just not in the same row
   the synchronous handler already wrote). `logCronRun` marks that row `"failed"` (firing the same
   Discord alert every other cron failure gets) whenever *any* dispatched re-warm did not succeed.
3. The synchronous `result` object no longer claims a settled `self_healed: []` when self-heal was
   actually dispatched — that read as "ran and healed nothing," which is false while the background
   work is still in flight (or hasn't started). It now reports `self_healed: null` (pending) plus
   `self_heal_log_key: "cron-staleness-watchdog-self-heal"` pointing at where the real outcome will
   land, and only reports `self_healed: []` when nothing needed healing this tick (the honest
   case for an empty array).
4. Added a rejection-path persist too: if `runSelfHeal` itself throws before reaching its own
   `logCronRun` call (e.g. `dispatchCronWarm` throwing despite its documented "never throws"
   contract), the existing `.catch((error) => console.error(...))` handler now also best-effort
   persists an `ok:false` row under the same follow-up key, so a total self-heal crash isn't
   console-only either.

### Why this fix over the alternative

The task write-up considered blocking the response on self-heal (awaiting `dispatchCronWarm` calls
before building `result`/calling `logCronRun`) so `healed` could be populated synchronously. Rejected
because the route's own comment states a *measured* reason `after()` was chosen in the first place:
several warmers run in sequence routinely exceed Cloudflare's ~100s origin timeout, producing a
false HTTP 524 / P0 on this exact route. `healTargets` can include more than one job (RTH-stale
warmers plus the evening `nighthawk-playbook` case), so blocking risks exactly the failure this
route was built to avoid catching — and worst of all, it risks it most during the multi-job
incident where self-heal matters most. A follow-up durable log entry gets the same truthful,
queryable outcome without reintroducing that risk.

### Evidence (RED → GREEN)

Added `src/app/api/cron/cron-staleness-watchdog/route.test.ts` (new file — none existed for this
route before), mocking every dependency (`market-api-auth`, `admin-cron-health`, `spx-play-notify`,
`cron-run`, `cron-dispatch`, `error-sink`, `edition-stale`) and calling the real `GET` handler.
Three cases: a **failed** self-heal dispatch, a **successful** one, and the **no-stale-jobs**
no-op path.

`git stash push -- src/app/api/cron/cron-staleness-watchdog/route.ts` (reverting only the source
fix, keeping the new test) then re-running:

```
node --import tsx --experimental-test-module-mocks --test src/app/api/cron/cron-staleness-watchdog/route.test.ts
```

— **RED, all 3 subtests fail** on the pre-fix code: `self_healed` came back `[]` instead of the
expected `null` (proving the synchronous result still lied about a pending outcome), the dispatch
call was never observed inside the flushed background window (`dispatchCalls` stayed empty —
because the underlying `healed` array was dead code, the fixture behaved identically whether or not
the mocked dispatch fired), and `self_heal_log_key` came back `undefined` (field didn't exist yet).

`git stash pop` restored the fix — same command, **3/3 pass**. Also ran `npx tsc --noEmit`
(Node 20) clean, and `npx tsc --noEmit` again post-restore: clean.

### Blast radius

Single file, single route — `cron-staleness-watchdog` is the only caller of its own `runSelfHeal`.
No other code reads `self_healed`, `self_heal_dispatched`, or `self_heal_enabled` from this route's
response or from `cron_job_runs.meta_json` (confirmed via a repo-wide grep) — reshaping the
synchronous field's meaning (`self_healed: []` → `null` when a self-heal was actually dispatched)
and adding a new field (`self_heal_log_key`) and a new job-key row
(`cron-staleness-watchdog-self-heal`) has no downstream consumers to break. The new job key is not
registered in `cron-registry.ts`'s `CRON_JOBS`, so it deliberately does **not** appear as its own
row in the `admin-cron-health.ts` per-job matrix — it is an audit trail readable via
`cron_job_runs`/`fetchCronJobRecentRuns`, not a new scheduled cron.

### What was deliberately left unchanged

- The `after()` dispatch pattern and its stated rationale (never block the response) — unchanged,
  and now explained in-line for the next reader of `runSelfHeal`.
- Which crons are eligible for self-heal (`isDispatchableCron`, the `CRON_DISPATCH` safety table in
  `cron-dispatch.ts`) — untouched; this fix is purely about the outcome record, not the dispatch
  policy.
- The existing "self-heal is OFF" console-warn branch when `CRON_WATCHDOG_SELF_HEAL` is unset —
  unchanged; this fix only applies to the path where self-heal actually ran.
