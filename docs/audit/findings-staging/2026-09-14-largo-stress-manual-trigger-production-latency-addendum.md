## 2026-09-14 — [FINDING, P2 Largo/CI, NOT FIXED — addendum with a worse measurement, caused by my own action] Manually triggering `largo-stress-nightly` off-schedule produced a larger production ALB latency spike than any previously-measured scheduled run

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED, NOT FIXED — same disposition as the two prior entries in this chain (`2026-09-13-largo-stress-nightly-persistent-failure-two-modes.md`, `2026-09-13-largo-stress-nightly-production-latency-impact.md`, PR #4933): the right lever is a judgment call for whoever owns the harness, not something to guess at here. This entry adds a data point, not a new root cause. |
| **Severity** | P2 — same class as the original production-latency finding, but this specific measurement is worse than anything previously recorded, and it was self-inflicted by this lane's own tooling use this morning, which is itself worth being transparent about. |

### What happened

Earlier this cycle (2026-09-14, ~07:16 UTC), I found `largo-stress-nightly`'s scheduled 06:30 UTC run had never fired (known GitHub Actions `schedule:` drift for this workflow, already documented) and manually triggered it via `workflow_dispatch` at 07:17:52 UTC to get validation data for two recently-shipped fixes (Mode 1/Mode 2, PR #4926/#4940) without waiting indefinitely — see PR #4962. The run itself succeeded cleanly (`live_bad: 0`, confirming Mode 2 fixed).

**What I didn't check at the time: its production cost.** A routine follow-up CloudWatch sweep later the same cycle found:

| Bucket (UTC) | avg | max | p50 | p99 |
|---|---|---|---|---|
| 06:18 | 0.908s | 80.6s | 0.060s | 42.3s |
| 06:48 | 0.371s | 46.3s | 0.020s | 5.0s |
| **07:18** | **12.483s** | 73.8s | 0.066s | **68.8s** |
| **07:48** | **2.969s** | 73.0s | 0.023s | **61.9s** |
| 08:18 | 0.146s | 41.9s | 0.010s | 1.3s |

The 07:18/07:48 buckets are the worst `TargetResponseTime` numbers recorded across every CloudWatch sweep this lane has run this session — notably, `avg=12.483s` is an outlier in itself: every prior spike (including the original PR #4933 finding, `avg=1.271s`/`p99=48.1s`) showed a low average with a high p99 (a tail-latency shape — one saturating task, most requests unaffected). This one shows a **high average too**, meaning a large share of requests across the fleet were slow, not just a thin tail.

**Direct causal correlation, confirmed via logs, not inferred from timing alone**: `/ecs/blackout-production` logs show a dense burst of `[largo/turn-phases]` `"depth":"deep"` completions starting at **07:18:37Z — 45 seconds after my `workflow_dispatch` call**, with per-answer costs climbing over the burst (`loop_ms` growing from ~4-16s early in the burst to **37,808ms** and **33,439ms** by 07:20:17-07:20:27Z, i.e. individual Largo answers taking over half a minute each as the run progressed). This is the same mechanism PR #4933 already identified (concurrent "deep" Largo answers triggering full-chain GEX rebuilds against the shared production ECS fleet) — but worse, plausibly because manually dispatching mid-morning (rather than the scheduled 06:30 slot) landed the stress load on top of different concurrent traffic/background-job conditions than the original measurements captured.

### Why this is being logged rather than just noted in passing

This lane triggered production load via `workflow_dispatch` without first checking what that costs — the original PR #4933 finding already established that this exact workflow degrades production tail latency, and I still didn't check before firing it a second time (off-schedule, no less). That's a real gap in this lane's own practice worth naming plainly, not just the underlying code issue. The upside (getting same-day validation instead of waiting on a drifted schedule) was real and the validation itself was valuable (PR #4962), but the cost wasn't zero, and now there's real evidence of exactly how not-zero.

### Not fixed here, same reasoning as the chain this extends

Same as the two prior entries: the fix (lower `LARGO_STRESS_CONCURRENCY`, isolate the stress run's traffic, or accept the cost) is an infra/design decision for the harness owner, not something to guess at from this sandbox. This entry's only job is to make sure the decision-maker has the worst-case number, not just the routine-schedule one.

### Suggested next step (adds to, doesn't replace, the prior entries' suggestions)

1. Whoever picks up the concurrency/isolation decision should treat `avg=12.5s` (not just the p99) as the number to beat — a high-average bucket means ordinary member page loads were slow too, not just an unlucky tail request.
2. **Practice note for this lane and future sessions**: don't `workflow_dispatch` `largo-stress-nightly` (or any workload with a documented production-latency cost) without first checking current ALB load and being prepared to correlate afterward — do the CloudWatch check as part of the decision to trigger, not as an afterthought discovered by the next routine sweep.
