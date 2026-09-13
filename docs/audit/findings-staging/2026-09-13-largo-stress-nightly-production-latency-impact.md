## 2026-09-13 — [FINDING, P2 Largo/CI, NOT FIXED — production-impact evidence for the existing largo-stress-nightly Mode-1 finding] The nightly Largo stress run measurably degrades production ALB response times while it's running — not just its own test coverage

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED, NOT FIXED — new evidence layered onto the already-staged `2026-09-13-largo-stress-nightly-persistent-failure-two-modes.md` finding (Mode 1, the http-429 storm). That finding measured the stress run losing 30-40% of its OWN test coverage; this one measures the SAME run degrading production response times for everyone else on the shared ECS fleet while it's in flight. Same "needs a judgment call, not a mechanical fix" disposition — concurrency, resource isolation, and scheduling are all live options and belong to whoever owns the Largo stress harness. |
| **Severity** | P2 — no sustained outage, but real members hitting the site during the run's heavy-load minutes can see multi-second to ~80-second page loads on a shared production target group; this happens every night the scheduled run executes. |

### What was found

This cycle's CloudWatch performance sweep (per the standing performance/latency mandate) pulled `AWS/ApplicationELB` `TargetResponseTime` for `blackout-production-app` over the trailing 6 hours (2026-09-13T11:00-17:00 UTC, 30-min buckets) and found two anomalous buckets against an otherwise-clean baseline (p50 consistently 0.02-0.10s, p99 typically <1.5s all day):

| Bucket (UTC) | avg | max | p50 | p90 | p99 |
|---|---|---|---|---|---|
| 11:47 | 0.419s | 76.107s | 0.075s | 0.196s | 12.346s |
| **12:17** | **1.271s** | **80.879s** | 0.069s | 0.178s | **48.124s** |
| (baseline, e.g. 14:17) | 0.174s | 47.603s | 0.085s | 0.169s | 0.457s |

(No 5XX errors recorded in either bucket — this is pure latency degradation, not failed requests, which is why it wouldn't show up in an error-rate dashboard.)

### Root-caused to the same nightly Largo stress run, not deploy churn (for the 12:17 bucket specifically)

The 11:47 bucket is explained by ordinary, already-accepted deploy churn: my own PRs #4919/#4921 merged to `main` at 11:40/11:43 UTC that morning, and the app logs show container boot sequences (`✓ Starting...` / `✓ Ready in Xms`) at 11:46:31 and 11:49:19 — consistent with the rolling ECS deploy those merges triggered. This matches the pattern this lane already correctly identified in an earlier cycle (deploy-transition 5XX/latency blips are expected background noise here) and is **not** re-flagged as new.

The **12:17 bucket is different** — no PR merged to `main` between 11:53 and 12:02 UTC that morning, ruling out deploy churn as the explanation. Pulling `/ecs/blackout-production` CloudWatch Logs for 12:05-12:40 UTC instead shows a dense burst of Largo "deep" tool-loop answers completing back-to-back:

```
12:13:12.654 [largo/turn-phases] {"depth":"deep","prefetch_ms":6753,"loop_ms":13218,"total_ms":19971,"tools":1,"answered":true}
12:13:15.249 [largo/turn-phases] {"depth":"deep","prefetch_ms":7585,"loop_ms":14982,"total_ms":22567,"tools":1,"answered":true}
12:13:39.479 [largo/turn-phases] {"depth":"deep","prefetch_ms":10165,"loop_ms":14266,"total_ms":24431,"tools":1,"answered":true}
```

Each of these "deep" answers is expensive: between them, the logs show **~80 distinct `[polygon-gex] full-chain escalation ADOPTED` lines for ~60 different tickers in under 30 seconds** (AMZN, AAPL, GOOG, PL, LUNR, GOOGL, ASTS, NFLX, RKLB, ARM, COIN, JPM, GILD, ANET, VRT, ORCL, …) — each escalation is a full-option-chain rebuild (e.g. `NFLX: 38 -> 263 strikes`), not a cheap read. In the same window, `[uw] queue wait` spikes to **17447ms** (vs. the usual 600-2600ms seen elsewhere in the log), and `AWS/ECS` `CPUUtilization` for `blackout-production-web` shows the 12:10 bucket at **avg=6.7% / max=90.9%** against a same-day baseline of avg 1.2-3.8% / max 27-55% — i.e. at least one of the 8 tasks was pushed to near-saturation while the others stayed idle, which is exactly the shape of a p99/tail-latency problem the standing performance mandate describes (a small number of requests landing on one saturating task, not a fleet-capacity problem).

This lines up with `largo-stress-nightly.yml`'s own scheduled-run configuration (lines 44-53): the no-input scheduled path — the one that runs every night — sets `LARGO_STRESS_CONCURRENCY=2`, i.e. **two concurrent "deep" Largo answers**, each fanning out to dozens of full-chain GEX rebuilds, run against the **same production ECS fleet real members use**, with no resource isolation from live traffic. Two concurrent expensive answers is enough to explain the observed single-task CPU spike and the tail-latency numbers above.

### Relationship to the existing Mode-1 finding

`2026-09-13-largo-stress-nightly-persistent-failure-two-modes.md` (PR #4925, already staged) documented Mode 1 as a *self-inflicted* problem: the stress run's own requests start getting `http-429`'d partway through, losing 30-40% of its own test coverage. This finding adds the other half of the picture — the same run, while healthy and actually getting real "deep" answers back, is *also* pushing measurable tail latency onto production for everyone else. Both point at the same underlying design choice (run the nightly quality gate's live traffic directly against the shared production app tier, with no concurrency cap tuned to production headroom and no isolation), just via two different symptoms. A fix that addresses one (e.g., retry/backoff for the 429s) would not by itself address this one — concurrency against production is the shared root cause worth deciding on together.

### Why write-up, not direct fix

Same reasoning as the original Mode-1 finding: the right fix depends on a judgment call that belongs to whoever owns the Largo stress harness/its scheduling — lower `LARGO_STRESS_CONCURRENCY` further (currently 2 on the scheduled path), point the nightly run at a rate/priority-limited path, schedule it for a lower-traffic window, or accept the current nightly latency cost as a known, bounded trade-off. Guessing at a concurrency change from this sandbox risks either not fixing the real problem (if the bottleneck is per-request full-chain fan-out cost rather than concurrency count) or needlessly slowing the nightly gate (if 2 is already conservative and the real fix is elsewhere, e.g. caching full-chain escalations across the run's own repeated ticker hits).

### Suggested next steps

1. Whoever owns `largo-stress-nightly.yml`/`scripts/largo-stress-run.mjs`: decide whether concurrency=2 against shared production is an acceptable nightly cost, or whether the run should target a lower `LARGO_STRESS_CONCURRENCY`, a dedicated/rate-limited path, or an off-peak schedule slot (it's currently 06:30 UTC — already fairly quiet for a US-hours product, so schedule-shifting has limited room; concurrency/isolation are the more promising levers).
2. If full-chain GEX escalation cost per ticker is itself the dominant driver (each stress question can trigger dozens of independent chain rebuilds), check whether those escalations are being de-duplicated/cached within a single stress run's own repeated reads of the same tickers — that would cut the load without touching concurrency at all.
3. Re-measure `TargetResponseTime` p99/Max for the 06:30-13:30 UTC window on a future run once any change lands, using the same `AWS/ApplicationELB` `TargetResponseTime` extended-statistics query used here, to confirm the fix actually narrows the tail rather than just moving it.
