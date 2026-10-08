## 2026-10-08 — [FINDING, performance] `heatmap-warm`'s 20s in-app-leader heal threshold made it "overdue" the instant any normal run finished, driving a ~70% near-continuous duty cycle during the pre-EventBridge pre-market window — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (performance/efficiency — not a correctness bug, no evidence of member-facing latency impact; see "What this finding does NOT claim" below) |
| **Component** | `src/lib/rth-warm-leader-logic.ts` (`RTH_WRITER_HEAL_AFTER_MIN["heatmap-warm"]`), `src/app/api/cron/heatmap-warm/route.ts` (stale doc comments), `src/lib/cron-registry.ts` (stale schedule_label/description) |
| **PR** | fix/heatmap-warm-heal-threshold |

### Root cause

`RTH_WRITER_HEAL_AFTER_MIN["heatmap-warm"]` was `20 / 60` (20 seconds) — copied from
`vector-walls-warm`'s entry (justified there by a ~900ms cache TTL, an unrelated job with an
unrelated cost) rather than derived from `heatmap-warm`'s own cost. A real `heatmap-warm` run
sweeps the shared ~100-ticker universe through Polygon and has always taken far longer than 20s:
the route's own `OVERLAP_LOCK` comment already documented p50=46.5s/p90=81.1s/p99=181.1s/
max=209.2s, measured live 2026-09-03.

