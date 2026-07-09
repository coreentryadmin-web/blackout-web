# Largo — dedicated tool agent

**Agent:** `npm run validate:tool-agent:largo`  
**Route:** `/terminal`  
**Reports:** `audit-output/tool-agents/largo/`

## Mission

AI desk officer: grounded answers, correct tool citations, working status lines, no hallucinated numbers.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | Answers cite live tools; numbers match `/api/market/*` when queried |
| Platform snapshot | `/api/market/platform/snapshot` fresh |
| SSE query | Multi-tool question via `largo/query?stream=1` — tools_used includes desk/flows/heatmap |
| Latency | First token &lt;5s; full answer &lt;90s |
| Console | Zero hydration errors on `/terminal` |

## Fix validation

```bash
npm run validate:tool-agent:largo -- --once
npm run validate:rth-sweep  # Largo SSE section
```
