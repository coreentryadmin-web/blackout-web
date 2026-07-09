# BlackOut Thermal — dedicated tool agent

**Agent:** `npm run validate:tool-agent:thermal`  
**Route:** `/heatmap`  
**Reports:** `audit-output/tool-agents/thermal/`

## Mission

Full GEX/VEX/DEX/CHARM matrix correctness for all Thermal presets; Matrix + Profile tabs; cross-validation vs UW.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | gex-heatmap SPX/SPY/QQQ/NVDA; positioning; `data-correctness?surface=heatmap` |
| Matrix cells | `heatmap-matrix-audit` on SPX, SPY, QQQ, NVDA — Σ strikes = headline, INV-2 per strike |
| Play quality | N/A (Thermal is structure, not plays) |
| Cross-tool | flip/walls match SPX desk + Vector wall scope |
| Latency | gex-heatmap warm &lt;2s |
| UI | Matrix tab + Profile tab; lens toggles GEX/VEX/DEX/CHARM |

## Fix validation

```bash
npm run validate:tool-agent:thermal -- --once
node scripts/heatmap-matrix-audit.mjs --tickers=SPX,SPY
npm run validate:rth-sweep  # heatmap section
```
