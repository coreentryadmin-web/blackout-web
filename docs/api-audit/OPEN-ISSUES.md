# BlackOut Open Issues Log
Last updated: 2026-06-27 07:10 ET

> Master running list of unfixed findings from the deep-platform-audit cron (every 4h).
> P0 = user-facing breakage/data integrity · P1 = feature broken/degraded · P2 = wrong but not visible · P3 = tech debt / tooling.

## 🔴 P0 — none open

## 🟠 P1 — open
- [ ] **P1-A** SPX play ledger empty all-time → Track Record / P&L panels render empty on the LIVE SPX Slayer product. `spx_open_play` = 0 rows, `spx_play_outcomes` = 0 rows (verified live in prod Postgres). The option-chain veto is correctly disabled (`SPX_OPTION_CHAIN_REQUIRED` unset, `playOptionChainRequired()` defaults false at `spx-play-config.ts:404`) so the veto is NOT the cause. The cron `SPX-Engine-Evaluation` (`*/5 11-20 * * 1-5`, Online) calls `evaluateSpxPlay({mutate:true})` (`spx-evaluator.ts:41`) + records heartbeats every tick, but the "ALL GATES PASSED → openPlay" branch (`spx-play-engine.ts:833` → `openPlay()` → INSERT `db.ts:1242`) is never reached. **Root cause is an upstream entry gate (confluence grade / Claude approval / `entryGatesRaw.passed`) above `spx-play-engine.ts:775` rejecting every candidate.** `db.ts:1462` already documents this "empty-ledger bug" condition. NEXT: instrument the entry-gate decision in the cron path for one RTH session to name the rejecting gate. Do NOT re-touch the veto. _(found 2026-06-27 07:10 — supersedes the "veto fixed" note; opens still broken, cause moved upstream)_

## 🟡 P2 — open
- [ ] **P2-A** `/api/market/anomalies` (→200 `{"anomalies":[]}`) and `/api/market/regime` (→200 `{"available":false}`) serve unauthenticated, while sibling market routes 401. `middleware.ts` documents that API routes must self-authorize — these two lack a guard. No paid-data leak today (both empty) but they'd leak once they return real payloads. Add the sibling `requireToolApi`/entitlement guard or annotate as intentionally public. Files: `src/app/api/market/anomalies/route.ts`, `src/app/api/market/regime/route.ts`. _(found 2026-06-27 07:10)_
- [ ] **P2-B** `spx_signal_log` last wrote 2026-06-17 (stale 10 days). If any admin/analytics surface still reads it, it serves stale signals. Confirm superseded by the play engine; resume writes or retire table + readers. _(found 2026-06-27 07:10)_

## 🔵 P3 — open (tech debt / tooling)
- [ ] **P3-1** deep-platform-audit `SKILL.md` produces false P0/P1 every run: stale probe paths (`/api/market/spx-pulse`→`/api/market/spx/pulse`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk/edition`, `/api/grid/news`→none), wrong env-var names (`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`), and a db-handler regex (`pool\.on`) that misses the real `livePool.on("error")` (`db.ts:113`). Fix the SKILL's probe lists. _(found 2026-06-27 00:12, reconfirmed 07:10)_
- [ ] **P3-2** `spx_pulse_snapshots` and `spx_watch_setups` exist in prod with 0 rows all-time and **zero INSERT code references** in `src/` → dead/legacy tables. Drop them or wire the intended writers. _(found 2026-06-27 07:10)_

## ✅ Recently confirmed FIXED
- **P2-1 (was open 00:12)** 7 TS errors in WIP `platform/intel` + sibling routes — RESOLVED: real `tsc --noEmit` now 0 errors, files committed, `git status` clean (verified 07:10)
- **P2-2 / #97 (was open 00:12)** `SpxDarkPoolCard` — RESOLVED: now imported + mounted at `SpxDashboard.tsx:13,86` (verified 07:10)
- **#100** pg Pool idle-error handler — `db.ts:113`
- **#101** Clerk `user.created` webhook — `webhook/clerk/route.ts:77`
- **#102** Polygon WS leader election — `ws/polygon-socket.ts:117-148`
- **#73** Largo SPX grounding tools present — `largo/{spx-desk-cache,tool-defs,run-tool}.ts`
- SPX option-chain veto neutered — `spx-play-config.ts:404`
- Redis IPv6 `family: 0` — `make-redis.ts:58`
