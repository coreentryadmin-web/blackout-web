# BlackOut Open Issues Log
Last updated: 2026-06-29 20:38 ET (2026-06-30 03:38 UTC)

> **20:38 ET / 03:38 UTC run (Mon, after-hours, RTH closed; live data via apex+Bearer + code read). 0 P0 · 1 P1 · 1 P2.**
> - **[OPEN · 🟠 P1 · DATA INTEGRITY · re-confirmed in code]** **Play outcomes mislabel profitable exits as losses.**
>   `src/lib/spx-play-outcomes.ts:177-178` returns `"loss"` for ANY `STOP`/`THESIS`/`was_loss` exit **without checking
>   `pnl_pts` sign** — the THETA/SESSION (`:170-175`) and TRAIL (`:183-186`) branches both check it correctly. A profitable
>   THESIS exit is stored `outcome='loss'`; understates win-rate on the track-record/P&L surfaces. **Fix:** for STOP/THESIS,
>   `pnl_pts > 0` → win (mirror TRAIL). One-liner. *(Carried from 16:46 run; still present.)*
> - **[OPEN · P2 · cosmetic]** `/api/market/spx/pulse` returns `available:false`/`price:0` after-hours while `spx/desk`
>   has full live data. Likely the RTH-only indices-WS poller idling by design — verify `pulse` populates during next RTH
>   (13:30–20:00 UTC); confirm desk UI shows "market closed" not zeros.
> - **[✅ CONFIRMED HEALTHY this run]** All core data live+fresh (gex SPY 741 ~2min · spx/desk SPX 7440.43 · flows · dark-pool ·
>   nighthawk edition published 02:31 BULLISH · all 8 grid panels `available:true`) · TSC 0 errors · all 7 prod env vars SET ·
>   #97/#100/#101/#102 fixed (verified in code) · Redis family:0 · SPX plays opening (3 last RTH).
> - **[P3-META — fix the SKILL]** Audit script's own paths are stale and manufacture false P0s every run: `/api/flows`→
>   `market/flows`, `spx-pulse`→`market/spx/pulse`, `grid/news`=nonexistent (→`market/news`), `nighthawk/latest-edition`→
>   `market/nighthawk/edition`; Phase-1 hits `www` (301→apex strips Bearer→401/404) not apex+Bearer; GEX-vs-desk wall check
>   compares SPY walls (740/750) to SPX walls (~7440) w/o the ~10.04x normalisation; clerk path is `webhooks/clerk` (plural);
>   `UNUSUAL_WHALES_API_KEY` check stale (platform on Massive). Full report: `docs/api-audit/deep-audit-20260629-20.md`.

---

> **16:46 PT / 23:46 UTC run (Mon, post-close; live data sampled via prod PG + apex+Bearer). 0 P0 · 2 P1 · 3 P2.**
> - **[OPEN · 🟠 P1 · NEW · DATA INTEGRITY]** **Play outcomes mislabel profitable exits as losses.**
>   `spx-play-outcomes.ts:177-178` returns `"loss"` for any `STOP`/`THESIS` exit (or `was_loss`) **without checking
>   `pnl_pts` sign** — unlike the THETA/SESSION (`:173-175`) and TRAIL (`:183-186`) branches. **Live proof:** today's
>   play #3 (long, exit_action=THESIS, entry 7432.13 → exit **7439.43**, `pnl_pts=+7.30`) is stored `outcome='loss'`.
>   Today's three A/A+ plays read **0/3 wins; actual is 1/3**. Understates win-rate; shows a winning trade as a loss on
>   track-record/P&L surfaces. **Fix:** treat `pnl_pts > 0` STOP/THESIS exits as wins (mirror the TRAIL branch).
> - **[OPEN · 🟠 P1 · still dormant]** **Signal pipeline empty** — prod `signal_events=0`, `signal_outcomes=0` (verified).
>   Schema present, recorder still inert (pending entry/exit schema decision). Learning loop dormant; "signal panel
>   populates" verification NOT met. Decide schema + wire recorder, or de-scope the panel.
> - **[OPEN · 🟠 P1 · carried]** `DISCORD_OPS_WEBHOOK_URL` unset (escalation gap) + unpushed-commits-on-`main` backlog
>   — carried from 15:09/11:19 runs, not re-sampled this run; operator action still pending.
> - **[P2]** (a) today's 3 plays all-long/all-stopped/2-never-green — watch entry-timing next RTH; (b) SPX pulse blank
>   post-close (`available:false`, price 0) — confirm desk UI shows "market closed" not zeros; (c) GEX TTFB ~1.7s on a
>   Cloudflare HIT — minor perf.
> - **[✅ CONFIRMED RESOLVED]** SPX plays open+close (3 today, full lifecycle) · #97/#100/#101/#102 · Redis family:0 ·
>   db Pool handler `:113` max:5 · GEX live+correct (short-gamma read right) · HELIX tape fresh (1,987/24h).
> - **[P3-META — fix the SKILL]** Phase-1 paths stale (`spx-pulse`→`market/spx/pulse`, `flows`→`market/flows`,
>   `grid/news`=nonexistent, `nighthawk/latest-edition`→`nighthawk`); uses `www` (strips auth→401) not apex+Bearer;
>   `Invoke-WebRequest` latency bogus (44-59s vs <2s curl on CF HIT); Clerk check reads alias stub; #73 greps wrong
>   `src/lib/tools` (real: `src/lib/largo/`). Full report: `docs/api-audit/deep-audit-20260629-16.md`.

