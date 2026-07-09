# Vector — dedicated tool agent

**Agent:** `npm run validate:tool-agent:vector`  
**Route:** `/vector`  
**Reports:** `audit-output/tool-agents/vector/`

## Mission

Live chart + GEX/VEX wall beads, flip levels, dark pool overlays, universe scanner — chart SSR + SSE stream.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | universe rows ≥10; walls agree with SPX heatmap |
| Matrix/walls | `heatmap-matrix-audit SPX` for wall derivation; vector-rth stream cross-check |
| Seed bars | SSR cache hit — page ready &lt;2.5s warm |
| UI E2E | `validate:vector-e2e` — GEX/VEX lens, timeframe, replay |
| Latency | universe &lt;1.2s; chart paint |

## Parallel monitor

Also runs legacy `npm run validate:vector-rth` (60s SSE loop) — keep both during RTH.

## Fix validation

```bash
npm run validate:tool-agent:vector -- --once
npm run validate:vector-e2e
npm run validate:vector-rth -- --once
```
