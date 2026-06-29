# BlackOut Platform Intelligence
**Last updated:** 2026-06-29 05:31 ET
**Reports analyzed (last 26h):** 16 — cto-audit-20260629, 6× deep-audit (28-04→29-04), clerk, error-log, https-monitor, connectivity-matrix, SYNTHESIS, IMPLEMENTATION_LOG, OPEN-ISSUES
**Today's findings:** 23 (2 P0 · 11 P1 · 6 P2 · 1 P3 · 3 WARN) — **12 recurring · 11 net-new**
**Platform trend:** **MIXED — improving on the tracked root causes, but 2 net-new latent P0s + a new "deploy gap" pattern surfaced.**
**History:** 75 findings on record across 3 days (31 → 21 → 23).

> **One-line read:** The live, user-facing platform is still GREEN (all pages 200, all data routes correctly 401, no 5xx, connectivity STRONG at PASS=17/FAIL=0). The big win this cycle: **Root Cause #1 (auth-by-convention) was substantially CLOSED in code** — the last two leaked GET endpoints were gated and 5 fail-open guards swept. But three things moved the other way: (1) those fixes sit **unpushed** (11 commits), so prod still runs the broken code — a *new* root cause; (2) the auth leak **migrated to the admin tier** (`run-migration`, `debug-uw`), which the popular "default-deny grep test" would NOT catch; and (3) the CTO deep-read surfaced **two genuinely new latent P0s** (a config gap and an SSE OOM) that are scale/ops risks, not present user-facing pain.

---

## THE ROOT CAUSES (updated this cycle)

### ROOT CAUSE #1 — Auth by per-route convention → **CLOSING in code, but it mutated**
Yesterday this was the #1 escalation: a steady drip of *missing* auth, growing 2→5 leaked GETs + 1→4 fail-open POSTs. **This cycle the implementation cron actually fixed the known instances** (`IMPLEMENTATION_LOG.md`):
- ✅ `brief/premarket` gated (cron OR premium) — `ab611fb`
- ✅ `platform/intel` gated + its one cron caller updated to send `Bearer ${CRON_SECRET}` — `ab611fb`
- ✅ **5** fail-open cron guards swept to `isCronAuthorized` (fail-closed, constant-time): `coaching/alerts`, `market/regime`, `market/anomalies`, `track-record/publish`, `brief/store` — `bcaa3cf`
- ✅ `engine/health` `force-dynamic` — `64a15ea`

**But the root cause didn't die — it moved.** The CTO audit found two NEW auth defects that are *not* "missing auth" — they call **an** auth helper, just the **wrong-tier** one:

| Route | Current guard | Should be | Exposure |
|---|---|---|---|
| `admin/run-migration` | `authorizeMarketDeskApi` (cron **OR any premium user**) | `requireAdminApi()` | **Any paying user can POST and re-apply DB migration DDL** against prod (bounded to shipped `.sql`) |
| `admin/debug-uw` | `auth()` only (any signed-in, incl. **free tier**) | `requireAdminApi()` | Any logged-in user proxies arbitrary UW GETs with **our server key** (paid-data leak / limited SSRF) |

> **🧠 The insight the individual audits each miss:** the universally-recommended **"default-deny CI grep-test"** (assert every `route.ts` calls *one of* the auth helpers) **would pass both of these** — they DO call a helper. The real invariant is two-part: (a) every route calls a helper **and** (b) every route under `admin/**` calls `requireAdminApi`. Encode the **tier**, not just the presence. *Until that second clause exists, the next audit finds admin-leak #3.*

### ROOT CAUSE #2 — "Built but never running" → empty durable tables (UNCHANGED, gated on today)
No movement since yesterday — these are all operator/RTH-gated:

| Table / feature | State | Blocker | Gate |
|---|---|---|---|
| `market_regime`, `flow_anomalies` | 0 rows all-time | Writer built; **Railway cron service never created** | Operator Config-as-code step |
| `spx_play_outcomes`, `spx_open_play` | 0 rows all-time | Engine never reached BUY (0 BUY/APPROVE over active days) | **VERIFY today (Mon 06-29) RTH** |
| `spx_signal_log`, `spx_pulse_snapshots`, `spx_watch_setups` | 0 rows, no writer | Dead/legacy | Retire |