---

> **15:09 ET run (Mon, mid-RTH, market open; live data sampled via prod PG). ✅ BOTH prior P0s RESOLVED this run.**
> - **[✅ RESOLVED · was 🔴 P0]** **Five RTH writer crons recovered.** `flow-ingest` (13.9m, status `skipped`=no-new-data),
>   `uw-cache-refresh` (13.0m), `nights-watch-warm` (12.0m), `heatmap-warm` (12.7m), `grid-warm` (13.7m) — all back on
>   schedule (≤14m ages) vs ~455m dead at 11:19. `data-correctness` 11.1m, `spx-evaluate` 6.9m. Whatever stalled them
>   after the ~07:41 UTC restart has cleared. **`market-regime-detector` now RUNNING (6.9m)** — was "absent" at 04:xx. Resolved.
> - **[✅ RESOLVED · was 🔴 P0 (longstanding)]** **SPX plays are OPENING — first time ever.** Prod: `spx_open_play=3`,
>   `spx_play_outcomes=3`, `spx_signal_log=2`; `flow_alerts` last 30m = **113**. Exactly the 11:19 prediction once
>   flow-ingest restored on a clean-tape window. `project_spx_plays_never_open` closed.
> - **[OPEN · 🟠 P1 · operational]** **`DISCORD_OPS_WEBHOOK_URL` still UNSET** — this is WHY the 7.6h writer outage went
>   un-paged. Watchdog detects but `alert_delivered:false`; failure-Discord can't fire. Operator: set webhook / enable self-heal.
> - **[OPEN · 🟠 P1 · deploy gap]** **27 unpushed commits on `main`** (was 11 @04:xx) — fixes incl. signal-analytics 500 fix
>   are LOCAL only, NOT in prod. By-design (cron-no-push) but widening; operator must review + `git push origin main`.
> - **[OPEN · P2 · copy]** Grid overpromise: `(site)/grid/page.tsx:13`+`:35` advertise "News, flow" panels not in the real
>   set (analysts/catalysts/congress/dark-pool/earnings/economy/movers/sectors). Wire the panels or fix the copy.
> - **[GREEN]** tsc=0 · #97/#100/#101/#102 + veto FIXED · db Pool handler (`db.ts:113`,max:5) · redis family:0+reconnect ·
>   blackout-web Online 5/5 · logs clean · all secrets set (incl. **VAPID + CF_API_TOKEN now SET** — re-verify push alerts live) ·
>   Landing/auth/health 200, data endpoints correctly 401.
> - **[P3-META — STILL UNFIXED]** audit SKILL.md false positives (stale paths `spx-pulse`/`flows`/`nighthawk-latest-edition`/
>   `grid-news`; wrong env `UNUSUAL_WHALES_API_KEY` vs real `UW_API_KEY`; singular `webhook/clerk` vs real plural `webhooks/clerk`;
>   auth-grep misses `requireTierApi`/`authorizeCronOrTierApi`; SpxDarkPoolCard IS mounted). Fix the script.
>   Full report: `docs/api-audit/deep-audit-20260629-12.md`.

---

