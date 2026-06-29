# RTH Continuation Plan — CTO Audit 2026-06-29 (resume at market open)

> **When:** next **RTH session** (09:30–16:00 ET). **Prerequisite:** deploys for #15–#18 live on prod.
> **Type:** read-only audit + live browser/API probes unless approvals in `00-METHOD-SAFETY.md` granted.

## 0. Pre-flight (5 min)
- [ ] Confirm `main` deploy green on Railway (`blackout-web` + cron services).
- [ ] Re-run cross-tool GEX check: `/api/market/spx/desk` vs `/api/market/gex-positioning?ticker=SPX` — close F-1 if aligned.
- [ ] Re-run cold flows TTFB: `/api/market/flows` — expect <1s cold post-#15.

## 1. Phase 1 completion — numerical ground truth (RTH)
- [ ] Full per-screen matrix: every user-visible number on SPX desk, Grid, Heat Maps, HELIX, Night's Watch, track-record — trace to cache key or DB row.
- [ ] Freshness honesty: `FreshnessChip` / stale badges during a deliberate cache miss (no false "Live").
- [ ] SPX play open path: does `openPlay()` fire during RTH? (F-2 / P2-C) — trace logs + `spx_open_play` row count.
- [ ] Options-socket: confirm leader-election (#12) — no climbing `failures=` counter during RTH.

## 2. Phase 9 — frontend live-update (browser)
- [ ] Dashboard load: no React #418 in console (post-#17).
- [ ] Clerk: no CSP worker violations (post-#16).
- [ ] Measure LCP/INP on authed `/dashboard` and `/grid` — quantify PF-3 polling + PF-4 CSS payload.

## 3. Phase 2 — per-tool deep audits (priority order)
1. **SPX Slayer / desk** — F-2 play ledger, commentary rail, signal engine.
2. **HELIX / flows** — tape freshness, enrichment annotations warm-only.
3. **Heat Maps** — matrix warm cron cadence vs 20s TTL (P-2 cold-build tail).
4. **Night's Watch** — valuation path (needs synthetic TEST position approval).
5. **Largo** — grounding adversarial (needs AI-spend approval).
6. **Grid** — panel-by-panel live vs stale.

## 4. Phase 5 / 8 — infra + cross-service wiring
- [ ] `market-regime-detector` cron still unprovisioned? (P1-A — operator Railway step).
- [ ] Redis direct read (operator URL) — eviction / hot-key health.
- [ ] PG pool saturation under concurrent desk + flows load.

## 5. Phase 11 — security re-verify
- [ ] Premium route gating spot-check (#6 class): `/api/market/spx/pulse`, `/api/signals/open`, tool routes → 401 unauthenticated.
- [ ] Fail-closed cron POST guards still hold when `CRON_SECRET` present.

## 6. Deliverables on resume
- Update `00-EXECUTIVE-SUMMARY.md` with final grade + closed/open list.
- Add `99-REMEDIATION-ROADMAP.md` ranked by Truth > Reliability > Security.
- Either merge PR #14 as final audit snapshot or close and open a fresh `audit/20260630-rth` branch.

## Estimated scope
Phases 1-complete + 2 (6 tools) + 9 + 5/8/11 partial ≈ one focused RTH session + one follow-up pass for Largo/NW write tests.
