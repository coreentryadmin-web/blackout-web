# 0DTE Architecture V2 — phased plan

Status: **Phase 1 in progress** (2026-08-04)

## Problem statement

The live pipeline is **one-directional**: Discovery → Gates → Commit → Manage → Grade. Calibration **measures** outcomes but does not **actuate** discovery weights. Rails run in **parallel with static merge rules** regardless of market regime. Discovery is **scan-ephemeral** (no persistent object + event log). The UI **compresses** engine reasoning into a ticker + P&L.

Aug 3 2026 evidence (UW + Polygon + prod CloudWatch):

| Layer | Tape offered | Engine surfaced | Committed OPEN |
|-------|--------------|-----------------|----------------|
| UW flow | 2,300+ alerts / 307 tickers (3d window) | ~8–9 FLOW/cycle | 2 (META, AMD…) |
| BREAKOUT | 100+ momentum movers | ~1–3/cycle after chain-walk | merged into pool |
| PIN | 30-name universe | 0 (no pin regime) | — |
| Sim gradeable 0DTE | QQQ, MSFT, SPY, NVDA, AMD | — | 80% WR on 5 names |

**Bottleneck is not seat caps (48 FLOW).** It is (1) **chain-walk** (`no_same_day_contract` ~94%), (2) **commit gates** (Cortex, G-3, G-4, governor), (3) **no regime-adaptive rail ranking**.

---

## Target architecture

```
Market State Engine (regime + confidence)
        ↓ rail weights
   FLOW / BREAKOUT / PIN
        ↓
Discovery Object (session:ticker, confidence history)
        ↓ append-only events
   Gates + Portfolio Governor
        ↓
Commit → Manage → Grade
        ↓
Calibration graduation → rail priors (shadow → enforce)
```

---

## Phase 1 — shipped in this PR

| Item | File | Notes |
|------|------|-------|
| **Market State Engine v0** | `src/lib/zerodte/market-state-engine.ts` | Trend → FLOW/BREAKOUT up, PIN down; range → inverse |
| **Scan wiring** | `src/lib/zerodte/scan.ts` | Re-sort merged pool by weighted score; log `[zerodte-scan] market_state` |
| **Discovery events table** | `src/lib/db.ts` | `zerodte_discovery_events` append-only |
| **Event types** | `src/lib/zerodte/discovery-events.ts` | detected, score_changed, gate_blocked, commit, trim, stop |
| **BREAKOUT floor 65** | `src/lib/zerodte/gates.ts` | Was 70; recall probe + Aug 3 score band |
| **Market opportunity audit** | `scripts/audit/zerodte-market-opportunity-audit.mjs` | `npm run validate:zerodte-market-opportunity -- --date=YYYY-MM-DD` |

Kill-switch: `ZERODTE_MARKET_STATE_ENABLED=0` restores equal rail weights.

---

## Phase 2a — in progress (this PR)

| Item | File | Notes |
|------|------|-------|
| **BREAKOUT 0DTE→1DTE fallback** | `breakout-source.ts`, `breakout-discovery.ts` | `pickBreakoutContractWithFallback()`; env `ZERODTE_BREAKOUT_ALLOW_1DTE=0` for strict 0DTE-only |
| **Discovery event persist** | `discovery-events-persist.ts`, `scan.ts` | Cron writes `detected`, `gate_blocked`, `commit` to `zerodte_discovery_events` (throttled) |

---

## Phase 2b — shipped in this PR

| Item | File | Notes |
|------|------|-------|
| **Board `market_state`** | `zerodte-service.ts`, `ZeroDteBoard.tsx` | Regime + rail weight pills + summary under session header |
| **Discovery funnel read** | `admin-zerodte-funnel.ts`, `db.ts` | `fetchZeroDteDiscoveryEvents` + session-scoped rejections |
| **Admin funnel API** | `/api/admin/zerodte/funnel` | Admin-gated, read-only |
| **Admin funnel UI** | `AdminBieDashboard.tsx` | DeckPanel: detected / gate_blocked / commit + by-gate HorzBar |

---

## Phase 2c — next

1. **Portfolio Governor** extensions: sector concentration, gamma budget, time-of-day sizing
2. **Calibration actuator** — read origin-band WR → update rail priors in shadow Redis key
3. **Member-facing funnel** — top rejection reason on session strip (optional)

---

## Phase 2b — was "next"

---

## Phase 2 — remaining (was "next")

---

## Phase 3 — learning loop

1. Post-close batch: origin × regime × outcome → `calibration.ts` graduation
2. Shadow week: new priors in parallel, no commit behavior change
3. Enforce when n≥30 and WR lift ≥ 5pp vs baseline
4. Rollback via `strategy_config_hash` already pinned at commit

---

## Are we too tight?

**Yes, but not uniformly.**

| Rail | Too tight? | Evidence | Safe loosen |
|------|------------|----------|-------------|
| **FLOW seats (48)** | No | Only ~8–9 qualify/cycle; cap not binding | — |
| **FLOW gates ($200k gross, dominance)** | Maybe slightly | Quiet days starve pool | Market-state weight, not gross cut |
| **BREAKOUT floor (70→65)** | Yes | 4 names in 65–69 band on Aug 3 | **Shipped: 65** |
| **BREAKOUT chain-walk** | Yes (structural) | 73/80 `no_same_day_contract` | 1DTE fallback, wider walk budget |
| **PIN** | No | 0 clean regimes on trend day | Wait for range day |
| **Commit stack** | Yes | 8 candidates → 2 OPEN | Surface rejections in UI; governor portfolio v2 |

**Iron condor:** separate late-window path; Aug 3 had no pin regime so condor lane correctly idle.

---

## UX decompression (Phase 2 UI)

Command Deck should show on inspect:

- Discovery origin + market-state weight applied
- Gate verdict at commit (frozen `entry_context`)
- Confidence history from `zerodte_discovery_events`
- Governor exposure snapshot

Headline stays ticker + peak/realized; reasoning lives one tap deep.
