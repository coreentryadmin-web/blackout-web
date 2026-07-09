# RTH continuous monitor — entire site, maximum data

**Goal:** During cash RTH (09:30–16:00 ET), collect latency + correctness data across **every tool** as fast as is safe, fix slowness the same session.

## Command

```bash
# Runs from 09:30 ET through close (waits if started early)
npm run validate:rth-continuous

# Single 2-minute sample (CI / smoke)
npm run validate:rth-continuous:once
```

## Probe tiers (defaults)

| Tier | Cadence | What |
|---|---|---|
| **Fast API** | every **2s** | 12 premium APIs — ready, SPX bootstrap/desk/pulse/play, GEX SPX/SPY, positioning, Vector universe, flows, 0DTE, Night Hawk |
| **Matrix** | every **15s** | SPX Slayer strike grid depth, Thermal SPX+SPY, Vector universe rows, HELIX flow count, desk↔heatmap spot cross-check |
| **Browser** | every **45s** | Soft-nav via shell links → SPX / HELIX / Thermal / Vector / Largo / Night Hawk; click GEX/VEX tabs (desk + vector), Thermal Matrix/Profile |
| **Deep** | every **5m** | `heatmap-matrix-audit --tickers=SPX` + `validate:member-dashboard` |

Tune: `--fast-ms=1000 --matrix-ms=10000 --browser-ms=30000`

## Metrics

NDJSON: `audit-output/rth-continuous/YYYY-MM-DD/metrics.ndjson`  
Live status: `audit-output/rth-continuous/YYYY-MM-DD/status.json`

Each line: `{ ts, kind: fast|matrix|browser|deep|issue, ... }`

## Fix loop (autonomous)

1. At **09:30 ET**: `npm run validate:rth-open` (includes `validate:rth-latency`)
2. Start **`npm run validate:rth-continuous`** in tmux for the session
3. On sustained P1 (`status.json` → `p1_streak` or metrics `kind:issue`):
   - Identify slow API from `fast` lines
   - Warm cron stale? → `platform-warm?force=1`
   - Fix code → PR → merge → ECS redeploy → re-run
4. **09:35, 11:00, 13:00, 15:00**: also run `npm run validate:rth-sweep` (full browser + missing-field audit)
5. Post-close: aggregate metrics → top offenders → fix PRs

## Also runs (parallel)

- `validate:vector-rth` — Vector SSE every 60s
- `validate:spx-rth` — SPX agent schedule (GHA)
- `ops:collect` — every 20m

## Thresholds

- API warm: **&lt;1.2s** (P2 warn), **&lt;2s** (P1 fail)
- Page ready: **&lt;2.5s**
- Soft-nav: **&lt;1.5s**
- SPX matrix: **≥15 strikes** during RTH
