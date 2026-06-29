# Phase 11 — RTH Live Verification (2026-06-29 ~12:52–13:00 ET)

> **Method:** authenticated prod probes via `Authorization: Bearer $CRON_SECRET` (same auth path
> as premium desk routes) + browser walkthrough (Chrome, screen recorded). Market confirmed open
> (`pulse.market_open=true`, SPX ~7415–7418).

## VERIFIED CLOSED (fixes shipped today)

### F-1 — SPX desk GEX single-source (#18)
Cross-tool alignment at same instant (RTH live):

| Field | GEX API | SPX Desk | Match |
|---|---|---|---|
| spot | 7417 | 7418 | ✅ (≤1pt tick) |
| net_gex | 6.27B | 6.27B | ✅ |
| gamma_flip | 7403 | 7403 | ✅ |
| max_pain | 7450 | 7450 | ✅ |

Desk also reports `gex_stale=false`, `gamma_regime=mean_revert`.

### P-1 — flows cold path (#15)
Warm `/api/market/flows?limit=10` = **61ms** (was 17.8s pre-fix).

### PF-1 / PF-2 — CSP + hydration (#16, #17)
Browser on `/upgrade` (authenticated free-tier session): **no React #418**, **no CSP worker
violations** in console. (Premium desk UI not reachable from this browser session — see below.)

## STILL OPEN

### F-2 — SPX play ledger empty (RTH sample)
- `/api/market/spx/play` returns `phase=SCANNING`, `grade=D`, `open_play=null`.
- Gates **blocking** entry:
  - `"Tape's mixed — too many conflicting signals for clean entry"`
  - `"Flow data stale (23m) — tape and 0DTE signals unreliable"`
  - `"Halt feed stale (UW channel offline)"`
- `/api/track-record` → `spxSlayer.total=0` (all-time).
- **Interpretation:** play engine is **alive** during RTH but gates + stale flow feed prevent
  `openPlay()` from firing — not a dead engine, but no rows will land until gates clear and flow
  freshness recovers. Needs: UW flow ingest health + `flow_data_age_ms` during RTH.

### F-3 — Signal pipeline empty
Not re-queried DB this pass; track-record honestly reports 0. Carried.

### P1-A — market regime dark
`/api/market/regime` → `available=false`. Cron service still unprovisioned (operator step).

### P-2 — cold-build tail (RTH)
First-hit latencies during active session (cache cold on replica):
- `/api/market/spx/desk` **35.7s**
- `/api/market/gex-positioning` **22.7s** (warm repeat still **15.5s** on one sample — investigate)
- `/api/market/spx/flow` **25.3s**

Warm desk/flows: **56–61ms**. Heatmap-warm cron cadence vs matrix TTL still worth sizing.

## Browser pass (recorded)
- Site loads; session authenticated but **free tier** → redirected to `/upgrade` paywall.
- Could not load `/dashboard` or SPX desk UI without Premium.
- Console: 403s on tier-gated `/api/master/indices` (expected for free tier).
- `/api/health` → `ok:true`, DB configured.
- **Recording saved:** `rth-browser-verification-jun29.mp4`

## Recommended next actions
1. **Operator:** verify Flow-Ingest + UW WS during RTH (23m stale flow is blocking plays).
2. **Operator:** provision `Market-Regime-Detector` cron (P1-A).
3. **Dev:** investigate why warm GEX positioning occasionally stays ~15s (single-flight / cache key?).
4. **Audit resume:** premium browser session needed for full desk UI + Heat Maps side-by-side visual.
