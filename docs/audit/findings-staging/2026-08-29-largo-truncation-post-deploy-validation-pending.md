# 2026-08-29 — [FINDING, P1 Largo] Post-Deploy Validation Still Shows 3 Tools Truncated — Deployment Status Unclear

> **kind:** FINDING

| Field | Detail |
|---|---|
| **Symptom** | Truncation probe executed 2026-08-29 22:54 UTC (after PR #3166 merge and ECS deployment window) against three tools that should be fixed by the runtime byte-budget approach: `get_market_oi_change`, `get_screener`, `get_group_greek_flow`. All three returned `TRUNCATED` verdict. |
| **Expected vs Actual** | PR #3166 switched from fixed-count caps to `fitRowsToBudget` (runtime byte-budget measurement), which should measure actual payload sizes and never go stale. Probe expected `COMPLETE`. Received `TRUNCATED` on all three. |
| **Possible Root Causes** | (1) ECS deployment of PR #3166 is still in progress or has stalled — old image still running on some/all tasks; (2) Largo agent has a response cache that hasn't invalidated post-deploy; (3) The runtime byte-budget fix has a logic error or unintended constraint not caught by tests. |
| **Investigation Status** | Blocked — cannot run `aws ecs describe-services` to check task status (credentials/CLI not available in sandbox). Requires either: (a) direct ECS console check or CLI run from operator machine, (b) manual query of deployed code commit, or (c) revalidation probe after explicit ECS force-new-deployment. |
| **Status** | OPEN — requires deployment status investigation before root cause can be determined |

---

## Timeline

- 2026-08-29 22:24:22 UTC: PR #3166 created with runtime byte-budget fix (fitRowsToBudget approach)
- 2026-08-29 22:36-22:51 UTC: PR #3166 CI validation passing (all checks green)
- ~2026-08-29 22:40 UTC: Coordinator merged PR #3166 to main (commit b1baaa41b)
- 2026-08-29 22:52 UTC: Scheduled post-deploy validation wakeup set
- 2026-08-29 22:54 UTC: Truncation probe executed against prod, all three tools TRUNCATED

---

## The Fix That Should Have Worked

The runtime byte-budget approach in PR #3166:
- Replaced fixed-count caps (20, 15, 8, 6) with `fitRowsToBudget` calls
- `fitRowsToBudget` serializes the payload to JSON iteratively and measures actual bytes
- Stops adding rows once serialized size exceeds `LARGO_RESULT_CHAR_BUDGET` (14,000 bytes, 87.5% of transport cap)
- Cannot go stale relative to actual data — the size is measured at runtime, not estimated ahead of time

All three tools (fitMarketOiChangeForModel, fitScreenerForModel, fitGroupGreekFlowForModel) were rewritten to use this approach.

---

## Next Steps

1. **Immediate:** Verify ECS deployment status — did 8/8 tasks roll over to the new image?
2. **If deployed:** Re-run probe to rule out transient failures
3. **If not deployed or failed:** Trigger manual ECS redeploy of latest main
4. **If still truncated after confirmed redeploy:** Investigate fitRowsToBudget logic or real data characteristics that don't match test expectations

---