### 🆕 ROOT CAUSE #3 — The DEPLOY GAP: "fixed-in-code" ≠ "fixed-in-prod"
**This is the most important new pattern this cycle.** `git rev-list origin/main..HEAD = 11` — eleven commits are committed **locally only and unpushed**, including:
- `ffbed27` the `/api/admin/signal-analytics` **500 fix** → that 500 is **STILL LIVE in prod**.
- All of Root Cause #1's auth-gating fixes above → **prod still leaks** `brief/premarket` + `platform/intel` and still has the fail-open guards.

This is the *direct, expected* side effect of the **cron-no-push policy** (crons commit locally, the operator reviews & pushes — correct for safety). But it has a measurable cost: **every fix the audit fleet "closes" is invisible to prod until the operator pushes.** The intelligence brain must therefore distinguish **"resolved in code"** from **"resolved in prod"** — and the gap is now 11 commits deep. **Action: operator `git push origin main` after review** collapses Root #1's prod exposure *and* the signal-analytics 500 in one step. This single action is the highest-leverage move available right now.

---

## NET-NEW THIS CYCLE (the CTO deep-read found these)

| # | Sev | Finding | Why it matters |
|---|---|---|---|
| C1 | 🔴 P0 | `REPLICA_COUNT` unset → UW limiter degraded math emits `2×N` RPS over the 2-RPS cap on any Redis blip; **degraded-state alarm is gated off at `REPLICA_COUNT=1`** → silent overshoot → 429 storm → blank desk/flows for all users | **#1 most-likely 30-day incident.** Redis blips are routine on Railway. **Fix is one env var.** |
| C2 | 🔴 P0 | `positions/stream` SSE has no connection cap + no backpressure (the only SSE route missing the `pulse/stream` pattern) → backgrounded mobile tabs grow the controller queue unbounded → replica OOM | Only path that can OOM a replica under *normal* user behavior |
| — | 🟠 P1 | Night Hawk SYSTEM prompts uncached (`<16,384` char auto-cache floor, no `cacheSystem:true`) → full input price every generation | Cost — prompt caching is Largo-only today |
| — | 🟠 P1 | `push/send` no `LIMIT` + serial `webpush.send` loop; `fetchRecentFlows LIMIT 5000` w/ 8 JSONB extractions/row on the hottest path | Pool/CPU pressure at RTH load |
| — | 🟠 P1 | No `(site)/error.tsx`; `GexHeatmap.tsx` 190 KB static import; live-tick tapes zero-memoized | Frontend resilience + TTI |

**Config gaps that are all one Railway env change each:** `REPLICA_COUNT` (C1), `DAILY_AI_SPEND_KILL_USD` (arms the AI kill-switch), `DISCORD_OPS_WEBHOOK_URL` (un-blinds ops to cron failures). Three env vars close one P0 + two P1 ops/cost risks.

---

## PLATFORM HEALTH SCORECARD
| Surface | Status | Trend | Evidence |
|---|---|---|---|
| Availability / TLS | ✅ PASS | → | all routes healthy, no 5xx, https-monitor green |
| Auth boundary (presence) | ✅ **FIXED in code** | ↑ improving | 5 GET leaks + 5 fail-open guards gated this cycle (pending push) |
| Auth boundary (tier) | ⚠️ **ROOT #1 mutated** | ↓ new | `admin/run-migration` premium-not-admin; `admin/debug-uw` any-signed-in |
| Deploy state (code→prod) | ⚠️ **ROOT #3 new** | ↓ new | 11 unpushed commits; signal-analytics 500 still live in prod |
| Rate-limit resilience | ⚠️ **C1 P0** | ↓ new | `REPLICA_COUNT` unset → silent UW overshoot on Redis loss |
| WebSocket / SSE health | ⚠️ **C2 P0** | ↓ new | `positions/stream` no cap/backpressure → OOM; UW/options no leader election |
| Durable data correctness | ⚠️ ROOT #2 | → | flagship ledger + regime/anomaly empty (gated on today's RTH + operator) |
| Cross-service connectivity | ✅ STRONG | ↑ | PASS=17 / FAIL=0 / WARN=1 (W1 bounded); W2 closed |
| DB performance/contention | ⚠️ latent | → | shared `max:5` pool + telemetry write-amp (619K rows/314MB) |
| Security (CTO verified) | ✅ B+ | ↑ | pg/redis handlers present, Polygon limiter present, Anthropic caching present (3 stale memory notes now resolved) |

---

