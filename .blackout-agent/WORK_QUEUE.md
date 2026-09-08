# WORK QUEUE

| ID | Pri | Title | Owner | Status |
|----|-----|-------|-------|--------|
| BO-P1-0100 | P1 | Standing: peer-review open PRs (never mark DONE) | cursor | QUEUED (standing) |
| BO-P1-0101 | P1 | Standing: deploy/ops verification (never mark DONE) | cursor | QUEUED (standing) |
| BO-P1-0102 | P1 | Standing: RTH lifecycle sweep (`blackout:rth-lifecycle`) | cursor | QUEUED (standing) |
| BO-P1-0103 | P2 | Standing: SEO/geo/CWV monitor | cursor | QUEUED (standing) |
| BO-P1-0104 | P2 | Standing: CloudWatch + latency (RTH only) | cursor | QUEUED (standing) |
| BO-P1-0105 | P1 | Standing: hourly autonomous wake checklist (`blackout:hourly`) | cursor | QUEUED (standing) |
| BO-P2-0100 | P2 | Standing: 0DTE lane maintenance (never mark DONE) | cursor | QUEUED (standing) |
| BO-P1-0008 | P1 | Peer review Claude cron fixes (#3468, #3469) | cursor | DONE (merged) |
| BO-P1-0007 | P1 | PR webhook triage + peer review dispatch | cursor | DONE (#3439 merged) |
| BO-P1-0004 | P1 | Post-deploy 0DTE replay (G-18/G-19 counterfactual) | cursor | DONE (#3452 + #3463 merged) |
| BO-P1-0005 | P1 | Review Claude PRs when verify green | cursor | DONE (#3454 merged) |
| BO-P2-0003 | P2 | Vector-gated runners only | cursor | DONE (#3451 merged) |
| BO-P1-0001 | P1 | BLACKOUT Autopilot shared state | cursor | DONE (#3436 merged) |
| BO-P1-0006 | P1 | Autopilot hardening (session/review/watchdog/guard) | cursor | DONE (#3436 merged) |

**Standing tasks** (`QUEUED (standing)`) are perpetual — never mark DONE. `select-task` also auto-discovers open PRs and deploy drift.

**RTH ledger:** `docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md`  
**Lifecycle command:** `npm run blackout:rth-lifecycle`

Claim: `npm run blackout:claim -- --id=BO-Px-xxxx --owner=<agent>`
