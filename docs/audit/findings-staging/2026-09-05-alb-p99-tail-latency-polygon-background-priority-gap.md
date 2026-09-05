## 2026-09-05 — [FINDING, P2 performance, latency] ALB p99/Max tail latency correlates with `desk-warm` runtime; UW has a background-vs-foreground priority reservation, Polygon does not — OPEN

> **kind:** `FINDING`

| **Status** | OPEN — evidence gathered, root cause plausible but not proven; no fix built this cycle (see "Why not fixed now" below) |
|---|---|

**Measured (live, 2026-09-05 ~17:50–20:50 UTC, `AWS/ApplicationELB` `TargetResponseTime` on
`blackout-production-app`, Period=300, 34 datapoints over 3h):**
- p50: 20–54ms across nearly every bucket — fleet-wide is fast, this is not a capacity problem.
- p99: 1.8–16.8s across nearly every 5-min bucket (avg ~4.7s vs avg p50 ~38ms).
- Max: repeatedly spikes to 17–29s — peak **29.5s @ 19:51 UTC**, also 22.7s@18:16, 22.0s@19:06,
  21.3s@19:01, 18.5s@17:56. Not a one-off blip — present in almost every window of the 3h sample.

**Temporal correlation (CloudWatch Logs `/ecs/blackout-production`, `elapsed=`, same 2h window):**
Every one of the 10 longest `elapsed=` log lines in the window is `[cron/desk-warm] background
done` — runtime highly variable within the same hour: 80039ms, 69873ms, 69455ms, 48713ms, 32395ms,
28772ms, 24869ms, 12047ms, 6095ms, 3437ms. The long-elapsed runs (18:22, 18:34, 19:15 UTC) land
inside the same windows as the ALB Max spikes above (18:16, 18:34-ish gap, 19:06/19:01/19:51).

**This is a correlation, not yet a proven causal chain — stated plainly so nobody treats it as
settled.** `desk-warm`'s own HTTP response returns in ~202ms (fire-and-forget via `after()` — see
`src/app/api/cron/desk-warm/route.ts`), so the ALB is not measuring `desk-warm`'s own endpoint
being slow. The plausible mechanism is a shared-resource contention: `desk-warm`'s background fan-out
(`loadMergedSpxDesk`, `fetchGexHeatmap(["SPX","SPY"])`, `loadBootstrapBundle`,
`warmFlowsMemberCaches`, `prefetchSpxDeskEnrichment`) runs on the same ECS web-tier replica pool that
also serves real member polls, and if it competes for the same rate-limited upstream connection
budget as foreground requests, a foreground member request queued behind it would show up as an ALB
tail-latency spike on a *different* route than `desk-warm`'s own.

**What's already there (checked before writing this up, so this isn't proposing to duplicate real
work):** `desk-warm` already has three rounds of deliberate hardening documented in its own file
(overlap lock added 2026-09-02 per #3344, a rerun-cooldown rate floor added 2026-09-04, and the
UW-specific fix): `src/lib/providers/uw-rate-limiter.ts`'s `runWithBackgroundUwSweep()` (#3479,
2026-08-xx) already solves exactly this shared-resource-contention shape for the **UW** provider —
a caller tagged as a background sweep gets its view of the UW concurrency ceiling reduced by one
slot so live traffic keeps priority. `desk-warm`'s `runDeskWarm` already wraps its whole body in
`runWithBackgroundUwSweep(...)`.

**The gap this finding identifies:** `fetchGexHeatmap(["SPX","SPY"])` inside `runDeskWarm` goes
through `src/lib/providers/polygon-rate-limiter.ts`, not the UW limiter — and grepping that file
(506 lines) for `background`/`foreground`/`priority`/`Sweep` returns nothing. It has its own
admission-queue budget (`queue-budget.ts`'s `DEFAULT_QUEUE_MAX_WAIT_MS = 20_000`, from the earlier
#1817 "bound the rate-limiter admission queue" fix), which caps how long any *single* caller can
wait before erroring, but has no concept of de-prioritizing a background-sweep caller relative to a
live member request the way the UW limiter does. A full GEX-heatmap rebuild for SPX/SPY (option
chain fetch + gamma computation) inside `desk-warm`'s fan-out is exactly the kind of call that could
occupy Polygon rate/connection budget a concurrent live `/api/market/gex-heatmap` poll is also
waiting on — the same problem UW already solved, on the provider that didn't get the fix.

**Why not fixed this cycle:** this is a cross-cutting change to a shared rate limiter used by every
Polygon-bound caller in the app (not just `desk-warm`), not a small self-contained bug — the correct
fix (if the hypothesis holds) is porting `runWithBackgroundUwSweep`'s pattern to
`polygon-rate-limiter.ts`, which has real blast radius (every Polygon caller, including RTH-critical
live desks) and deserves its own measurement pass to confirm causation (e.g., instrument
`fetchGexHeatmap` call sites inside `runDeskWarm` specifically, or A/B the ALB p99 with `desk-warm`'s
GEX fetch temporarily removed) before committing to the fix shape. Per CLAUDE.md's own standing
mandate: "Fix small self-contained bugs directly... Write up bigger findings/enhancements rather
than unilaterally building them" — this is the latter.

**Suggested next step for whoever picks this up:** (1) confirm causation with a targeted probe
(e.g. correlate ALB per-target-instance latency, if available, against which replica is running the
long `desk-warm` pass, or temporarily log Polygon queue-wait times specifically for calls made
inside `runWithBackgroundUwSweep`); (2) if confirmed, add a `runWithBackgroundPolygonSweep`-style
wrapper to `polygon-rate-limiter.ts` mirroring the UW pattern, and wrap `fetchGexHeatmap` (and any
other Polygon calls) inside `runDeskWarm`/`zerodte-warm`/`heatmap-warm`/`meridian-warm` with it.
