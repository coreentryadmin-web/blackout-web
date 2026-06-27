# BlackOut Open Issues Log
Last updated: 2026-06-27 12:13 ET

> 12:13 run (Saturday, market closed): **1 NET-NEW P1 (P1-A)** — regime + flow-anomaly features
> are dead end-to-end (no writer cron exists; the "market-regime-detector cron" named in code
> doesn't exist) yet have LIVE consumers: FlowAnomalyBanner on the paid /flows page +
> nighthawk-morning-confirm via /api/platform/intel. Prior runs only caught the auth-gap angle
> (P2-A); this run traced the missing writers + live consumers. Carried items re-verified:
> tsc 0 errors, db/redis safety intact, veto neutered, #97/#100/#101/#102 fixed, all Railway
> services Online. P2-C SPX ledger stays WATCH pending Monday 2026-06-29 post-RTH re-query.

> 08:20 run: full re-audit from scratch — NO new issues, NO regressions. Every item below
> re-verified live this run (SPX ledger still 0/0 & veto confirmed neutered + `SPX_OPTION_CHAIN_REQUIRED`
> not set in env; anomalies/regime still 200 unauthenticated; `tsc` 0 errors; all Railway services Online;
> `UW_API_KEY` set). P2-C stays WATCH pending Monday 2026-06-29 post-RTH re-query.

> Master running list of unfixed findings from the deep-platform-audit cron (every 4h).
> P0 = user-facing breakage/data integrity · P1 = feature broken/degraded · P2 = wrong but not visible · P3 = tech debt / tooling.

## 🔴 P0 — none open

## 🟠 P1 — open
- [ ] **P1-A** Regime + flow-anomaly features dead end-to-end, but with LIVE consumers.
  `market_regime` and `flow_anomalies` have **no writer anywhere** — only INSERTs are the
  cron-gated POST handlers of their own routes (`market/regime/route.ts:53`,
  `market/anomalies/route.ts:46`), and nothing calls those POSTs. The "market-regime-detector
  cron" named in `regime/route.ts:2` does **not exist** (no `src/app/api/cron/` route, no Railway
  cron job — confirmed in `railway status`). Tables created only in `migrations/004_god_tier_features.sql`.
  **Live consumers that silently degrade:** (1) `FlowAnomalyBanner` is mounted on the paid
  `/flows` page (`src/app/(site)/flows/page.tsx:41`; fetch at `FlowAnomalyBanner.tsx:59`) → banner
  can never render; (2) `nighthawk-morning-confirm` cron reads regime+anomalies via
  `/api/platform/intel` (`cron/nighthawk-morning-confirm/route.ts:110`), which defaults
  `currentRegime="UNKNOWN"`/0 anomalies forever (`platform/intel/route.ts:72,89`) → NH morning
  confirm runs with blank regime context. Violates "values live/correct/grounded, never blank".
  **Fix:** build the detector cron writers (or POST callers), OR remove the dead consumers if the
  features are abandoned. _(found 2026-06-27 12:13 — supersedes the auth-only framing of P2-A for
  these two tables; P2-A remains for the anomalies auth-boundary specifically)_

## 🟡 P2 — open
- [ ] **P2-C ⏳ WATCH** SPX play ledger empty all-time (`spx_open_play`=0, `spx_play_outcomes`=0, verified live in prod). **Most likely EXPECTED, not a bug:** the fetch-bug fix `6f00a5e` ("query SPX chain root + don't let chain gate veto entry") merged **2026-06-26 16:20 ET, ~20 min AFTER Friday's RTH close** — so Friday ran the OLD code and NO trading session has run with the fix. Veto confirmed disabled (`spx-play-config.ts:404`); diagnostic tracing already committed (`63567cb`); cron path correctly wired (`spx-evaluator.ts:41` → `evaluateSpxPlay({mutate:true})`). **VERIFY Mon 2026-06-29 after RTH:** re-query prod `spx_open_play` (should get rows) + `spx_play_outcomes` (populates on close). IF still 0 after Monday's full session → escalate to P1 and read the `63567cb` diagnostic logs for the rejecting entry gate. Do NOT re-touch the veto. _(found 2026-06-27 07:10; corrected down from a too-strong P1 after git-timing check)_
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
