> **kind:** FINDING

# Off-hours `?force=1` cache-warmer bypass logged WHICH cron but never WHO — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | performance/latency — cache-warmer gate observability |

## Symptom

Live measurement tonight (2026-09-05, per the standing performance/latency audit mandate):
`AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app` held a healthy p50/p90
(22-36ms / 0.47-1.09s) but a persistently elevated **p99 (3.1-8.2s) and Max (10.4-34.0s) across
every 15-min bucket for 3+ consecutive off-hours hours** (Sat 01:12-04:05 UTC — outside cash RTH,
outside the extended warm window, on a Saturday with essentially zero member traffic) — the exact
"low average, high p99/Max = tail latency, not fleet capacity" signature this repo's standing
mandate names. `AWS/ECS` CPU stayed low on average (6-10%) with periodic Max spikes to 55-91%,
consistent with one saturating background job rather than fleet load.

Grepping CloudWatch Logs for `elapsed=` over the same window found the cause: `[cron/desk-warm]
background done` logged **81 completions in 3 hours** (roughly one every ~2.2 min), averaging
28s and peaking at **108.5s**, entirely outside `desk-warm`'s deployed EventBridge schedule
(`cron(*/5 11-21 ? * MON-FRI *)` — Mon-Fri, 11:00-21:59 UTC only; confirmed live via
`describe_rule`, matches the terraform mirror). Every one of these runs was reaching
`runDeskWarm`'s expensive UW/Polygon-bound fan-out (`loadMergedSpxDesk` + 2x `fetchGexHeatmap` +
`loadBootstrapBundle` + `warmFlowsMemberCaches` + `prefetchSpxDeskEnrichment`) via the documented
`?force=1` path (`[cache-warmer-gate] force=1 bypassed the hours gate for 'desk-warm'` — the
observability line an earlier fix on this same file added specifically to answer "which cron").

That earlier fix's own doc comment predicted exactly this: *"a NEW unmonitored caller hammering
`?force=1` overnight ... would recreate the same tail-latency/CPU-burst pattern with zero trace of
who triggered it."* It reproduced live, and the existing log line still couldn't answer the
question it was written to eventually help answer — WHO. `isCronAuthorized` requires the exact
`CRON_SECRET` (constant-time `Authorization: Bearer` compare), so the caller is not a public bot —
but `desk-warm/route.ts`'s own `RERUN_COOLDOWN_KEY` doc comment already independently ruled out,
via direct CloudWatch evidence, all three known in-app dispatchers that carry that secret
(EventBridge's own Lambda, `rth-warm-leader`, `cron-staleness-watchdog` self-heal) for the
identical overnight-force-storm shape measured on 2026-09-04. The caller is real, holds valid
credentials, and remains unidentified 24+ hours and one prior investigation later — because
nothing captured enough about the request to trace it further.

## Root cause

`shouldRunCacheWarmer(force, now, key)` logs `key` (which of the four warm crons) on every
off-hours bypass, but never captured anything about the calling request itself — no client IP, no
user-agent, nothing that could distinguish "EventBridge's own retry logic doing something
unexpected" from "a leftover local dev script still pointed at production" from "a misconfigured
external monitor." The four warm-cron routes (`desk-warm`, `zerodte-warm`, `heatmap-warm`,
`meridian-warm`) that share this gate all receive the full `NextRequest` with headers, but none of
that ever reached the log line.

## Fix

- `shouldRunCacheWarmer` gains an optional 4th param, `callerInfo?: string`, appended to the same
  log line: `` `[cache-warmer-gate] force=1 bypassed the hours gate for '<key>' (caller: <info>) at
  <ts>` `` — omitted entirely (no empty `(caller: )` fragment) when not supplied, so existing
  callers/tests that don't pass it are unaffected.
- New shared helper `callerInfoFromRequest(req)` in the same file builds `ip=<ip> ua=<user-agent>`
  from the request, reusing the existing `getClientIp()` convention from `ip-rate-limit.ts`
  (Cloudflare `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` → `"unknown"` sentinel) rather
  than inventing a second IP-extraction implementation.
- All four warm-cron routes now pass `callerInfoFromRequest(req)` into `shouldRunCacheWarmer`.

This is pure observability — no behavior change to the gate, the cooldown, or the overlap lock;
the next off-hours force storm will carry an IP + user-agent in the same log line the key already
appears in, which is one CloudWatch grep away from finally identifying the caller (rather than
another investigation that, like the last two, can only prove who it *isn't*).

## Blast radius

`src/lib/cache-warmer-gate.ts` (shared by all 4 warm crons) + the 4 call sites
(`desk-warm`, `zerodte-warm`, `heatmap-warm`, `meridian-warm` routes). No change to which requests
are allowed through, how often, or what work they trigger — only what gets logged when an
off-hours bypass fires.

## Evidence

- Live measurement (this pass): ALB `TargetResponseTime` p50/p90 healthy, p99 3.1-8.2s / Max
  10.4-34.0s across 3+ hours off-hours; `desk-warm` `elapsed=` log lines: 81 completions/3h, avg
  28s, max 108.5s, all outside the deployed EventBridge window; `[cache-warmer-gate] force=1
  bypassed...` lines confirm the mechanism, spanning 7 distinct ECS task IDs (ALB round-robin to
  an external caller, not one stuck replica).
- `src/lib/cache-warmer-gate.test.ts`: 2 new tests — `shouldRunCacheWarmer: logs callerInfo
  alongside the key when supplied` (RED against pre-fix source, confirmed via `git stash`: the
  `(caller: ...)` assertion fails because the 4th param doesn't exist yet; GREEN post-fix) and
  `callerInfoFromRequest: prefers cf-connecting-ip, falls back to x-forwarded-for, then a
  sentinel`. Full file: 5/5 pass (Node 20).
- All 4 affected route test files (`desk-warm`, `zerodte-warm`, `heatmap-warm`,
  `meridian-warm`): 31/31 pass — no regressions from adding the new call argument.
- Full `npm test`: 12546/12546 pass, 0 fail. `npx tsc --noEmit`: clean.

## Follow-up (not this PR)

The root-cause caller is still not identified — this fix only makes the NEXT occurrence
traceable. ALB access logging is currently disabled (`access_logs.s3.enabled = false`), which
would have made this immediate; enabling it is a separate, larger infra change (S3 bucket,
lifecycle policy, cost) outside this fix's scope.
