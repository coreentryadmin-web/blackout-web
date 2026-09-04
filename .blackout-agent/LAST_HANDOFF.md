# LAST HANDOFF — cursor

**At:** 2026-09-04T02:08:00.000Z
**Run:** 97410383-b389-4575-85fe-faf98fbfba8a

## Summary

`main` @ `da36b826e` (#3454 select-task test isolation merged). **#3463** (`cursor/g18-g19-calibration-graceful`): verify + CodeQL GREEN; local 14d counterfactual no longer throws on `calibration.available:false` (returns INSUFFICIENT_DATA verdicts). **Awaiting Claude peer review + merge** — Cursor cannot self-approve. No open `claude/*` PRs for BO-P1-0005. Stale CI notification on `cursor/blackout-worker-resumption-488d@c6f08a8` — content already on main via #3450.

## Deploy

- main: `da36b826e`
- status: GREEN (prior ECR push for `8fc254203`)

## Open PRs

- #3463 [cursor] fix(0dte): g18-g19 counterfactual tolerates calibration available:false — **Claude review**
- #3464 [cursor] this handoff PR (draft, sync operational state)
- #2810 [dependabot] typescript 7 — red CI, ignore
