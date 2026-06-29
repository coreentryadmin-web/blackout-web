# API Coverage Synthesis — Implementation Roadmap
Last updated: 2026-06-28
Synthesis run: #1 (first synthesis — no prior SYNTHESIS.md to diff against)

## Reports read (and freshness)
All sources current — none older than 8 days (today = 2026-06-28).

| Report | Last updated | Age | Notes |
|---|---|---|---|
| `whop.md` | 2026-06-27 | 1d | ✅ provider audit (payments/access) |
| `clerk.md` | 2026-06-28 | 0d | ✅ provider audit (auth/identity) |
| `security/pentest-report.md` | 2026-06-28 | 0d | ✅ pen-test (auth boundary) |
| `cto/cto-audit-20260627.md` | 2026-06-27 | 1d | ✅ covers **Anthropic cost, UW WS, Polygon GEX, DB** — stands in for the missing polygon-*/anthropic provider files |
| `connectivity/cross-service-matrix.md` | 2026-06-28 | 0d | ✅ cross-tool wiring |
| `network/https-monitor.md` | 2026-06-28 | 0d | ✅ TLS/headers/availability |
| `services/night-hawk.md` | 2026-06-27 | 1d | ✅ Night Hawk pipeline |
| `OPEN-ISSUES.md` | 2026-06-28 | 0d | ✅ master P0–P3 log |
| `PLATFORM-INTELLIGENCE.md` | 2026-06-28 | 0d | ✅ cross-report pattern brain |

### Provider reports PENDING (audit not yet run under these names)
- `unusual-whales.md` — **PENDING.** UW findings sourced from the CTO audit (UW WebSocket P0-4, 2-RPS budget) + connectivity matrix (flow wiring). A dedicated UW endpoint/event coverage audit (à la whop.md) has not been produced.
- `polygon-stocks.md`, `polygon-indices.md`, `polygon-options.md`, `polygon-benzinga.md` — **PENDING.** Polygon/Massive findings sourced from CTO audit (GEX fan-out, options-socket leak, leader election) + connectivity matrix (GEX convergence). No per-endpoint coverage breadth audit exists.
- `anthropic.md` — **PENDING.** Anthropic findings sourced from CTO audit cost section (prompt-caching confirmed implemented, 5-layer spend gate, no Opus default). No standalone model/endpoint coverage audit.
- **Recommendation:** spin up the same provider-coverage template used for `whop.md`/`clerk.md` against UW, Polygon (×4), and Anthropic so the next synthesis has true endpoint/event coverage breadth, not just the cross-cutting CTO findings.

---

## Week-over-Week Progress

### Shipped since last synthesis (no prior synthesis — these are confirmed-fixed this cycle)
- ✅ **`/api/signals/open` entitlement leak CLOSED** — gated behind `isCronAuthorized` 2026-06-28 08:13; post-deploy `GET → 401` confirmed live and re-verified 12:23. (Was P1-B, a paid SPX_SLAYER/NIGHT_HAWK signal leak.)
- ✅ **Anthropic prompt caching CONFIRMED IMPLEMENTED** — `anthropic.ts:165-197` auto `cache_control:ephemeral` ≥16,384 chars; no Opus default; `max_tokens` always bounded. **Task #103 ("no prompt caching") is STALE — close it.**
- ✅ **W1 dual GEX path CONVERGED** — `getGexPositioning()` is now a pure `fetchGexHeatmap` cache-reader; every full-matrix consumer reads the same `gex-heatmap:{ticker}` cache.
- ✅ **W2 (NW panel verdict omitted HELIX flows) RESOLVED** — `verdict.ts` consumes `ctx.flows` on both list + detail paths.
- ✅ **VAPID push armed** — alerts no longer inert.
- ✅ **`X-Powered-By` leak fixed** (`poweredByHeader:false` live).
- ✅ **Confirmed-fixed re-verified live:** #97 dark-pool card mounted, #100 pg pool error handler, #101 Clerk `user.created` webhook, #102 Polygon WS leader election, SPX option-chain veto neutered, Redis `family:0`.

