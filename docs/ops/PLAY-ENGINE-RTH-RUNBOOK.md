# Play Engine RTH Runbook — 2026-09-04

> **Standing:** Run every **5 minutes** from **09:00–16:15 ET** on trading days until market close.
> Do not wait for user prompt during RTH.

## Quick start

```bash
# 1. Load prod secrets (AWS SM — needs AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION)
eval "$(node scripts/bootstrap-audit-secrets.mjs --export)"

# 2. Start continuous monitor (tmux)
node scripts/rth-live-monitor.mjs --interval-min=5

# 3. One-shot full sweep
node scripts/rth-live-monitor.mjs --once
```

## 5-minute cycle checklist

| Step | Command | Pass criteria |
|------|---------|---------------|
| 1 | `npm run validate:gha-smoke` | health/ready/regime 200 |
| 2 | `npm run validate:platform-integrity` | 0 fail; SPY/QQQ strikes >0 in RTH |
| 3 | `npm run validate:api-auth` | all routes guarded |
| 4 | `node scripts/audit/data-validator.mjs` | pin drift + quote % sign OK |
| 5 | `node scripts/audit/rth-four-engine-play-audit.mjs` | verdict GREEN, 0 RED |
| 6 | `npm run validate:play-engine-quality` | 0DTE runner profiles tagged; peak≥100% tracked |
| 7 | `npm run validate:vector-rth-quick` | Vector desk live |
| 8 (RTH) | `npm run validate:spx-rth` | SPX matrix + play rail |
| 9 (RTH) | `npm run validate:grid-rth` | 0DTE grid |
| 10 (RTH) | `npm run validate:legacy-board-ui` | Legacy NH board UI |
| 11 (RTH) | `npm run validate:nighthawk-vector-board-ui` | Vector NH board UI |
| 12 (every 6th) | `npm run validate:deploy` | deploy smoke |

**Logs:** `audit-output/rth-live-monitor.log`  
**Status:** `audit-output/rth-live-monitor-status.json`  
**Play quality:** `audit-output/play-engine-quality-latest.json`

---

## Four engines — what to validate

### 0DTE Night Hawk (primary — 100–500% target)

**Goal:** Vector-aligned A/B plays with frozen `runner_profile` targets (+200% / +250% / +300% / +400%).

| Check | Where | How |
|-------|-------|-----|
| Commits flowing | `/api/market/zerodte/board` | `ledger` + `setups` non-empty by 10:15 ET |
| Runner geometry | `entry_context.runner_profile.tag` | `runner_vector` / `runner_a` on Vector winners |
| Peak capture | `peak_premium_pct` | Track % hitting +100 / +200 / +400 |
| G-18/G-19 | `zerodte_scan_rejections` | `early_window_prime_score`, `score_top_band` |
| Vector alignment | `vector_pulse` on row | Same direction as setup; not opposite-side leader |
| OTM path | 12–20% OTM | Should reach commit gates (runner relax) |

**Improvement levers (deployed today):**
- G-19 exempts Vector **runners** (not only winners) — same as G-17
- Discovery OTM cap raised to 20% — commit moneyness still 12% unless runner relax
- Direction-specific Vector pulse — no PUT winner blocking LONG setup
- B→A tier promotion for 85+ Vector winners → unlocks `runner_vector` (400%)
- **Liquid strike fallback** — walks chain when primary strike is `plan_illiquid` (PR #3698)
- **Amplify relief env knobs** (set on prod without redeploy):

```bash
ZERODTE_REGIME_SCORE_BUMP=8
ZERODTE_PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY=25
ZERODTE_AMPLIFY_THESIS_BYPASS_MIN_SCORE=75
ZERODTE_AMPLIFY_THESIS_ARCHETYPE_MIN_SCORE=75   # archetype floor relief threshold
```

Kill-switches: `ZERODTE_LIQUID_STRIKE_FALLBACK=0`, `ZERODTE_AMPLIFY_THESIS_ARCHETYPE_RELIEF=0`

**Counterfactual audits:**
```bash
npm run counterfactual:0dte-g18-g19 -- --days=14
npm run replay:0dte-session -- --days=5
```

### Vector

| Check | API / UI |
|-------|----------|
| Leaders live | `/api/market/vector/pick-closures/board` |
| Winner band | `premium_pct_from_entry` ≥ +50% |
| Runner band | +15–49% building |
| `dont_buy` on winners | Flag in four-engine audit |

### Legacy Night Hawk

| Check | API |
|-------|-----|
| Edition plays | `/api/market/nighthawk/edition` |
| Morning confirm | `/api/nighthawk/play-status` |
| Premium cap | entry ≤ $20 |
| R:R | `rr_ratio` ≥ 1 for top ranks |

### SPX Slayer

| Check | API |
|-------|-----|
| Active play | `/api/market/spx/play` |
| Pin drift | `data-validator` — projectedClose − spot |
| Quote header % | sign matches SPY move (not flat 0%) |
| Matrix spot | `/api/market/gex-heatmap?ticker=SPX` agrees with desk |

---

## Live UI validation (Playwright)

Requires `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.

```bash
node scripts/audit/nighthawk-boards-prod-screenshots.mjs   # Vector + Legacy
node scripts/spx-dashboard-e2e-audit.mjs                   # SPX desk
node scripts/grid-zerodte-e2e-audit.mjs                    # 0DTE grid
npm run test:ios-ui-e2e                                    # Full tab sweep
```

Screenshots → `/opt/cursor/artifacts/`

---

## Secret bootstrap (AWS Secrets Manager)

Secret: `blackout-production/app/env` (region `us-east-1`)

Required keys for full audit:
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CRON_SECRET`, `POLYGON_API_KEY`, `UW_API_KEY`
- `DATABASE_URL` or `DATABASE_PUBLIC_URL`

```bash
node scripts/bootstrap-audit-secrets.mjs
# → audit-output/.env.audit
```

**Cursor Cloud Agent:** Inject `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` from team secrets so `auditSecret()` can reach Secrets Manager.

---

## Failure response

1. **RED in four-engine audit** → read `audit-output/rth-live-fail-*.log`
2. **0DTE no commits by 10:30** → check `zerodte-scan` cron, G-18/G-19 rejection funnel
3. **No runner profiles** → Vector pulse coverage; confirm Vector desk has winners
4. **Platform integrity cold** → tier-gated without auth OR market worker WS down
5. Fix in `src/` → branch → PR → merge → poll ECS deploy → re-validate

---

## Session notes template

```
## Cycle N — HH:MM ET
- gha-smoke: PASS/FAIL
- platform-integrity: X pass / Y warn
- four-engine: verdict / RED count
- 0DTE: ledger=N setups=M runner_profiles=K peak≥100%=J
- Vector: leaders=N winners=N top=TKR +X%
- Legacy: plays=N morning=OK/DEGRADED
- SPX: action= status=
- Actions taken:
```
