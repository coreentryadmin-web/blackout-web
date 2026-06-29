# BlackOut Open Issues Log
Last updated: 2026-06-29 18:35 ET


> **29 Jun 2026 RTH verification — platform GREEN, no open code bugs.** Full audit + hardening
> pass on `main` after operator provisioned `Market-Regime-Detector`. All previously logged P1/P2
> code issues verified fixed or closed this session. Remaining items are **operator config outside
> repo** (audit SKILL.md paths) or **intentional deferred cleanup** (dead scaffold tables in prod
> until migration 005 is applied).


## ✅ Closed this session (2026-06-29)

| ID | Issue | Resolution |
|---|---|---|
| **P1-A** | Market-Regime-Detector cron not provisioned | **CLOSED** — Railway service live; runs every 5m; writes `market_regime` + `flow_anomalies` (verified 18:20 + 18:25 UTC runs, live API fresh) |
| **P1-B** | `/api/signals/open` unauthenticated | **CLOSED** — `isCronAuthorized` at `signals/open/route.ts:15` |
| **P2-C** | SPX play ledger empty / 0 BUY | **CLOSED** — Mon RTH: `spx-evaluate` logged `play_action=BUY` A+ @ 18:25 UTC; engine `ALL GATES PASSED — opening play`; track record shows closed trades |
| **P2-D** | Options-socket off-hours 1006 loop | **CLOSED** — RTH logs: connected/authenticated, zero reconnect churn |
| **P2 regime fail-open** | Cron POST guards | **CLOSED** — all 5 writers fail-closed |
| **P2 grid overpromise** | News/Flow panels missing | **CLOSED** — `GridNewsPanel` + `GridFlowPanel` in `GridBoard` |
| **P0 admin leaks** | `debug-uw`, `run-migration` weak guards | **CLOSED** — PR #27 merged; `requireAdminApi()` |
| **P2 public probe leaks** | health/ready/engine expose vendor/DB errors | **CLOSED** — generic responses; engine/health admin-gated |
| **P2 API provider leaks** | Routes named Polygon/UW/Anthropic in JSON | **CLOSED** — scrubbed to neutral labels |
| **P2 uw-socket off-hours churn** | Stall watchdog not RTH-gated | **CLOSED** — mirrors options-socket gate |
| **P3 migration bug** | `005_drop_dead_tables.sql` dropped live `spx_signal_log` | **CLOSED** — migration trimmed to scaffold tables only |

## 🔵 Remaining (non-code / deferred)

- **P3-META** — Scheduled audit `SKILL.md` stale probe paths/env names. File lives outside this repo; fix in the audit task config to stop false P0/P1 noise.
- **P3-2 scaffold tables** — `spx_pulse_snapshots`, `spx_watch_setups` still in prod until an operator runs `005_drop_dead_tables.sql` (safe — zero readers/writers in `src/`).
- **UI vendor names** — Some learn/marketing copy still references provider names in prose (not API JSON). Low priority; not a data-integrity bug.

## Verified GREEN (2026-06-29)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm test` | 402/402 pass |
| `npm run lint:brand` | pass |
| `npm run build` | pass |
| Regime cron | 200, writing live snapshots |
| SPX play engine | BUY approved Mon RTH |
| Options + UW sockets | RTH-gated, no off-hours storm |
| Auth on paid/admin routes | spot-checked all 110 API routes |
