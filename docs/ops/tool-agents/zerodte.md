# 0DTE Command — dedicated tool agent

**Agent:** `npm run validate:tool-agent:zerodte`  
**Route:** `/nighthawk` (0DTE tab)  
**Reports:** `audit-output/tool-agents/zerodte/`

## Mission

Single-name 0DTE scanner: board freshness, setup log, earnings match, scanner cron `zerodte-warm`.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | `/api/market/zerodte/board` — setups array, flagged today |
| Scanner alive | `zerodte-warm` cron ok in last 15m |
| Play/setups | `zerodte_setup_log` rows today — premium_usd finite |
| UI E2E | `validate:grid-e2e` every 4 ticks |
| Latency | board &lt;1.2s |

## Fix validation

```bash
npm run validate:tool-agent:zerodte -- --once
npm run validate:grid-rth
npm run validate:grid-e2e
```
