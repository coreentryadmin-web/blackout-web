> **kind:** FINDING

## Background-warm crons log `ok`/`accepted` before the real work runs — a total background failure is invisible to `cron_job_runs` and never alerts, across at least 4 routes — OPEN, write-up only

**Status:** OPEN — write-up only, no code changed. Needs a decided pattern (shared helper vs.
per-file catch block) before anyone implements it — see "Suggested fix direction" below.
**Severity:** P2 observability gap — not a wrong-answer bug, but it defeats the one mechanism
(`cron_job_runs` + the Discord failure alert) this repo relies on to *notice* a cron has stopped
working. **Area:** `src/app/api/cron/desk-warm/route.ts`, `platform-warm/route.ts`,
`meridian-warm/route.ts`, `vector-bead-record/route.ts` (and likely more — see "Blast radius").

### What's wrong

Every one of these routes follows the same two-phase shape: do a fast "can I run" handshake
synchronously, then dispatch the actual UW/Polygon-bound warm work via `after()` so it keeps
running after the HTTP response is sent (to stay under Cloudflare's ~100s origin timeout on a cold
cache — several of these routes' own comments say so explicitly). The bug is in the ORDER of the
two `logCronRun` calls relative to that background work.

`desk-warm/route.ts` (representative — same shape in the other three):

```ts
const dispatchWarm = () => {
  void runWithBackgroundUwSweep(() => runDeskWarm(started)).catch((error) => {
    console.error("[cron/desk-warm] background warm REJECTED:", error);
  });
};

try {
  after(dispatchWarm);
} catch {
  dispatchWarm();
}

const accepted = {
  ok: true,
  status: "accepted",
  reason: "desk + gex + bootstrap warm dispatched in background (fire-and-forget)",
};
await logCronRun("desk-warm", started, accepted);   // <-- logged BEFORE dispatchWarm() has run
return NextResponse.json({ ...accepted, note: "..." }, { status: 202 });
```

`logCronRun("desk-warm", started, accepted)` is called with `{ok: true}` immediately, before
`dispatchWarm`'s `after()`-deferred callback has executed at all — `after()` runs once the response
is already on the wire. `logCronRun`'s own `deriveCronRunStatus` (`src/lib/cron-run.ts`) derives
the `cron_job_runs.status` column purely from the payload it's handed: `result.skipped === true ?
"skipped" : result.ok === false ? "failed" : "ok"`. Since the handshake payload is always `{ok:
true, status: "accepted"}` by construction, **the row written to `cron_job_runs` always reads
`"ok"`, regardless of what happens in the background work that runs after it.**

Inside `runDeskWarm` (the actual background function), a total failure — e.g. `runWithBackgroundUwSweep`
rejecting outright, or every one of the `Promise.allSettled` branches rejecting — is caught and
only ever reaches `console.error`/`console.warn`:

```ts
void runWithBackgroundUwSweep(() => runDeskWarm(started)).catch((error) => {
  console.error("[cron/desk-warm] background warm REJECTED:", error);
});
```

There is no second `logCronRun(..., {ok: false, error: ...})` call anywhere on that path, and no
`notifyOpsDiscord` call either (that only fires from inside `logCronRun` when `deriveCronRunStatus`
returns `"failed"` — see `cron-run.ts` lines ~83-90). So a background warm that fails **completely**
— not a partial `allSettled` miss (those are already logged richly via the `deskOk`/`gexOk`/etc.
booleans in the success log line), but the whole async IIFE throwing before it reaches its own
`console.info("... done ...")` line — produces:

- a `cron_job_runs` row saying `status: ok`,
- a `console.error` line in CloudWatch that nothing is watching for (no Discord alert, no
  `cron-staleness-watchdog` signal — that watchdog only acts on `cron_job_runs` staleness, which
  this failure mode doesn't produce either, since the row is fresh and says `ok`),
- and the downstream effect members actually experience: the cache lane this cron exists to keep
  warm silently goes cold, surfacing later as a slow member page-load that reads as "random
  latency" rather than "this warmer has been failing for N cycles."

This is the exact blind spot `cron-staleness-watchdog` and the `stale_after_min` alerting
threshold in `cron-registry.ts` were built to prevent — but both only detect a cron that stops
*running* (no fresh row at all), not one that runs, responds `202 accepted`, logs `ok`, and then
silently fails every single time inside the deferred background callback.

### Evidence

Read all four routes directly from `origin/main` (no drift during this round — `git fetch origin
main -q && git log HEAD..origin/main --oneline | wc -l` returned `0`):

- `src/app/api/cron/desk-warm/route.ts` lines 228-253 — `logCronRun("desk-warm", started, accepted)`
  at line 245, `after(dispatchWarm)` at line 235 (strictly earlier in execution order, but
  `dispatchWarm`'s callback body only runs post-response).
- `src/app/api/cron/platform-warm/route.ts` — identical shape (`after(dispatchWarm)` then
  `logCronRun("platform-warm", started, accepted)`; the background function's own failure path is
  `console.error`/`console.warn` only — grepped, no second `logCronRun` call exists in the file).
- `src/app/api/cron/meridian-warm/route.ts` — identical shape, same pattern.
- `src/app/api/cron/vector-bead-record/route.ts` lines 31-59 — the background IIFE's `catch`
  block is exactly `console.error(...)`, no `logCronRun` call inside it; the route's one and only
  `logCronRun` call (line 59) fires with the `{ok: true, status: "accepted"}` payload before that
  IIFE (dispatched via `after()`) has run.

Confirmed via grep that none of these four files contain a second `logCronRun` call reachable from
inside the deferred background callback's failure path:

```
$ grep -n "logCronRun" src/app/api/cron/desk-warm/route.ts src/app/api/cron/platform-warm/route.ts \
    src/app/api/cron/meridian-warm/route.ts src/app/api/cron/vector-bead-record/route.ts
```
Each file shows exactly 2-3 `logCronRun` calls, all on the synchronous handshake paths (hours-gate
skip, cooldown skip, overlap-lock skip, final accepted) — none inside the `after()`-dispatched
background function or its `.catch()`.

`src/lib/cron-run.ts`'s `deriveCronRunStatus` (read in full) confirms the derivation is payload-only
— it has no way to retroactively learn that the background work it was told about actually failed,
because nothing ever tells it.

### Blast radius

Confirmed present in (same two-phase shape, same gap):
- `desk-warm`
- `platform-warm`
- `meridian-warm`
- `vector-bead-record`

**Not yet checked this round** — the same `after()`-dispatch + single-handshake-`logCronRun` shape
is visible in several sibling route comments (`vector-universe-snapshot`, `vector-full-state-snapshot`,
`vector-walls-warm`, `vector-dark-pool-warm`, `vector-pick-sweep`, `heatmap-warm` all say "handshake
in seconds, \[work\] in after()" in their own comments) — whoever picks this up should re-grep each
of those for a second `logCronRun`/failure-alert call before assuming they share the gap or are
exempt; `heatmap-warm` in particular logs its final `logCronRun` call from *inside* a later async
section (line ~319) rather than immediately after dispatch, which may or may not already close this
gap for that route specifically — needs a direct read, not an assumption, before being added to or
excluded from this list.

`zerodte-warm` is excluded from this round's lane (owned by the 0DTE/zerodte lane per the hard
exclusion list) and intentionally not inspected here, despite being named in `desk-warm`'s own
comments as sharing this `after()`-dispatch pattern.

### Suggested fix direction (not implemented — needs a decided pattern first)

Two shapes would close this, and the right one should be decided once rather than picked
independently per file (these routes get touched by multiple lanes over time, and a mixed pattern
is worse than either pattern alone):

1. **Per-route `logCronRun` on the failure path** — have each background callback's `.catch()` (or
   an outer try/catch around the whole `after()`-dispatched function) call
   `logCronRun(jobKey, started, {ok: false, error: detail})` on total failure, in addition to the
   existing `console.error`. Minimal diff per file, but repeats the same few lines N times and is
   easy to forget on the next new warm-cron.
2. **A shared helper** (e.g. `runBackgroundCronWork(jobKey, started, fn)`) that wraps the
   `after()`-dispatch + try/catch + both `logCronRun` calls (success-so-far log line unchanged,
   failure path calling `logCronRun(..., {ok:false, ...})`) once, and every route above calls it
   instead of hand-rolling the `after(dispatchX); ... await logCronRun(..., accepted)` sequence.
   Centralizes the fix and makes the next new warm-cron correct by default, but touches more call
   sites and needs its own test coverage plus a decision about whether the initial "accepted"
   `logCronRun` call stays (useful for latency/cadence observability even when nothing failed) or
   is replaced entirely by the final true-outcome one.

Left for whoever owns this pattern (or the operator/Cursor) to choose — this entry documents the
gap and the two shapes, not a committed design.
