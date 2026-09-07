## 2026-09-07 — [FINDING, P2 performance] `isDeployCacheWarmAllowed` didn't model NYSE holidays — validate:deploy-class scripts hammered `desk-warm?force=1` all session on Labor Day — FIXED

> **kind:** `FINDING`

### Symptom

Standing performance/latency audit mandate sweep, live on Labor Day 2026-09-07 (a market holiday
falling on a Monday). `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app`'s
target group showed a sustained tail-latency pattern all session: p50 stayed healthy (~20-30ms)
but Max repeatedly hit ~20-50s and one 30-min window (12:48-13:18 UTC) spiked to **p99 78.7s / Max
100.1s**.

CloudWatch Logs (`/ecs/blackout-production`) traced it to `[cache-warmer-gate] force=1 bypassed
the hours gate for 'desk-warm'` firing roughly every 20-90 seconds continuously, from dozens of
distinct source IPs, all `ua=node` — each triggering a 5-94s `desk-warm` run
(`desk=true gex=true bootstrap=true flowsWarm=true enrich=true`).

### Root cause

`scripts/lib/cache-warm-deploy-gate.mjs`'s `isDeployCacheWarmAllowed()` — the gate
`validate-deploy.mjs`, `latency-burst-audit.mjs`, and `compare-latency-envs.mjs` all call before
their `?force=1` cache-warm probes (added in #4017 after the original #4013 weekend desk-warm
force storm) — only checked weekday + ET hour window, with its own comment stating the gap
explicitly: *"Match isEtExtendedWarmHours: weekday 4:00 AM–8:00 PM ET (**NYSE holidays not modeled
here**)."*

Labor Day 2026-09-07 is a weekday (Monday) inside that 4 AM-8 PM ET window, so the gate returned
`true` all day. Every Cloud Agent that ran `npm run validate:deploy` (or the latency-audit
scripts) today therefore force-warmed `desk-warm`/`heatmap-warm`/`zerodte-warm` on a genuine market
holiday — exactly the storm #4017 was built to prevent, just gated on the wrong calendar. The
server-side warmers this script's probes are meant to mirror stayed correctly silent all day
(`isEtExtendedWarmHours` → `isTradingDayEt` → holiday-aware), so this was purely a deploy-tooling
gap, not a regression in the production warm path itself — consistent with today's separately-fixed
`market_hours_only` cron-route gaps (#4482/#4483/#4484/#4485), but in test/deploy tooling rather
than a cron route.

### Fix

Added a mirrored `US_MARKET_HOLIDAYS` Set to `cache-warm-deploy-gate.mjs` (copied from
`src/features/nighthawk/lib/session.ts`'s canonical list — this script runs via plain `node`, not
`tsx`, so it can't import the `.ts` module directly; kept in lockstep the same way this repo's
other mirrored-logic `.mjs` audit helpers already do, e.g. `print-window-eval.mjs`) and checks it
before the hour-window math.

### Evidence

- RED→GREEN: `git stash` the fix, new test `isDeployCacheWarmAllowed: rejects a NYSE holiday that
  falls on a weekday (Labor Day 2026-09-07)` fails (6/7 pass) — restored, 7/7 pass. A second new
  test (`still accepts an ordinary weekday one day after a holiday`) confirms the holiday check
  doesn't over-match into 2026-09-08.
- `scripts/latency-scripts-desk-warm-gate.test.mjs` (the sibling drift-guard pinning that
  `latency-burst-audit.mjs`/`compare-latency-envs.mjs` call this gate before their force=1 dispatch)
  still 2/2 pass, unaffected.
- Live CloudWatch: `AWS/ApplicationELB` `TargetResponseTime` on the same target group,
  `blackout-production-app`, over the 90 minutes preceding this fix showed the pattern; 30-min
  windows after the market_hours_only cron-route fixes landed (14:18-15:14 UTC) already showed
  recovery from the 78s/100s spike, though intermittent ~20-50s desk-warm runs (this gate's own
  bug) continued until this fix.
- `npx tsc --noEmit -p .`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`scripts/lib/cache-warm-deploy-gate.mjs` (holiday check added) and its test file. No production
route or server-side warmer behavior changed — this is deploy/audit tooling only. The four crons
already fixed today (#4482/#4483/#4484/#4485) are unaffected/unrelated call sites.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