> **11:19 ET run (Mon, mid-morning RTH — first RTH-window run today; live data now sampleable via prod PG).**
> **This is the RTH verification the 04:xx run queued — and it found a live, ongoing P0 outage.**
> - **[OPEN · 🔴 P0 · NEW]** **Five RTH data-writer crons DEAD ~7.6 h during the session** — `flow-ingest`,
>   `uw-cache-refresh`, `nights-watch-warm`, `heatmap-warm`, `grid-warm` last ran 07:41 UTC (deploy/boot run,
>   outside their `*/2`/`*` 11-21 schedule); ZERO runs in today's RTH window. Confirmed by `cron_job_runs`
>   ages (~455 min) AND the platform's own `data-correctness` cron @14:37 ("Critical writer … STALE during RTH").
>   All five tomls have `restartPolicyType="never"` → dead = stays dead. **Mitigate now (no push):**
>   `node scripts/hit-cron.mjs /api/cron/flow-ingest` (+ the other four). Durable: investigate why those
>   Railway trigger services stopped scheduling after the ~07:41 UTC restart.
> - **[OPEN · 🔴 P0 · escalation gap]** Staleness watchdog DETECTS all five (`rth_stale_keys`, 8 problems @15:00 UTC)
>   but `alert_delivered:false` + `self_heal_enabled:false`, and logs status `"ok"` so `cron-run.ts:38`'s
>   failure-Discord never fires either. **Same root as the 00:14/04:xx finding: `DISCORD_OPS_WEBHOOK_URL` unset.**
>   Net: multi-hour live-data outage with ZERO human notification. Operator: set webhook AND/OR enable self-heal.
> - **[RESOLVED the "VERIFY Mon RTH" item — but NOT how expected]** SPX plays STILL never open
>   (`spx_open_play`/`spx_play_outcomes`/`spx_signal_log` = 0 rows ever). The veto is NOT the cause — it's
>   correctly disabled (`spx-play-config.ts:417` default false; `SPX_OPTION_CHAIN_REQUIRED` unset). Engine is
>   healthy (52 evals/24h, 0 fail) but stuck `SCANNING` grade C/D on "mixed tape" + **"Flow data stale (11m)"** —
>   i.e. **downstream of the P0 dead-writer outage.** Re-verify play opens AFTER flow-ingest is restored on a clean-tape window.
> - **[OPEN · P1 · likely downstream]** Cross-provider GEX divergence (`data-correctness`): SPX net-GEX sign vs
>   UW; SPX King 7,300 vs UW King 7,425 (Δ1.69%). Consistent with stale `heatmap-warm` cache; re-check after P0-1 fix.
> - **[GREEN re-verified this RTH run]** tsc=0 · #97/#100/#101/#102 + veto all FIXED · db Pool handler (`db.ts:113`) ·
>   redis family:0+reconnect · blackout-web Online 5/5 · Postgres/Redis Online · all core secrets set ·
>   Landing/auth/health 200, data endpoints correctly 401.
> - **[P3-META — STILL UNFIXED]** audit SKILL.md emits false positives (stale paths `spx-pulse`/`flows`/
>   `nighthawk-latest-edition`/`grid-news`; wrong env `UNUSUAL_WHALES_API_KEY`; auth-grep misses
>   `requireTierApi`/`authorizeCronOrTierApi`/`isCronAuthorized`). Fix the script. Full report:
>   `docs/api-audit/deep-audit-20260629-08.md`.

---

