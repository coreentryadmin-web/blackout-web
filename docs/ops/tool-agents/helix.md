# HELIX — dedicated tool agent

**Agent:** `npm run validate:tool-agent:helix`  
**Route:** `/flows`  
**Reports:** `audit-output/tool-agents/helix/`

## Mission

Institutional options flow tape: premium dollars, timestamps, ticker tags, SSE liveness, no fabricated prints.

## Continuous checks

| Check | How |
| --- | --- |
| Flow data correct | `/api/market/flows?limit=50` — array shape, finite premium, sane timestamps |
| Empty tape | P2 if zero rows during RTH (unless market halt) |
| Latency | flows API &lt;1.5s warm |
| Live update | Agent manual: sit on page 30s — tape must tick without refresh |
| Cross-tool | High-premium prints appear in HELIX + persist path to alerts |

## Fix validation

```bash
npm run validate:tool-agent:helix -- --once
```