### Escalated (recurring / unactioned — these keep reappearing)
- 🔴 **Auth-boundary leaks (Root Cause #1)** — grew 2→5 leaked GET endpoints across audit cycles; 2 still open (`brief/premarket`, `platform/intel`). Plus 4 fail-open cron-write guards (1→4 instances). **No default-deny test exists → the next audit will find leak #6.** This is the #1 escalation.
- 🔴 **SPX flagship durable record empty (Root Cause #2 / P0-1)** — `spx_play_outcomes` = 0 rows all-time across the engine's entire life; recurring 2 cycles. Gated on Mon 2026-06-29 RTH verification.
- 🟠 **market_regime / flow_anomalies dead (P1-A)** — writer built in code, Railway service never created; recurring 2 cycles.
- 🔵 **Audit SKILL.md stale probes (P3-1)** — #1 by recurrence frequency; re-rediscovered every cycle by 3+ audit tasks, burning cycles on false positives.

---

## Top 10 Highest-Priority Implementations

Priority score = (Revenue + Risk) / Effort. Effort 1 = trivial, 5 = hard.

| Rank | Provider | Feature/Endpoint | Rev | Risk | Effort | Score | Why |
|---|---|---|---|---|---|---|---|
| 1 | Railway/UW | Create `market-regime-detector` cron service (Config-as-code) | 3 | 4 | 1 | **7.0** | Writer fully built; one operator step unblocks paid `/flows` banner + NH morning-confirm. No code. |
| 2 | Internal | Gate `brief/premarket` + `platform/intel` (premium leak) | 4 | 5 | 2 | **4.5** | Premium SPX walls/king-strike/GEX + live regime/win-rates served free. One-line `authorizeCronOrTierApi`. |
| 3 | Whop | Handle `payment.failed` webhook | 5 | 3 | 2 | **4.0** | Revenue leak: premium served free through the entire dunning window. Reuse existing sync + ops-alert path. |
| 4 | Internal | `coaching/alerts` → `isCronAuthorized` (kill fail-open) | 2 | 3 | 1 | **5.0** | One missing env var = open public write endpoint; non-constant-time compare. One-line swap. |
| 5 | Internal | Default-deny auth CI grep-test | 3 | 5 | 2 | **4.0** | Structural fix that closes the *entire* leak class permanently. Highest leverage of any item. |
| 6 | Internal | SPX durable-write fix (P0-1/P0-2) + verify Mon RTH | 5 | 5 | 3 | **3.33** | Flagship's headline proof. Verify-first (Effort 1) Monday, then fix swallowed `recordPlayEntry` + force-close-without-outcome. |
| 7 | Frontend | Per-route `error.tsx` boundaries | 3 | 4 | 2 | **3.5** | A bad market payload currently whites out the *entire* app shell, not one panel. |
| 8 | Clerk | Tier/role in JWT session claims | 2 | 4 | 2 | **3.0** | Removes a Clerk Backend call from every cold-cache request **and** decouples the auth hot path from Clerk uptime. |
| 9 | Clerk | `user.deleted` webhook handler | 1 | 4 | 2 | **2.5** | GDPR/CCPA right-to-erasure + stops orphan-row accumulation. Svix scaffold already present. |
| 10 | UW | Port Polygon SETNX leader election to UW socket (P0-4) | 3 | 5 | 3 | **2.67** | The thing that **breaks first** on horizontal scale-out: 5× joins vs 2-RPS cap. Pattern already exists in repo. |

---

## By Category

### P0 — Business Risk (fix immediately)
Real risk: wrong/blank money-facing data, premium served free, or scale-out breakage.

1. **SPX flagship durable record empty (P0-1/P0-2, CTO).** `spx_play_outcomes` = 0 rows all-time; the launched SPX Slayer's P&L/track-record panels are blank against the live-data mandate. Two mechanisms: force-close without an outcome row (`db.ts:1234-1238`) and a swallowed `recordPlayEntry` write (`spx-play-engine.ts:915-927`). **Action: VERIFY Mon 2026-06-29 RTH** that plays open AND write an outcome row on open + close; if still 0 BUY after a full session, escalate and read the `63567cb` gate diagnostics. Make the entry write part of the open transaction (fail-closed on durability).
2. **Unauthenticated premium endpoints (pentest P1-1).** `brief/premarket` (SPX price, call/put wall, king strike, net GEX, bias) and `platform/intel` (live JSON: regime, anomalies, coaching, signal win-rates by source) serve premium intelligence with no auth. Wrap each with `authorizeCronOrTierApi(req, "premium")` mirroring `market/lotto/today`. *(`signals/open` — the third — was already fixed this cycle.)*
3. **`coaching/alerts` POST fails OPEN on unset `CRON_SECRET` (P0-3, CTO).** Latent today (secret is set) but one env-var slip = an open public write endpoint, plus a non-constant-time compare. One-line swap to `isCronAuthorized(req)`.
4. **market_regime / flow_anomalies never written (P1-A).** Writer cron is fully built (`cron/market-regime-detector/route.ts` + registry + `.toml`) but the Railway *service* was never created → 0 rows all-time, paid `/flows` FlowAnomalyBanner never renders, NH morning-confirm degrades to `regime=UNKNOWN`. **Fix = one Config-as-code service creation, no code.**

### P1 — High Value, Low Effort (ship this week)
5. **Default-deny auth CI test (CTO / PLATFORM-INTEL).** Grep every `src/app/api/**/route.ts` for one of `{requireTierApi, isCronAuthorized, authorizeCronOrTierApi, resolveAdminApi/requireAdminApi}`; fail the build on an un-allowlisted miss. Closes the whole leak class (~9 findings) and prevents leak #6. Mostly mechanical.
6. **Whop `payment.failed` handler (whop.md #1).** Record dunning state + fire ops/user alert + optional bounded grace timer instead of waiting indefinitely for `membership.deactivated`. Lowest-effort/highest-leverage payment gap. Reuse `syncWhopMembershipForEmail` + `notifyOpsDiscord`.
7. **Sweep the 4 fail-open cron guards to fail-closed** — `coaching/alerts`, `market/anomalies`, `market/regime`, `track-record/publish:9`. `if (!cronSecret || auth !== …)`.
8. **Per-route `error.tsx` boundaries (CTO frontend P0).** Add scoped error boundaries to `(site)/heatmap`, `/terminal`, `/grid`, `/nighthawk` route groups so a render crash in one live-data panel doesn't white out the whole shell.
9. **Clerk tier/role in JWT claims (clerk.md #1).** Dashboard → Sessions → custom claims `tier: {{user.public_metadata.tier}}`, `role: {{…role}}`; read from `auth().sessionClaims` with `getUser` as fallback. Removes a Clerk Backend call from every cold-cache protected request and decouples auth from Clerk uptime.
10. **`engine/health` add `force-dynamic`** — currently serves a build-time health snapshot, never probes live (CTO frontend P1).
11. **`/embed/*` strip `X-Frame-Options` (pentest P2-1)** — XFO `SAMEORIGIN` is blocking the legit third-party track-record embed that the relaxed `frame-ancestors *` CSP is supposed to allow.

### P2 — High Value, Medium Effort (plan for next sprint)
12. **Clerk `user.deleted` webhook (clerk.md #2)** — privacy-compliance + orphan cleanup.
13. **Whop invoice dunning lifecycle** (`invoice.past_due`, `marked_uncollectible`, `voided`) — real "payment problem" signal + deterministic grace-end point (whop.md #2).
14. **Whop `dispute_alert.created`** — pre-dispute early warning; pre-emptive refund avoids chargeback fee (whop.md #3).
15. **UW WebSocket leader election (P0-4, CTO)** — port `polygon-socket.ts:117-156` SETNX pattern + bound the persist fan-out (P1-2). The single biggest scale-out win; masked today at ~2 replicas.
16. **`reconcileAllMemberships` advisory lock + batch concurrency (CTO)** — entitlement = money; serial+unlocked races Clerk writes and hammers Whop rate limit at scale.
17. **Night Hawk: make the evening cron authoritative (night-hawk.md #1)** — `force`-rebuild when published `session_date` is older than the latest completed RTH, so the canonical edition isn't grounded in the prior session. Keep #77 open until ≥2 clean cycles. + reap orphaned `running` jobs >2h + persist grounding counts to `meta`.
18. **Polygon far-dated GEX fan-out cap (CTO)** — `polygon-options-gex.ts:1968` cache-miss fans out ~88 concurrent fetches that queue ahead of live desk reads; cap or de-prioritize far-dated.
19. **options-socket fixes** — `optionMarks` memory leak (P1-3), and the `code=1006` reconnect loop (P2-D): gate reconnect/heartbeat on options-RTH. **Re-check Mon 06-29 RTH** — climbing `failures` → promote to P1.
20. **Polygon socket hardening** — lock-refresh TOCTOU (P1-1, Lua compare-and-extend) + release lock after N construct failures (P1-4, prevents one wedged replica starving the cluster's index feed).
21. **Schema-failure re-init stampede backoff (`db.ts:663-674`, CTO P1)** + add FK indexes pre-fill + set `PG_POOL_MAX` explicitly.
22. **Clerk: fix primary-email selection** (`email_addresses[0]` → `primary_email_address_id`) — low-effort correctness.
23. **`spx-desk-merge` per-request structure-state race (CTO concurrency P1-1)** — module-singleton `lastGoodStructure` cross-contaminates concurrent requests; a real grounding hole on a "100% correct vs source" surface. Scope per-request.

### P3 — Low Priority (backlog)
24. **Fix audit SKILL.md stale probe paths/env names at source** — recurring #1 false-positive generator (`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `nighthawk/latest-edition`→`market/nighthawk/edition`, `grid/news` nonexistent, `UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`, db-handler regex misses `livePool.on`). Cheap; stops the fleet burning cycles.
25. **Retire dead tables** — `spx_signal_log` (P2-B, 0 rows no writer), `spx_pulse_snapshots`, `spx_watch_setups` (P3-2). Drop or wire writers.
26. **`api_telemetry_events` 305 MB write-only ballast (CTO)** — dashboard reads in-memory not this table; sample writes (1-in-N for `ok`) or drop the durable copy.
27. **Clerk `sessions.revokeSession` + `session.ended` webhook** — admin force-logout + proactive SSE/desk-stream teardown. Defer until refunds/bans handled in-app.
28. **Whop `users.checkAccess` migration** — retire the `member:email:read` enumeration fragility (architectural, not urgent).
29. **Connectivity W3 / earnings + macro_indicators confluence gaps** — converge Grid econ ↔ SPX-desk macro to one provider; wire `macro_indicators` (GDP/CPI/unemployment) and an earnings factor into `computeSpxConfluence` (present as data today, scored 0).
30. **CSP `unsafe-inline`/`unsafe-eval` hardening (pentest P2-2)** — migrate to nonce/hash if TradingView permits.
31. **CTO DB hygiene** — `SELECT *` slimming on `flow_alerts`, TLS `rejectUnauthorized` default flip when host leaves Railway, GexHeatmap 187KB → `next/dynamic`, gate the 3s/1.5s ungated pollers on `isRTH()`.

---

## Cost Reduction Summary
**Total estimated monthly savings if all cost gaps closed: modest — low hundreds of $/mo, not the headline.** The platform is already cost-disciplined (CTO graded Anthropic spend controls "best-in-class").

- **Anthropic** — already optimized: prompt caching live, haiku for commentary, Sonnet (not Opus) for Largo with ≤12 tool-rounds × 4096 cap, shared 1-call-per-ticker/15-min across all users, 5-layer spend gate with cross-replica kill-switch. **No action — task #103 is stale.**
- **Top opportunity (storage):** `api_telemetry_events` writes **123k rows/day (4× the code's stated estimate)** at near-zero user load → 305 MB on a 7-day window, read by *nothing* (dashboard reads memory). Sampling `ok` events 1-in-N or dropping the durable copy removes storage + write-IO + vacuum cost. Biggest single mechanical saving; scales with every API/provider call as users grow, so it compounds.
- **Polygon/UW efficiency (not $ but RPS-budget):** the far-dated GEX fan-out (~88 concurrent) and the UW 5×-join-at-scale (P0-4) are *budget* risks against the 2-RPS cluster cap, not invoice-line costs. Fixing P0-4 is the highest-leverage RPS-budget win.

---

## Task-list cross-reference (#95, #96, #97, #98, #102, #103, #104, #105)
- **#97** (SpxDarkPoolCard) — ✅ **RESOLVED**, mounted at `SpxDashboard.tsx:13,86`. Close.
- **#102** (Polygon WS leader election) — ✅ **RESOLVED**, `ws/polygon-socket.ts:117-148`. Close. *(But the lock-refresh TOCTOU P1-1 + wedge-on-fail P1-4 are follow-ups — see P2 #20.)*
- **#103** (Anthropic prompt caching) — ✅ **STALE/RESOLVED**, caching implemented `anthropic.ts:165-197`. Close.
- **#98 / #104** (WS streams) — **MAP TO OPEN AUDIT FINDINGS:** the UW WebSocket leader-election gap (P0-4, roadmap #15/Top-10 rank 10) and the options-socket `code=1006` loop + `optionMarks` leak (P2-D / P1-3, roadmap #19). Recommend re-scoping #98/#104 around these concrete fixes.
- **#95, #96, #105** — no audit finding maps cleanly; likely tracked elsewhere. Flag for the operator to confirm scope or close.

---

## Recommended Build Order for Next 7 Days

**Mon 2026-06-29 (RTH — verification-first):**
- ⏰ **First priority, market-open:** verify SPX plays open + write an outcome row (P0-1). Re-check options-socket `failures` counter resets once quotes flow (P2-D). These are time-boxed to RTH and gate everything downstream.
- Operator: create the `market-regime-detector` Railway cron service (P1-A) — no code, unblocks paid `/flows`. (Top-10 rank 1.)

**Tue 06-30 (auth boundary — close the class):**
- Gate `brief/premarket` + `platform/intel` (P0). Swap `coaching/alerts` to `isCronAuthorized` + sweep the other 3 fail-open guards (P0-3). (Top-10 ranks 2, 4.)
- Land the **default-deny CI grep-test** so leak #6 can never ship. (Top-10 rank 5.)

**Wed 07-01 (revenue + resilience):**
- Whop `payment.failed` handler + dunning lifecycle (Top-10 rank 3). 
- Per-route `error.tsx` boundaries + `engine/health` `force-dynamic` (Top-10 rank 7).

**Thu 07-02 (Clerk hardening):**
- Tier/role JWT claims (Top-10 rank 8) + `user.deleted` webhook (rank 9) + primary-email fix. Decouples auth hot path from Clerk uptime in one sweep.

**Fri 07-03 (scale seams — depends on Mon SPX outcome):**
- If SPX durable-write still broken after Monday: fix `recordPlayEntry` transaction (P0-2) — promote ahead of everything.
- Otherwise: UW leader election + persist fan-out bound (P0-4, Top-10 rank 10) + `reconcileAllMemberships` advisory lock. Pre-emptive scale-out work — the thing that breaks first at launch traffic.

**Continuous / low-effort fillers:** fix the audit SKILL.md stale probes (stops false-positive churn every cycle), retire dead tables, Night Hawk evening-cron authority. **Stand up the missing UW/Polygon/Anthropic provider-coverage audits** so the next synthesis has real endpoint-breadth data.

---
*Generated by the `api-audit-synthesis` scheduled task. Reads every provider + platform audit in `docs/api-audit/`, scores findings by (Revenue+Risk)/Effort, and produces the prioritized build queue. No secrets/keys/DB-URLs/user values printed.*
