> **kind:** FINDING

## desk-warm `?force=1` hammered by an unidentified external caller during a market-closed holiday — FIXED (server-side hardening)

| | |
|---|---|
| **Status** | Fixed (defense-in-depth; root external caller not identified) |
| **Severity** | P2 (measured real tail-latency impact, not correctness) |
| **Area** | Performance / SPX desk-warm cron |

### Evidence (live, 2026-09-07, Labor Day — NYSE full-day closure on a weekday)

Pulled real CloudWatch numbers per the standing performance/latency mandate:

- `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app`: p50 ~0.02s all day
  (healthy), but the 13:07-13:37 UTC window measured **p99 68.4s / Max 100.1s** — a low-average,
  high-p99/Max tail-latency signature, not a fleet-capacity problem.
- `/ecs/blackout-production` logs: `[cache-warmer-gate] force=1 bypassed the hours gate for
  'desk-warm'` fired **166 times in a 6h window**, from **47+ distinct source IPs** (all
  `ua=node`) — not the small, stable set of ECS task IPs any known in-app dispatcher would use.
  70 of those actually completed a full run (`[cron/desk-warm] background done ... elapsed=`
  5,000-94,061ms each), i.e. real UW/Polygon-bound fan-out work, on a day the market is closed and
  nothing should be warming this cache at all.
- The burst most concentrated at 13:36-14:45 UTC lines up with the measured ALB p99/Max spike
  above.
- Confirmed this is NOT any script already in this repo: `compare-latency-envs.mjs`,
  `latency-burst-audit.mjs`, and `validate-deploy.mjs` all already gate their own `?force=1` warm
  calls on the holiday-aware `isDeployCacheWarmAllowed()` (landed in #4489, merged 2026-09-07
  15:38 UTC — *before* the observed burst), and `site-latency-audit.mjs`'s own force-warm helper
  is unconditionally `IS_STAGING`-gated (always false against production). The two legitimate
  in-app dispatchers (`rth-warm-leader.ts`, `cron-staleness-watchdog`'s self-heal) both already
  gate on the same holiday-aware `isEtExtendedWarmHours` / `market_hours_stale` check before ever
  calling this route, so neither can be the source. The burst continued well past 19:00 UTC (after
  #4489 was live), ruling out a simple race with that fix's rollout. The actual external caller's
  identity was not determined from this repo's committed code or logs alone.

### Root cause

`desk-warm/route.ts`'s `force=1` path (documented, intentional — on-demand/debug warms need to
bypass the hours gate) was rate-limited by a single flat 60s cooldown (`RERUN_COOLDOWN_SEC`)
regardless of whether the window was open or closed. That floor was tuned to sit just below the
in-window cadence of the two known in-app dispatchers, on the assumption that any caller reaching
this branch was one of them. Neither in-app dispatcher can ever call this route while the window
is closed (both gate before dispatching), so the assumption held — until an external caller not
gated the same way did.

### Fix

Widen the cooldown floor specifically for calls made **outside** the extended warm window:
`isEtExtendedWarmHours()` (the same holiday-aware check the in-app dispatchers already rely on) now
picks between the existing 60s in-window floor and a new 300s off-window floor
(`OFF_WINDOW_FORCE_COOLDOWN_SEC`). A single on-demand debug hit is unaffected (still runs
immediately); a repeated caller hammering the route off-window is now throttled 5x harder. This
does not require identifying the external caller — it defends the route itself.

### Blast radius (not fixed here — follow-up)

`heatmap-warm`, `zerodte-warm`, and `meridian-warm` share the identical `force=1` +
`RERUN_COOLDOWN_KEY` pattern (per their own doc comments, referencing #3540/#3542) and likely carry
the same latent gap. Left unchanged in this PR to keep it single-issue; worth the same off-window
floor if the same external-caller pattern is observed against them.

### Regression test

`src/app/api/cron/desk-warm/route.test.ts` — new test asserts the off-window floor exists and is
actually wired into the cooldown claim (not a dead constant). RED→GREEN proven: reverting
`route.ts` to the pre-fix `origin/main` content fails this one test (8/9 pass); the fix restores
9/9. `tsc --noEmit` clean.