> **04:xx ET run (Mon, pre-RTH, markets closed).** Live data 401-gated + closed → not sampleable;
> value from code + Railway + git deploy-state. **Platform code/runtime is GREEN; open risk is OPERATIONAL.**
> - **[OPEN · P1 · DEPLOY GAP]** `git rev-list origin/main..HEAD = 11` — real fixes committed LOCAL but
>   UNPUSHED, incl. `ffbed27` signal-analytics 500 fix → **that 500 is STILL live in prod** until pushed.
>   By-design under cron-no-push, but operator must review + `git push origin main` to actually deploy.
> - **[OPEN · P1]** `DISCORD_OPS_WEBHOOK_URL` still **unset** → Cron-Staleness-Watchdog "ALERT NOT
>   DELIVERED", ops blind to cron failures. Operator sets webhook.
> - **[OPEN · P1-A]** `Market-Regime-Detector` cron service still **absent** from Railway → `market_regime`/
>   `flow_anomalies` writers never run. Operator adds the service.
> - **[OPEN · P2]** Grid overpromise: `(site)/grid/page.tsx:35` (+`:13` metadata) advertise "News, flow"
>   panels that don't exist (real set: analysts/catalysts/congress/dark-pool/earnings/economy/movers/sectors).
> - **[RESOLVED in code]** regime now fails CLOSED (`market/regime/route.ts:47`); signal-analytics column
>   fixed (`gates_blocked_json`, awaiting push per deploy gap above).
> - **[VERIFY Mon 06-29 RTH]** P2-C SPX play opens (veto now conditional, openPlay reachable) · P2-D
>   options-socket 1006 · cross-tool GEX/pulse consistency.
> - **[GREEN re-verified]** tsc=0 · #73/#97/#100/#101/#102 resolved · db Pool error handler (`db.ts:113`,max:5) ·
>   redis family:0+reconnect · blackout-web Online 5/5 · all core secrets SET (UW_API_KEY, not the
>   audit's mythical UNUSUAL_WHALES_API_KEY).
> - **[P3-META]** audit SKILL.md STILL emits false positives (stale paths spx-pulse/flows/nighthawk-latest-edition/
>   grid-news; wrong env name; `src/lib/tools` vs `src/lib/largo`). Fix the script. Full report:
>   `docs/api-audit/deep-audit-20260629-04.md`.


> **00:14 ET run (Mon, pre-RTH, markets closed).** Live data endpoints all 401-gated +
> markets closed → freshness/consistency not sampleable; value came from Railway logs + code + infra.
> **TWO net-new findings prior runs missed + one correction:**
> - **[FIXED this run, local]** **P1** `/api/admin/signal-analytics` 500 — `column o.gates_blocked does not exist`.
>   Column is `gates_blocked_json` (`spx-signal-db.ts:28`) but both queries used `o.gates_blocked`
>   (`route.ts:197,199,200` and `:263`). Renamed to `gates_blocked_json` (+`AS gates_blocked` alias on :263). Caught via live Railway log.
> - **[OPEN]** **P1** `DISCORD_OPS_WEBHOOK_URL` **unset** in Railway → Cron-Staleness-Watchdog
>   "ALERT NOT DELIVERED" — ops blind to cron failures. Operator must set the webhook. (Watchdog
>   flagged "3 stale crons" at 07:14 UTC but that's pre-RTH off-hours; verify at next RTH window.)
> - **[RETRACTED — false positive]** ~~VAPID public key unset~~. The code reads
>   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (not `VAPID_PUBLIC_KEY`) and it IS set (with
>   `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`GEX_ALERTS_PUSH`). Push is LIVE; the 06-28 run was correct.
>   Auditor hit the same env-name trap as P3-META — always grep `process.env.*NAME*` before asserting "unset."
>
> **Carried opens re-confirmed:** **P1-A** `Market-Regime-Detector` cron service still absent from
> Railway service list. **P2 grid-overpromise** (subtitle promises News/flow; no such panel).
> **P2-C** SPX play opens + **P2-D** options-socket 1006 → verify at **Mon 06-29 RTH**.
> **P3-META** audit SKILL.md still emits false positives (stale paths, wrong UW env name, narrow greps) — fix it.
> **Possibly RESOLVED:** P2 regime-fail-open — `regime/route.ts:45-49` now fails CLOSED on bad cron auth (re-confirm).
> **Re-verified GREEN:** tsc=0, db Pool error handler+max:1, redis family+reconnect, plays-veto opt-in,
> #73/#97/#100/#101/#102 resolved, blackout-web Online 5/5, Postgres+Redis Online, UW_API_KEY +
> CF_API_TOKEN/ZONE_ID + all core secrets present. Full report: `docs/api-audit/deep-audit-20260629-00.md`.


> 20:09 ET run (Sunday, market closed): **No net-new user-facing breakage. Platform GREEN on
> everything sampleable.** All findings are RE-CONFIRMATIONS of carried opens — no regressions
> since 16:12. **Carried opens (unchanged):** **P1-A** `Market-Regime-Detector` cron service still
> not provisioned → `market_regime`/`flow_anomalies` writers never run (operator-only Railway
> "add service" step; not re-enumerated this run, market closed). **P2 regime-fail-open**
> re-confirmed in code (`market/regime/route.ts:48` `if (cronSecret && …)` skips the guard when
> `CRON_SECRET` unset → public INSERT into `market_regime`; dormant, secret present; should fail
> CLOSED). **P2 grid-overpromise** re-confirmed (`(site)/grid/page.tsx:35` subtitle "News, flow,
> analyst actions…" but no News/Flow panel exists; grid fetches analysts/catalysts/congress/
> dark-pool/earnings/economy/movers/sectors only). **P2-C** SPX play opens + **P2-D** options-socket
> 1006 loop both carry to **Mon 06-29 RTH** (not sampleable). **P3-META** audit SKILL.md still emits
> systematic false positives (stale paths `spx-pulse`/`flows`/`nighthawk-latest-edition`/`grid/news`;
> wrong env name `UNUSUAL_WHALES_API_KEY` vs real `UW_API_KEY` which IS present; stale greps miss
> `livePool.on`, mounted `SpxDarkPoolCard`, plural `webhooks/clerk`, Polygon WS SETNX leader) —
> correct it. **Re-verified GREEN:** tsc=0, db Pool error handler(`db.ts:113`)+max:5, redis
> family:0+reconnectOnError, plays-veto opt-in (`SPX_OPTION_CHAIN_REQUIRED` NOT set in prod →
> plays open w/ fallback), #97/#100/#101/#102 all resolved, blackout-web Online 5/5, all secrets
> present (incl VAPID_PRIVATE_KEY → gex-alerts no longer inert), 19 TODOs no real stubs. Full
> report: `docs/api-audit/deep-audit-20260628-20.md`.


> 16:12 ET run (Sunday, market closed): **No net-new user-facing breakage. Platform GREEN on
> everything sampleable.** **P1-A STILL OPEN (re-confirmed `railway status`):** the 13 live cron
> jobs do NOT include `Market-Regime-Detector` → `market_regime`/`flow_anomalies` writers never
> run; needs the manual Railway "add service (Config-as-code)" step (deploy-risky, operator-only).
> **NEW P2 — regime POST fails open:** `src/app/api/market/regime/route.ts:48` guards the DB-write
> POST with `if (cronSecret && auth !== Bearer …)` — if `CRON_SECRET` is ever unset the guard is
> SKIPPED and `market_regime` becomes a public injection endpoint. Dormant (CRON_SECRET present)
> but should fail CLOSED. **NEW P2 — Grid over-promises:** `/grid` metadata+subtitle advertise
> "News · Flow" panels that don't exist (`grid/page.tsx:13,35`; no `/api/grid/news` route, no
> news/flow panel fetched) — wire them or fix the copy. **P2-C** SPX play opens + **P2-D**
> options-socket `code=1006` loop (not re-sampled, market closed) both carry to **Mon 06-29 RTH**.
> **P3-META re-confirmed:** audit SKILL.md still uses stale paths (`spx-pulse`→`spx/pulse`,
> `/api/flows`→`market/flows`, `nighthawk/latest-edition`→`market/nighthawk/edition`,
> `grid/news` nonexistent) + wrong env name (`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`, which IS
> present) → systematic false positives; correct it. Re-verified GREEN: tsc source-clean (3 errors
> are stale `.next/types` learn/layout cache only), db Pool error handler (`db.ts:79,113`)+max:5,
> redis family:0+reconnectOnError, 1 TODO total, #97/#100/#101/#102 all resolved, plays-veto now
> opt-in (`SPX_OPTION_CHAIN_REQUIRED` defaults false), blackout-web Online 5/5 + Postgres/Redis
> Online + all crons scheduled + all required secrets present. Full report:
> `docs/api-audit/deep-audit-20260628-16.md`.


> 12:23 ET run (Sunday, market closed): **No net-new issues. Platform GREEN on everything
> sampleable.** **P1-B re-verified STILL CLOSED:** `GET /api/signals/open` → **401**. **P1-A
> STILL OPEN (re-confirmed `railway status`):** no `Market-Regime-Detector` among the 13 live cron
> services → `market_regime`/`flow_anomalies` writers never run; needs manual Railway "add service
> (Config-as-code)" step (deploy-risky, operator-only). **P2-D STILL OPEN (re-confirmed live
> logs):** `options-socket` shard 0 in `code=1006` reconnect loop, `failures=77` (was 531 @04:08 —
> redeploy reset the counter, loop pattern unchanged: `connected (2 contracts)`→`1006 reconnect`
> every 60s). Benign off-hours; **re-check after 09:30 ET Mon 06-29** — climbing `failures` →
> promote to P1 (Night's Watch valuations degrade); fix = gate reconnect/heartbeat on options-RTH
> (`src/lib/ws/options-socket.ts:453-457`). **P2-C** SPX play opens carries to Mon RTH. **P3-META
> (re-confirmed):** audit SKILL.md still has stale paths (`spx-pulse`→`spx/pulse`,
> `flows`→`market/flows`, `nighthawk/latest-edition`→`market/nighthawk/edition`,
> `grid/news`→`market/news`) + bad regexes (`livePool.on`, plural `webhooks/clerk`,
> `Select-String -Recurse` invalid) → systematic false positives; correct it. Re-verified GREEN:
> tsc=0, db Pool error handler+max:5, redis family:0+reconnect, 0 real TODO/FIXME, #73/#97/#100/
> #101/#102 all resolved, blackout-web Online 5/5 + Postgres/Redis Online + 13 crons Online/
> Completed + 0 deploy-log errors. Full report: `docs/api-audit/deep-audit-20260628-12.md`.


> 08:13 ET run (Sunday, market closed): **P1-B FIXED IN THIS RUN.** The unauthenticated
> paid-signal leak `/api/signals/open` (200 → up to 500 `signal_events` rows incl.
> grade/ticker/strike/expiry/option_type/entry_mark/confluence_score) is now gated behind
> `isCronAuthorized` (`signals/open/route.ts:8-16`). Verified orphaned first (grep: no consumer,
> cited `signal-outcome-tracker` cron doesn't exist), so lockdown breaks nothing; `tsc`=0 after
> edit; deploys on this commit. **✅ DEPLOY VERIFIED LIVE:** post-deploy `GET /api/signals/open`
> → **401** confirmed (was 200) — P1-B closed end-to-end. **P1-A STILL OPEN
> (re-confirmed via `railway status`):** no `Market-Regime-Detector` service among the 13 live
> cron services → `market_regime`/`flow_anomalies` writers never run. `.toml`+code exist;
> needs the manual Railway "add service (Config-as-code)" step — left for operator (deploy-risky
> infra, not auto-created by audit). **P2-C** SPX play opens + **P2-D** options-socket code=1006
> loop both carry to **Mon 2026-06-29 RTH** (not sampleable market-closed). **NEW P3-META:** the
> audit skill's own PowerShell checks throw systematic FALSE POSITIVES — stale endpoint paths
> (`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `grid/news` nonexistent) and auth/handler
> regexes that miss real names (`livePool.on`, `authorizeCronOrTierApi`, `requireTierApi`,
> `webhooks/clerk` plural). SKILL.md should be corrected. Re-verified GREEN: site 200s + correct
> 401s on all tool/admin endpoints, tsc 0, db Pool error handler (`db.ts:113`)+max:5, redis
> family:0+reconnect, SPX veto neutered + `openPlay()` reached, #97/#100/#101/#102 fixed,
> blackout-web Online 5/5 + Postgres/Redis Online + all 13 crons Online/Completed.
> Full report: `docs/api-audit/deep-audit-20260628-08.md`.


> 04:08 ET run (Sunday, market closed): **1 NET-NEW P2** + both standing P1s re-confirmed open.
> **NEW P2 — options-socket shard 0 stuck in a code=1006 reconnect loop (`failures=531`).** Live
> `blackout-web` logs cycle every 60s: `connected (1 contracts)` → `reconnect in 60000ms
> (code=1006, failures=531)`. `consecutiveFailures` resets only on successful auth
> (`src/lib/ws/options-socket.ts:405-406`), so 531 = no sustained authed stream in ~8h. Closes are
> **server-initiated 1006**, not the stall watchdog (which already gates off-hours, `:453-457`).
> Benign now (market closed, `MAX_CONNECTIONS=1` slot just churning + log noise) BUT the unbounded
> counter masks a real RTH failure. **ACTION: re-check after 09:30 ET Mon** — if `failures` resets
> toward 0 once quotes flow it's cosmetic off-hours churn; if pinned, Night's Watch live valuations
> degrade → promote to P1. Suggested fix: gate `scheduleReconnect`/heartbeat on options-RTH like the
> stall watchdog already is. **P1-B STILL OPEN:** `/api/signals/open` → **200 unauthenticated**
> (`{"ok":true,"signals":[]}` now, empty/EOD-scored — but leaks paid SPX_SLAYER/NIGHT_HAWK signals
> during RTH); sibling POST routes correctly 405 on GET. Fix: add `isCronAuthorized` or delete
> (`signals/open/route.ts:8`). **P1-A STILL OPEN:** no `Market-Regime-Detector` service in
> `railway status` (`.toml` exists, never created → `market_regime`/`flow_anomalies` writers never
> run). Re-verified GREEN: site 200s + correct 401s on all tool/admin endpoints, tsc 0 (needs ≥4GB
> heap), db Pool error handler (`db.ts:113`) + pool max:5, redis family:0+reconnect, SPX veto
> neutered (`SPX_OPTION_CHAIN_REQUIRED` unset → defaults false), #97/#100/#101/#102 fixed, VAPID
> fully armed (public+private SET), all required env vars set (note: code uses `UW_API_KEY` not
> `UNUSUAL_WHALES_API_KEY`), all Railway services Online (5/5 replicas), no error logs.
> **P2-C SPX play opens: Monday 2026-06-29 RTH verification still pending.** Full report:
> `docs/api-audit/deep-audit-20260628-04.md`.


> 00:14 run (2026-06-28, Saturday night, market closed): **1 NET-NEW P1 (P1-B)** —
> `/api/signals/open` serves **200 unauthenticated** and returns up to 500 `signal_events`
> rows incl. `grade`/`ticker`/`strike`/`expiry`/`option_type`/`entry_mark`/`confluence_score`
> — i.e. the paid SPX_SLAYER + NIGHT_HAWK signal output. Currently empty live
> (`{"ok":true,"signals":[]}`, market closed/all scored to EOD) but **leaks live signals to
> anyone during RTH**. Distinct from P2-A (those are market-wide/no-paid-data); this one IS
> paid data. No in-repo consumer fetches it and the `signal-outcome-tracker` cron its comment
> cites does not exist → orphaned. Fix: add `isCronAuthorized` (sibling write routes already
> have it) or delete. `signals/open/route.ts:8`. **P3-3 gets a 3rd instance:**
> `track-record/publish/route.ts:9` uses the same fail-open `if (CRON_SECRET && …)` guard.
> Re-verified GREEN: site 200s + correct 401s, tsc 0, db Pool error handler present, redis
> family:0 + retry, SPX veto+open logic both present, #97/#100/#101/#102 confirmed fixed,
> VAPID/GEX-alerts now fully armed (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`+`VAPID_PRIVATE_KEY`+
> `VAPID_SUBJECT`+`GEX_ALERTS_PUSH` all set). Carried unchanged (not re-queryable this run —
> `railway status`/`logs` need `--service` with project token): P1-A, P2-C, P2-B.

> 20:15 run (Saturday, market closed): **P1-A REFINED — effort dropped from "build the writer" to
> "create one Railway service."** The regime/anomaly writer is now fully built in code
> (`cron/market-regime-detector/route.ts` + `cron-registry.ts:217` + `railway.market-regime-detector.toml`),
> but prod ground truth confirms it has **never run**: `market_regime`=0 rows, `flow_anomalies`=0 rows,
> `cron_job_runs[market-regime-detector]`=0 runs/7d, and **no Market-Regime-Detector service exists in
> `railway status`**. The `.toml` exists but the manual "create cron service (Config-as-code)" step was
> never done → both live consumers (FlowAnomalyBanner, NH morning-confirm) still degrade. Also: **P2-A
> now annotated-resolved** (both routes carry explicit "intentionally public" comments — the documented
> fix); concern folds into P1-A. **1 NEW P3-3:** fail-open cron-POST guard (`if (cronSecret && …)` accepts
> when CRON_SECRET unset; set in prod, so defense-in-depth only). Re-verified GREEN live: tsc 0, db/redis
> safety, veto neutered, all required env vars set, all 23 Railway services Online, no log errors. P2-C
> re-verified empty live (`spx_open_play`=0, `spx_play_outcomes`=0; spx-evaluate healthy 333 ok/63 skip/4d)
> — Monday 2026-06-29 verification still pending. P2-B `spx_signal_log` now fully empty (0 rows).

> 16:10 run (Saturday, market closed): **NO net-new issues, NO regressions.** Sharpened P2-C
> with prod ground truth — the SPX engine didn't just fail to *open*, it logged **0 BUY/APPROVE
> over the last 3 active days** (198 SCANNING · 24 WATCHING · 0 BUY in `cron_job_runs`), and two
> fresh gate fixes (`5eee3ff` 6-bug gate audit + `cee2ebf` 0DTE calibration) shipped TODAY while
> market closed → unvalidated until Monday. New positive: **VAPID keys now SET in prod → push
> alerts no longer inert.** Re-verified GREEN: tsc 0, db/redis safety, veto disabled (env-confirmed),
> all required env vars present, #97/#100/#101/#102 fixed, all Railway services Online, only benign
> weekend `skipped` cron rows (no real failures). P1-A, P2-A, P2-B, P3-1, P3-2 all carried unchanged.

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
- [ ] **P1-A** Regime + flow-anomaly features still dead in prod — but writer is BUILT, just unwired.
  **Refined 20:15:** the writer cron now EXISTS in code (`src/app/api/cron/market-regime-detector/route.ts`
  + registry `cron-registry.ts:217` + `railway.market-regime-detector.toml`, schedule `*/5 11-21 * * 1-5`).
  But prod ground truth confirms it has **never run**: `market_regime`=**0 rows**, `flow_anomalies`=**0 rows**,
  `cron_job_runs[market-regime-detector]`=**0 runs/7d**, and **no Market-Regime-Detector service in
  `railway status`** (23 services, not one of them). The `.toml` header says "Wire it up: create a cron
  service → Config-as-code" — that manual Railway step was never done, so nothing hits the route.
  **Live consumers still degrading:** (1) `FlowAnomalyBanner` on paid `/flows` (`src/app/(site)/flows/page.tsx:41`;
  fetch `FlowAnomalyBanner.tsx:59`) → never renders; (2) `nighthawk-morning-confirm` reads via
  `/api/platform/intel` (`cron/nighthawk-morning-confirm/route.ts:110`) → defaults `currentRegime="UNKNOWN"`/0
  anomalies (`platform/intel/route.ts:72,89`). Violates "values live/correct/grounded, never blank".
  **Fix is now a single deploy action (no code):** create the Railway cron service from
  `railway.market-regime-detector.toml` via Config-as-code, set `CRON_SECRET` on it, confirm first run
  writes `market_regime`. _(found 12:13; refined 20:15 — writer confirmed built, only Railway trigger missing)_
- [ ] **P1-B (NEW 2026-06-28 00:14)** Entitlement leak — `/api/signals/open` is unauthenticated.
  `src/app/api/signals/open/route.ts:8` `GET` runs an unguarded query returning up to 500
  `signal_events` rows with `grade`, `ticker`, `strike`, `expiry`, `option_type`, `entry_mark`,
  `confluence_score` — the paid SPX_SLAYER + NIGHT_HAWK signal output. **Verified live:
  `GET https://www.blackouttrades.com/api/signals/open` → HTTP 200** (empty now — market closed,
  all scored to EOD — but exposes the day's live signals to anyone during RTH). Distinct from
  P2-A (market-wide/no-paid-data); this is paid data. **Orphaned**: no in-repo consumer fetches
  it, and the `signal-outcome-tracker` cron its comment cites does not exist anywhere in `src/`.
  **Fix:** add `isCronAuthorized` (sibling write routes `signals/record`+`signals/outcome` already
  have it) or delete the route. _(found 2026-06-28 00:14)_

## 🟡 P2 — open
- [ ] **P2-C ⏳ WATCH** SPX play ledger empty all-time (`spx_open_play`=0, `spx_play_outcomes`=0, re-verified live in prod 16:10). **Refined 16:10:** the engine never reached a BUY — `cron_job_runs` for `spx-evaluate` over the last 3 active days = **198 SCANNING · 24 WATCHING · 0 BUY/APPROVE · 42 skipped**. Cause is the confluence/Claude gates not approving, NOT the option-chain veto (confirmed disabled: `SPX_OPTION_CHAIN_REQUIRED` unset in env + `playOptionChainRequired()` defaults false at `spx-play-config.ts:417`). Two fresh gate fixes shipped **today while market closed** and are unvalidated: `5eee3ff` "unblock play entries — 6-bug gate audit" (12:35 PT) + `cee2ebf` "0DTE calibration" (12:47 PT). Cron path correct (`spx-evaluator.ts:41` → `evaluateSpxPlay({mutate:true})` → `openPlay` → `insertOpenSpxPlay`). **VERIFY Mon 2026-06-29 after RTH:** re-query `spx_open_play` (expect rows) + `cron_job_runs` for `play_action=BUY`. IF still 0 BUY after Monday's full session → escalate to P1 and read the `63567cb` diagnostic logs for the rejecting gate. Do NOT re-touch the veto. _(found 2026-06-27 07:10; refined 12:13 + 16:10)_
- [ ] **P2-A ✅ annotated-resolved** `/api/market/anomalies` and `/api/market/regime` serve 200 unauthenticated while sibling routes 401. **20:15:** both routes now carry explicit "intentionally public — market-wide, no paid data" annotations (`anomalies/route.ts:1-4`, `regime/route.ts:1-3`) — the documented-public fix prior runs proposed. No paid-data leak (both empty). Substance now folds into **P1-A** (empty because nothing writes them). Keeping pointer; auth-boundary addressed by annotation. _(found 07:10; annotation confirmed 20:15)_
- [ ] **P2-B** `spx_signal_log` is now **fully empty (0 rows, max null)** in prod — re-verified live 20:15 (prior runs saw "last wrote 06-17"; table now empty). No writer anywhere. If any admin/analytics surface reads it, it serves nothing. Confirm superseded by the play engine; retire table + readers or resume writes. _(found 07:10; re-verified empty 20:15)_

## 🔵 P3 — open (tech debt / tooling)
- [ ] **P3-1** deep-platform-audit `SKILL.md` produces false P0/P1 every run: stale probe paths (`/api/market/spx-pulse`→`/api/market/spx/pulse`, `/api/flows`→`/api/market/flows`, `/api/nighthawk/latest-edition`→`/api/market/nighthawk/edition`, `/api/grid/news`→none), wrong env-var names (`UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`), and a db-handler regex (`pool\.on`) that misses the real `livePool.on("error")` (`db.ts:113`). Fix the SKILL's probe lists. _(found 2026-06-27 00:12, reconfirmed 07:10)_
- [ ] **P3-2** `spx_pulse_snapshots` and `spx_watch_setups` exist in prod with 0 rows all-time and **zero INSERT code references** in `src/` → dead/legacy tables. Drop them or wire the intended writers. _(found 2026-06-27 07:10)_
- [ ] **P3-3 (NEW 20:15)** Fail-open cron-write guard. `market/anomalies/route.ts:38` and `market/regime/route.ts` POST handlers use `if (cronSecret && auth !== ` + "`Bearer ${cronSecret}`" + `)` — when `CRON_SECRET` is unset the guard short-circuits and the POST is accepted unauthenticated. `CRON_SECRET` is set in prod (no live exposure); defense-in-depth only. Prefer failing closed: `if (!cronSecret || auth !== …)`. **3rd instance found 2026-06-28 00:14:** `track-record/publish/route.ts:9` uses the identical fail-open pattern. _(found 2026-06-27 20:15; +instance 2026-06-28)_

## ✅ Recently confirmed FIXED
- **VAPID push (was inert)** — RESOLVED 16:10: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` all set in prod env → push alerts no longer inert
- **P2-1 (was open 00:12)** 7 TS errors in WIP `platform/intel` + sibling routes — RESOLVED: real `tsc --noEmit` now 0 errors, files committed, `git status` clean (verified 07:10)
- **P2-2 / #97 (was open 00:12)** `SpxDarkPoolCard` — RESOLVED: now imported + mounted at `SpxDashboard.tsx:13,86` (verified 07:10)
- **#100** pg Pool idle-error handler — `db.ts:113`
- **#101** Clerk `user.created` webhook — `webhook/clerk/route.ts:77`
- **#102** Polygon WS leader election — `ws/polygon-socket.ts:117-148`
- **#73** Largo SPX grounding tools present — `largo/{spx-desk-cache,tool-defs,run-tool}.ts`
- SPX option-chain veto neutered — `spx-play-config.ts:404`
- Redis IPv6 `family: 0` — `make-redis.ts:58`