`rthWriterOverdue()` computes `ageMin` from `fetchCronJobLastRuns()`'s `started_at` column — but
that column is populated by a bare SQL `now()` default inside `recordCronJobRun()`'s `INSERT`,
which `logCronRun()` calls at the very END of the route handler (after the full warm sweep
finishes), not at the top where `started` (`Date.now()`) is captured. So despite the name,
`started_at` is actually the run's COMPLETION timestamp. Combined with a 20s heal threshold and a
60-110s real runtime, a run was already "overdue" by the instant it finished — every single time,
with no exceptions — so the in-app leader's own 15s tick (`TICK_MS`, `rth-warm-leader.ts`)
re-commissioned a brand-new, non-overlapping full warm sweep on essentially every opportunity.
(`OVERLAP_LOCK` does its job — it only ever prevents two runs from overlapping IN TIME — but
cannot stop the leader from immediately re-starting a fresh one the moment the previous finishes,
because by the time it finishes, the heal threshold already says it's overdue.)

### Evidence

Live CloudWatch Logs, `/ecs/blackout-production`, 2026-10-08 08:00:02–09:48:04 UTC (the
pre-EventBridge 4am-7am ET pre-market window — see below): 70 consecutive
`[rth-warm-leader] backup warm 'heatmap-warm' ok (Nms)` lines, **zero** overlap/cooldown skips
(every single line reports a full 52.8-109.4s runtime; a skip would log near-0ms, as every OTHER
leader-backed cron's fast skip/no-op lines do in the same window). Parsed stats (n=70):
runtime min=52.8s / median=60.9s / mean=64.6s / max=109.4s; gap between one run's completion and
the next run's start min=0.0s / median=29.96s / mean=28.4s / max=34.1s; **total wall-clock duty
cycle ≈ 70% over the 108-minute window** (4520s busy / 6481s elapsed).

**Confirmed live via AWS (boto3, this account's existing creds) that EventBridge's OWN schedule
for this cron had not fired at all during that entire window** — `blackout-production-heatmap-warm`
is `cron(*/1 11-21 ? * MON-FRI *)` (1/min, but gated 11:00-21:59 UTC = ~7am-5:59pm ET), and
`AWS/Events` `Invocations` for that rule (and for `desk-warm`/`zerodte-warm`, same `11-21` UTC
gate) was **0** over the measured window, while `platform-warm`/`cron-staleness-watchdog`
(`cron(*/5 * * * ? *)`, no hour gate) showed the expected 24 invocations/2h — ruling out an
EventBridge/metrics-reporting artifact as the explanation. The in-app leader's own wider
`isEtExtendedWarmHours()` window (4am-8pm ET = 08:00-00:00 UTC) opens three hours before
EventBridge's narrower 11:00 UTC start, so **the entire measured window had `heatmap-warm` running
ENTIRELY off this one threshold, with no EventBridge contribution at all** — isolating the heal
threshold as the sole, sufficient cause (not an EventBridge-cadence interaction).

RED→GREEN proof (`src/lib/rth-warm-leader.test.ts`): stashing only the logic-file fix and running
the updated test file against the OLD 20s threshold fails exactly the one new assertion that
encodes the bug (`heatmap-warm fresh at 70s` — 70s is comfortably below the job's own real
runtime, so it should read "not overdue"; under the old 20s threshold it wrongly read "overdue").
Restoring the fix: 13/13 (then 21/21 with the route's own test file) pass. Full suite
(`npm test`, Node 20.20.2, 1724 files) green, 0 failures. `tsc --noEmit` clean.

### What this finding does NOT claim (steelmanned against the original hypothesis)

The investigating prompt for this cycle hypothesized the near-continuous duty cycle was
*measurably* causing ALB `TargetResponseTime` spikes (citing a 09:32:00Z 21.3s Max spike
bracketing one run). Checked properly with a 2-hour, 1-minute-granularity `TargetResponseTime`
series cross-referenced minute-by-minute against every `heatmap-warm` run interval: the mean
heatmap-warm-overlap fraction for ALB-spike minutes (≥5s/8s/10s/15s/20s Max thresholds, n=24/13/5/
3/3) was **statistically indistinguishable from** — and at several thresholds slightly *lower*
than — the overlap fraction for non-spike minutes (67-71% vs 67-68% across all five thresholds).
Given the job is in-flight ~68-70% of ALL minutes regardless, almost any randomly-picked minute —
spiking or not — has a high chance of overlapping with it by pure base rate; the data does not
support "this specific run caused that specific spike" as a distinguishing factor. **This fix is
justified on its own terms** (a backup-heal threshold that is a full order of magnitude tighter
than the job's own real cost, causing a "backup" mechanism to run as the de facto sole primary at
near-100% duty cycle for 3 hours a day) — the same design flaw every other entry in
`RTH_WRITER_HEAL_AFTER_MIN` deliberately avoids by setting its threshold near-or-above its own
job's real cadence — not on an ALB-latency-causation claim that the fuller measurement here does
not bear out. Per the standing discipline against speculative fixes (the #5061/#5065 precedent),
this write-up reports the correlation result honestly rather than retrofitting the evidence to
the original hypothesis.

### Fix

Raised `RTH_WRITER_HEAL_AFTER_MIN["heatmap-warm"]` from `20 / 60` to `81 / 60` (81s — the job's own
measured p90 runtime, both historically on 2026-09-03 and reconfirmed live today). This has **no
RTH freshness cost**: during EventBridge's own active window (11:00-21:59 UTC) its independent
1/min schedule — not this threshold — governs cadence whenever EventBridge is healthy; the
threshold only governs the leader's own "is this overdue" check, which now only fires when a run
has genuinely stalled past its own typical cost, giving the leader honest backup semantics
matching the design of every sibling entry in this same map (`vector-pick-sweep`: 4 min,
`meridian-warm`: 5 min, `desk-warm`: 1.5 min — all set near-or-above their own job's real
cadence). During the pre-EventBridge 4am-7am ET window, this throttles the duty cycle from ~70%
down to roughly runtime/(runtime+81s) ≈ 43% — a real, legitimate reduction in needless
~100-ticker Polygon fan-out during a window with no cash-session trading at all.

### Blast radius / other fixed call sites

Three stale doc comments citing the old "20s" / "~30-45s" values were corrected in the same PR so
they don't mislead the next reader (same "blast radius" discipline as every other finding here):
- `src/app/api/cron/heatmap-warm/route.ts` — the file's own header ("Schedule: ~every 30-45s") and
  the `RERUN_COOLDOWN_KEY` doc comment (claimed the leader's heal threshold was "20s, the TIGHTEST
  of any watched key" and EventBridge's schedule was "~30-45s" — both now corrected to the real,
  AWS-confirmed values: 81s heal threshold, EventBridge `cron(*/1 11-21 ? * MON-FRI *)`).
- `src/lib/cron-registry.ts` — `heatmap-warm`'s `schedule_label`/`description` referenced the old
  "~20s" leader cadence.

`vector-walls-warm`'s own 20s entry (a different job with a genuinely different, ~900ms-TTL-driven
justification) was deliberately left untouched — this finding is specific to `heatmap-warm`'s
mismatch between its real cost and its copied-over threshold, not a blanket "lower every 20s
entry" change.

### Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — re-check tomorrow's pre-market (4-7am ET)
CloudWatch Logs for `[rth-warm-leader] backup warm 'heatmap-warm'` and confirm the gap between
completion and the next start has widened from ~30s to roughly 80-95s, and that Thermal
SPY/SPX/QQQ (the force-refreshed CORE set) still read a reasonably fresh `asof` during that window.
