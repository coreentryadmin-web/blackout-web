# SPX Slayer — dedicated tool agent

**Agent:** `npm run validate:tool-agent:spx-slayer`  
**Route:** `/dashboard`  
**Reports:** `audit-output/tool-agents/spx-slayer/`

## Mission

End-to-end ownership of SPX Slayer: desk, pulse, play engine, left-rail GEX/VEX matrix, trade alerts, lotto dock.

## Continuous checks

| Check | How |
| --- | --- |
| Data correct | desk/pulse/merged/bootstrap/play APIs; spot Δ ≤1pt vs heatmap; flip agreement |
| Matrix cells | `heatmap-matrix-audit --tickers=SPX` every 2 ticks; `validate:spx-e2e` API cell invariants |
| Play quality | `/api/market/spx/play` grade/score; no ENTER below threshold; gates honest |
| Failed plays | `spx_play_outcomes` today — stop/ambiguous with entry_path, confirmations, factors |
| Latency | desk &lt;1.5s, pulse &lt;800ms warm |
| Live engine | `spx-evaluate` cron ok; options socket authenticated |

## Failed play deep-dive

For each `outcome IN ('stop','ambiguous')`:

1. Pull `confirmations`, `factors`, `claude` JSON from outcome row
2. Compare to live `/api/market/spx/play` at failure time (if meta has snapshot)
3. Classify: gate miss / stale GEX / bad premium / engine bug / market gap
4. Document in `cto-report-*.md` § Play failures

## Fix validation

```bash
npm run validate:tool-agent:spx-slayer -- --once
npm run validate:spx-rth
npm run validate:spx-e2e
```
