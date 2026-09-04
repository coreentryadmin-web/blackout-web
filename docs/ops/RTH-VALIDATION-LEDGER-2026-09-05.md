# RTH Validation Ledger — 2026-09-05 (Friday market open)

> **Autonomous lifecycle pass.** Run `npm run blackout:rth-lifecycle` at 09:00 ET.
> Do NOT wait for user prompt. Fix failures → PR → merge → re-validate until GREEN.

**Prepared:** 2026-09-04 ~05:00 UTC (off-hours sweep)  
**Main @ prep time:** `565a9a755` (play-engine heartbeat clock-skew clamp)  
**Next RTH window:** Friday 2026-09-05, 09:00–16:15 ET

---

## Issues fixed this cycle (validate tomorrow)

| # | PR | Area | Fix | RTH validation |
|---|-----|------|-----|----------------|
| 1 | #3480 | Autopilot | Standing work queue + `discoverStandingWork` + never-idle loop in dispatch-prompt | `npm run blackout:select` returns BO-P1-0100 without empty queue |
| 2 | #3492 | Autopilot | Dispatch on every `push` to main + CI green + merged PR; heartbeat guard no longer blocks | After merge: confirm Actions "BLACKOUT Autopilot dispatch" fires on next main push |
| 3 | #3479 | Perf | `runWithBackgroundUwSweep` — reserve 1 UW slot for live traffic during vector sweeps | CloudWatch ALB p99 < 5s during RTH; no Max ~119s tail during vector-full-state-snapshot |
| 4 | #3481 | GEX | `peekGexHeatmapCache` age_sec clamped ≥ 0 (clock skew) | Thermal + SPX matrix `matrix_age_sec` never negative |
| 5 | #3482 | Meridian | `expected_move_pct` withheld after print (intel layer) | LULU-style post-print: no "Options-implied move" chip |
| 6 | #3486 | Vector | Inverted logical range guard before lightweight-charts apply | Vector chart no blank/crash on bad range |
| 7 | #3487 | Thermal | `chain_truncated` badge on matrix UI + Largo projection | `/heatmap` shows truncation badge when chain paginates early |
| 8 | #3489 | Admin | Play-engine heartbeat age clamped for cross-replica clock skew | `/admin` play engine heartbeat age sane (not 1.6B sec) |
| 9 | #3490 | Autopilot | PR webhook triage survives Cursor agent launch failure | Triage job green even when agent curl fails |
| 10 | #3476 | 0DTE | `parseReplayStdout` — counterfactual replay JSON parse | `npm run counterfactual:0dte-g18-g19` with Clerk creds: no "replay parse failed" |
| 11 | #3463 | 0DTE | Calibration `available:false` graceful handling | Off-hours: structured `calibration_error`, exit 0 |
| 12 | #3469 | Largo | Morning-brief DST double-fire gate (9:25 ET) | Only ONE push per member at ~9:25 ET |
| 13 | #3468 | Cron | meridian-warm overlap guard | No duplicate warm fan-out across replicas |
| 14 | #3477 | Autopilot | PR webhook non-blocking agent dispatch | Same as #10 row |

---

## Off-hours baseline (2026-09-04 ~05:00 UTC)

| Check | Result | Notes |
|-------|--------|-------|
| `ops:collect` | ✅ 0 items | |
| `validate:deploy` | ✅ GREEN | 7 warnings (no CRON_SECRET/DB in sandbox — expected) |
| `validate:api-auth` | ✅ GREEN | 223 routes guarded |
| `validate:platform-integrity` | ⚠️ 3 pass, 4 warn, 0 fail | Off-hours: empty thermal strikes, no spot — **re-check at 09:35 ET** |
| `validate:seo` | ✅ 19/19 pass | robots, sitemap, JSON-LD, GA4, learn hub |
| `validate:seo-cwv` | ⏭️ SKIP | PAGESPEED_API_KEY not set in sandbox |
| `counterfactual:0dte-g18-g19` | ⏭️ SKIP | CLERK_SECRET_KEY not in sandbox — **run at RTH with prod creds** |

---

## Tomorrow RTH checklist (09:00 ET — run in order)

```bash
npm run blackout:rth-lifecycle          # full autonomous sweep
npm run validate:rth-open               # cron + socket + deploy
npm run counterfactual:0dte-g18-g19     # G-18/G-19 report (needs Clerk)
npm run validate:rth-four-engines       # SPX/NH/Vector/0DTE play paths
npm run validate:platform-integrity     # expect 0 warn on SPY/QQQ strikes
npm run validate:thermal-ui             # clickthrough + screenshots
npm run validate:vector-rth-quick       # vector desk RTH smoke
npm run validate:site-latency           # public page TTFB
npm run validate:seo-cwv                # needs PAGESPEED_API_KEY
```

### CloudWatch (manual / AWS CLI)

- ALB `TargetResponseTime` p99 during 09:30–16:00 ET — target < 5s (was 11–39s pre-#3479)
- `/ecs/blackout-production` — no `vector-full-state-snapshot` elapsed > 120s with `budgetHit=true` overlapping member requests
- uw-socket: authenticated lines after 09:30 ET

### Live UI (Playwright — needs Clerk)

- `/dashboard`, `/heatmap`, `/nighthawk`, `/vector`, SPX Slayer rail
- Admin `/admin` → System Vitals, play engine heartbeat
- Meridian earnings card — no implied move after print

---

## Open / not fixed (track tomorrow)

| ID | Pri | Issue | Owner lane |
|----|-----|-------|------------|
| OPS-001 | P2 | ECS deploy still one-task-at-a-time despite maxPercent=200 | Infra — see `2026-09-04-ecs-web-rolling-deploy-maxpercent-no-effect.md` |
| OPS-002 | P3 | Merge waves starve deploy queue (7 superseded deploys) | Infra — concurrency policy on ecr-push |
| SEO-001 | P3 | CWV monitor needs PAGESPEED_API_KEY in Actions secrets | Ops |
| 0DTE-001 | P1 | Live G-18/G-19 counterfactual report in RTH | cursor — Clerk creds required |

---

## Autonomous loop (standing — never mark DONE)

| Task ID | Trigger |
|---------|---------|
| BO-P1-0100 | Peer review open PRs |
| BO-P1-0101 | Deploy/ops verification after every merge |
| BO-P1-0102 | RTH lifecycle sweep (this ledger) |
| BO-P1-0103 | SEO/geo/CWV monitor |
| BO-P1-0104 | CloudWatch + latency (RTH only) |
| BO-P2-0100 | 0DTE lane maintenance |

**Stop condition:** `ops:collect` count=0 AND `validate:rth-open` GREEN AND platform-integrity 0 fail AND no open PRs needing review. Warnings off-hours expected; re-evaluate at RTH.