## TRADING / MONEY IMPACT (ranked)
| Impact | Severity | Findings |
|---|---|---|
| Cluster-wide blank desk/flows on a Redis blip | 🔴 CRITICAL | **C1 REPLICA_COUNT** (new) — self-inflicted availability outage, alarm suppressed |
| Replica OOM hard-crash under normal mobile use | 🔴 CRITICAL | **C2 positions/stream** (new) |
| Premium still leaked free **in prod** | 🔴 CRITICAL | `brief/premarket` + `platform/intel` fixed-in-code but **unpushed** (Root #3); `admin/debug-uw` paid-data via our key |
| Empty flagship track record (SPX P&L blank) | 🔴 CRITICAL | spx ledger 0 rows — **verify today RTH** |
| Revenue leak on failed payments | 🟠 HIGH | Whop `payment.failed` unhandled (deferred — payment logic) |
| Stale/degraded signals | 🟠 HIGH | regime=UNKNOWN (P1-A), NH SYSTEM prompts uncached |
| Wrong **price** shown to user | 🟢 NONE | no wrong-price finding this cycle (3rd consecutive day) |

---

## RECURRING (root causes not yet fixed — where to spend effort)
| # | Issue | Days seen | Status this cycle |
|---|---|---|---|
| 1 | **Audit SKILL.md stale probes** (P3-META) | **3** | #1 by frequency, re-found by 3+ tasks every run. **Still not fixed at source.** Burns cycles on false positives. |
| 2 | **SPX ledger empty** (Root #2) | 3 | **WATCH → verify TODAY (Mon 06-29) RTH.** If still 0 BUY after a full session → escalate to P1. |
| 3 | **`market-regime-detector` service absent** (P1-A) | 3 | Unchanged — operator Railway step. |
| 4 | **options-socket 1006 loop** (P2-D) | 3 | Off-hours benign; re-check today once quotes flow. |
| 5 | **W1 dual GEX path** | 3 | Bounded WARN (SPX converged); monitor-for-drift only. |
| 6 | **Fail-open auth guards** (Root #1b) | 3 | **RESOLVED in code** this cycle (5 swept) — pending push. |
| 7 | **Auth no-default-deny GETs** (Root #1a) | 3 | **RESOLVED in code** (last 2 gated) — but mutated to admin-tier (new). |
| 8 | **DB pool contention / telemetry write-amp** | 2 | Unchanged; the load-bearing 10x scale risk. |

**Recurring count dropped from 6→ effectively 5 active** (Root #1a/#1b resolved-in-code), but P3-META hit **3 straight days** — it is now provably the single most wasteful recurring item.

---

## SYSTEMIC PATTERNS (multi-service)
- ⚠️ **Deploy gap (NEW)** — the audit fleet closes findings faster than prod receives them. 11 commits queued. The fleet's "RESOLVED" ≠ user reality until push. *Track resolved-in-code vs resolved-in-prod separately from now on.*
- ⚠️ **Wrong-tier auth, not missing auth (NEW shape of Root #1)** — `admin/*` routes calling `auth()`/premium instead of `requireAdminApi`. The default-deny grep test must assert tier, not just presence.
- ⚠️ **Config-gap risks dominate the new P0/P1s** — C1, AI kill-switch, ops webhook are all *unset env vars*, not code bugs. The single highest-ROI sprint is "set the 3 Railway env vars."
- ⚠️ **Distributed-systems seams unguarded** — UW/options WS no leader election; shared `max:5` pool + telemetry write-amp. All masked at current replica count; first to break on scale-out.

---

## LEARNING VELOCITY (what changed since 06-28)
**Resolved / improving — the platform IS learning:**
- ✅ **Root #1 (auth) substantially closed in code** — 5 GET leaks + 5 fail-open guards gated (`ab611fb`, `bcaa3cf`). *(Prod-pending — see deploy gap.)*
- ✅ **signal-analytics 500 fixed in code** (`ffbed27`) — *(prod-pending.)*
- ✅ **3 stale memory notes retired by the CTO live-read:** pg Pool error handler IS present (`db.ts:113`), Polygon DOES have a rate limiter, Anthropic prompt caching IS implemented.
- ✅ **Connectivity improved** — W2 fully closed; only W1 (bounded) remains.
- ✅ **VAPID confirmed armed**, `X-Powered-By` fixed, `engine/health` now live-probes.

**Regressions / new risk this cycle:**
- ↓ **2 net-new P0s** (C1 config, C2 SSE) from the deeper CTO read.
- ↓ **Auth root cause mutated** to admin-tier (2 new defects).
- ↓ **Deploy gap widened** to 11 commits.

**Honest framing:** P0 count went 0→2, but this reflects a **deeper audit finding latent risks**, not the live platform degrading (it's still GREEN on everything user-facing). The two new P0s are a config var and a scale-out OOM — neither is hurting a user *today*.

---

## INTELLIGENT RECOMMENDATIONS (priority order)

### 1. [DEPLOY GAP + CONFIG — do today, ~15 min, zero code] Push the queue + set 3 env vars
The single highest-leverage action available: **operator reviews & `git push origin main`** (collapses Root #1 prod exposure + the signal-analytics 500 in one shot), then sets **`REPLICA_COUNT`** (closes C1, the #1 30-day incident risk), **`DAILY_AI_SPEND_KILL_USD`** (arms the AI kill-switch), **`DISCORD_OPS_WEBHOOK_URL`** (un-blinds ops). One push + three env vars closes 1 P0 + ~6 P1s with no new code.
**Why:** every other recommendation is moot if the fixes never reach prod and the cluster can silently blow its rate cap.

### 2. [ROOT #1 — refined] Make the default-deny test **tier-aware**, then fix the 2 admin leaks
Swap `admin/run-migration` → `requireAdminApi()` and add `requireAdminApi()` to `admin/debug-uw`. Then the CI grep-test must assert: (a) every `route.ts` calls a helper **and** (b) every `app/api/admin/**/route.ts` calls `requireAdminApi`. The presence-only test everyone proposed would have shipped both leaks.
**Why:** Root #1 is not dead — it mutated from "missing auth" to "wrong-tier auth." Close the *class*, including tier.

### 3. [SCALE — C2] Port the `pulse/stream` cap+backpressure to `positions/stream`
Add the `activeStreams`/`MAX_STREAMS` 503 gate + `sseBackpressureExceeded(controller.desiredSize)` drop + decrement in `cleanup()`. Small, surgical, closes the only OOM vector. (The abort listener is already correct.)

### 4. [ROOT #2 — verify-first, TODAY] Confirm SPX plays open this RTH
First market-open priority: re-query `spx_open_play` (expect rows) + `cron_job_runs` for `play_action=BUY`, and confirm an outcome row writes on open. If still 0 BUY after a full session → escalate P2-C→P1 and read the `63567cb` gate diagnostics. **Do NOT re-touch the (already-disabled) veto.** Also re-check the options-socket 1006 `failures` counter resets once quotes flow. Operator: create the `market-regime-detector` Railway service (no code).

### 5. [TOOLING — 3rd day recurring] Fix the audit SKILL.md stale probes at source
`spx-pulse`→`spx/pulse`, `flows`→`market/flows`, `nighthawk/latest-edition`→`market/nighthawk/edition`, drop `grid/news`, `UNUSUAL_WHALES_API_KEY`→`UW_API_KEY`, db-handler regex must match `livePool.on`. This is now the most provably-wasteful recurring item (re-found by 3+ tasks for 3 straight days). Cheap; stops the fleet burning cycles on false positives.

### 6. [COST + DB — as capacity allows] NH `cacheSystem:true` + move telemetry off the user pool
Three `cacheSystem:true` flips on the Night Hawk SYSTEM prompts (~0.9× input cost on those calls); batch/sample the `api_telemetry_events` write-amp off the shared `max:5` pool; bound `fetchRecentFlows` to the ~200 the tape renders; tighten autovacuum on `platform_meta`/`user_positions`.

---

## WHAT GOOD LOOKS LIKE
- ✓ **`git rev-list origin/main..HEAD = 0`** during/after each review window — no fix strands in the local-only gap
- ✓ Every `route.ts` provably calls a helper **of the correct tier** (admin routes → `requireAdminApi`), enforced by CI
- ✓ `REPLICA_COUNT`, `DAILY_AI_SPEND_KILL_USD`, `DISCORD_OPS_WEBHOOK_URL` all set in Railway
- ✓ Every SSE route has the cap + backpressure + cleanup-decrement (no OOM vector)
- ✓ `spx_play_outcomes` accrues rows each RTH; track-record panel non-empty
- ✓ Every table with a live consumer has a live writer (`market_regime`/`flow_anomalies` writing)
- ✓ Recurring-issue count → 0; P3-META fixed so the fleet stops re-finding it
- ✓ All GEX/flow/price values match provider ground truth within tolerance during RTH (no wrong-price finding — held 3 days running)

---
*Generated by the platform-learning-brain cron (05:30 ET). Reads every audit report from the prior 24h, finds cross-report patterns, tracks recurrence/trend, and drives the one goal: users see 100% correct real data. No secrets/keys/DB-URLs/user values printed. Source findings: `docs/api-audit/learning/history.jsonl` (75 findings / 3 days).*
