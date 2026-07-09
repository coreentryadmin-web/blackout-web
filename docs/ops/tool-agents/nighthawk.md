# Night Hawk — dedicated tool agent

**Agent:** `npm run validate:tool-agent:nighthawk`  
**Route:** `/nighthawk`  
**Reports:** `audit-output/tool-agents/nighthawk/`

## Mission

Overnight + RTH playbook plays: edition freshness, ticket premiums, morning confirm status, outcome grading.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | `/api/market/nighthawk/edition` — plays array, finite premiums |
| Play quality | conviction + score sane; no tickets with $0 premium shown as live |
| Failed plays | `nighthawk_play_outcomes` — stop/ambiguous/unfilled with edition_for |
| Morning confirm | Redis/badge status from `nighthawk-morning-confirm` cron |
| Latency | edition API &lt;1.2s |

## Failed play deep-dive

For stop/ambiguous: compare edition play vs session high/low vs target/stop geometry.

## Fix validation

```bash
npm run validate:tool-agent:nighthawk -- --once
```
