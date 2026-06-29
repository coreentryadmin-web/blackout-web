# BlackOut Platform — Weekly Digest
Week of 2026-06-22 (Mon) → 2026-06-29 (Mon AM)
Generated: 2026-06-29 11:03 ET (15:03 UTC)

---

## Platform Health Score: 78/100
**Site serving is rock-solid (green all week). The score is dragged down by a *live* market-hours data outage that surfaced this morning** — the Unusual Whales data WebSocket went silent ~5h straight through Monday's open, which blocks SPX plays right now — plus two unaddressed P0 *config* risks (REPLICA_COUNT unset, positions/stream OOM) and an ops-alerting blind spot. None of these touch the public site, but they hit the flagship product and the safety nets.

| System | Score | Trend | Notes |
|---|---|---|---|
| Production uptime | 97/100 | → | 12/12 routes 200, no 5xx all week; 1 brief db-cleanup crash (06-28, recovered <1h) |
| Live data freshness | 55/100 | ↓ | **UW data-WS stalled ~5h through Mon open** → flow/tide/halt stale → SPX plays blocked |
| Database health | 80/100 | → | Pool healthy (28/100 conns); telemetry write-amp + dead-tuple bloat are growth risks |
| Redis health | 75/100 | → | family:0 fix holding, error handler present; **REPLICA_COUNT unset breaks degraded-mode math** |
| Railway infra | 78/100 | → | web 5/5 + 19 crons Online; Market-Regime-Detector svc still missing; Discord webhook unset |
| Security posture | 85/100 | ↑ | Big week: signal leak closed, premium endpoints gated, fail-open guards swept; 2 new admin P1s |
| API coverage | 70/100 | → | Clerk 2/~30 webhooks; Whop payment.failed unhandled; UW/Polygon/Anthropic audits still pending |

---

## 🔴 Needs Your Attention NOW

1. **UW DATA WEBSOCKET STALL — SPX plays are blocked right now (HIGH, live).**
   The UW data WS (`uw-socket.ts`) connected at the 07:40 UTC deploy, delivered briefly, then went **completely silent for ~5h straight through the 13:30 UTC market open**. Flow/tide/halt/net-flow are all stale → `[spx-play-gates] halt channel stale — failing OPEN` → **no SPX play can open during RTH today.** REST crons succeed (`refreshed=24/24`), so the **key is valid — the fault is WS data delivery only** (subscription/auth not re-established after reconnect, or UW closed the socket per-replica).
   → **Fast mitigation:** `railway redeploy --service blackout-web` to re-handshake the feed.
   → **Root cause:** confirm `joinActiveChannels` re-sends UW auth + channel-subscribe frames after reconnect; check UW WS token/entitlement vs REST key; consider leader-electing the WS (5 replicas may each hold one).

2. **OPS ALERTING IS BLIND — Day 3, and today it actually bit (HIGH).**
   `DISCORD_OPS_WEBHOOK_URL` is unset. At 13:41 + 14:00 UTC the Cron-Staleness-Watchdog detected **5 RTH-stale crons** (a real market-hours event, correlated with the UW stall) and logged `alert_delivered=false`. The safety net was off at the exact moment it was needed.
   → **Set `DISCORD_OPS_WEBHOOK_URL` in the blackout-web Railway env.** Until then, every cron failure / RTH staleness is silent.

3. **C1 — `REPLICA_COUNT` unset → silent UW rate-limit overshoot (P0 config, CTO).**
   On any Redis blip each replica falls back to `2 / REPLICA_COUNT` RPS; default `1` means 5 replicas emit `5 × 2 = 10 RPS` against the 2-RPS cluster ceiling → 429 storm → breaker trips → blank desk/flows for everyone — **and the degraded-state alarm is gated off when REPLICA_COUNT=1, so it overshoots silently.** Rated the single most-likely 30-day incident.
   → **One-line fix:** set `REPLICA_COUNT` (+ pin `UW_GLOBAL_MAX_RPS=2`, `POLYGON_GLOBAL_MAX_RPS`, `DAILY_AI_SPEND_KILL_USD`) in Railway env.

4. **C2 — `positions/stream` SSE has no cap / no backpressure → replica OOM (P0, CTO).**
   Alone among the 4 SSE routes it has no `MAX_STREAMS` gate and no `desiredSize` backpressure check. A few backgrounded mobile tabs grow the controller queue by one positions payload every 3s, forever → memory/FD exhaustion. The only identified OOM vector under normal user behavior.
   → Port the `activeStreams` cap + `sseBackpressureExceeded` drop from `pulse/stream`.

5. **DEPLOY GAP — 17 commits committed LOCAL but UNPUSHED.**
   Per cron-no-push policy, all autonomous fixes stay local for your review. Notably `ffbed27` (admin signal-analytics 500 — `gates_blocked` column fix) **is still live-broken in prod until you push.** Review and `git push origin main` to actually deploy this week's fixes.

---

## 🟡 Review Before End of Week

- **Market-Regime-Detector Railway service still absent (P1-A, 2 weeks running).** Writer cron is fully built in code; `market_regime`/`flow_anomalies` = 0 rows all-time. One Config-as-code "add service" step unblocks the paid `/flows` anomaly banner + Night Hawk morning-confirm (currently degrades to `regime=UNKNOWN`).
- **SPX play opens (P2-C) — verify once the data feed is restored.** The engine *approves* setups; the veto is neutered. Today's block is the UW-WS data stall (#1 above), not the gates. Re-query `spx_open_play` after a clean RTH session.
- **Two new admin-auth P1/P2s (CTO security):** `admin/run-migration` is gated by premium-OR-cron, not admin → any paying user can re-apply DB migrations (swap to `requireAdminApi`). `admin/debug-uw` checks only signed-in (incl. free tier) → proxies our UW key (add `requireAdminApi`).
- **Night Hawk #77 — keep open until ≥2 clean evening cycles.** Recovery is one-edition-deep (see Night Hawk section). Make the evening cron authoritative (`force`-rebuild when published edition is older than latest RTH).
- **Whop `payment.failed` handler (revenue leak).** Premium served free through the entire dunning window until `membership.deactivated`. Reuse existing sync + ops-alert path.
- **Frontend resilience:** add `(site)/error.tsx` (a bad SSE payload currently whites out the whole shell); `next/dynamic` the 190 KB GexHeatmap.

---

## ✅ Fixed This Week (Autonomous)
| What | How Fixed | Commit |
|---|---|---|
| `/api/signals/open` paid-signal leak (200 unauth) | Gated behind `isCronAuthorized` → 401 verified live | `a266a24` / `6ade54b` |
| `brief/premarket` + `platform/intel` premium endpoints served free | Wrapped with cron-OR-premium auth (+fixed internal cron caller) | `ab611fb` |
| 5 fail-open cron-write guards (`if CRON_SECRET && …`) | Swept to fail-closed constant-time `isCronAuthorized` | `bcaa3cf` |
| `engine/health` served build-time snapshot | Added `force-dynamic` (live probe) | `64a15ea` |
| admin `signal-analytics` 500 (`gates_blocked` column) | Renamed to `gates_blocked_json` (**LOCAL — unpushed**) | `ffbed27` |
| `X-Powered-By: Next.js` header leak | `poweredByHeader:false` | `8ed4d81` |
| market-regime-detector writer | Built cron + registry + toml (needs Railway svc) | `472f162` |
| SPX engine never reaching BUY | 6-bug gate audit + professional 0DTE calibration | `5eee3ff` / `cee2ebf` |
| Cloudflare edge cache stale on deploy | Auto-purge once per deploy | `ee95fa2` |
| Night's Watch panel missing catalysts | Wired earnings into verdict path | `640ca5b` |
| Marketing/learn pages slow | Static-generate all public pages | `bc2aec3` |
| VAPID / GEX push inert | Env keys set → push armed | (env) |

Plus ~57 automated audit/monitor/connectivity commits and the W1 dual-GEX-path convergence + W2 NW-verdict-flows resolution.

---

## 📊 API Coverage Progress
| Provider | Coverage | Change vs Last Week | Top Gap |
|---|---|---|---|
| Unusual Whales | n/a (audit pending) | — | Dedicated endpoint/event coverage audit not yet produced; **live WS data delivery is down today** |
| Polygon / Massive | n/a (audit pending) | — | Per-endpoint breadth audit pending; far-dated GEX fan-out (~88 concurrent) + no WS leader election |
| Anthropic | ~optimized | → | Prompt caching live on Largo only; Night Hawk SYSTEM prompts uncached; no hard daily spend cap |
| Whop | partial | → | `payment.failed` / dunning lifecycle unhandled (revenue leak) |
| Clerk | 2 / ~30 webhooks | → | `user.deleted` unhandled (GDPR); tier/role not in JWT claims; reads `email_addresses[0]` not primary |

> First weekly digest — no prior baseline to diff "% change" against. Standing up the UW/Polygon/Anthropic provider-coverage audits (à la `whop.md`/`clerk.md`) is the prerequisite for real coverage % next week.

---

## 💰 Cost & Performance
- **Anthropic:** spend discipline graded best-in-class (single client, output-cache collapses N cold users → 1 generation, Sonnet-not-Opus for Largo, 5-layer spend gate). **Savings available:** flip `cacheSystem:true` on the 3 Night Hawk SYSTEM prompts (~0.9× on those input tokens) and arm `DAILY_AI_SPEND_KILL_USD` (currently only a $50 *alert*, no hard cap).
- **Railway:** blackout-web Online 5/5 replicas + 19 cron services Online. Missing service: Market-Regime-Detector.
- **DB:** `api_telemetry_events` is the largest + fastest-growing table at **619K rows / 314 MB** (one INSERT per provider call onto the user-facing pool). Biggest mechanical win = batch/sample/separate-pool those writes.
- **Redis:** healthy; `family:0` IPv6 fix holding; error handler centralized. Exposure = REPLICA_COUNT (see 🔴 C1).

---

## 🔧 Top 5 Things to Build This Week
1. **Set `REPLICA_COUNT` (+ UW/Polygon RPS pins + `DAILY_AI_SPEND_KILL_USD`) in Railway env** — closes C1 (#1 likely incident) and arms the AI spend kill-switch. One config change, do it first.
2. **Fix `positions/stream` SSE** — add `MAX_STREAMS` cap + backpressure + counter decrement (port from `pulse/stream`). Closes the only OOM vector.
3. **Set `DISCORD_OPS_WEBHOOK_URL`** — restore ops alerting so the next outage actually pages (today it didn't).
4. **Create the Market-Regime-Detector Railway cron service** — unblocks paid `/flows` banner + NH morning-confirm. No code, one operator step.
5. **Investigate the UW WS resubscribe/auth path** — make a silent-but-OPEN socket self-report + resubscribe after N empty reconnects so a 5h silent stall never recurs.

---

## 📈 Week-over-Week Trends
- **Commits:** 597 total (233 `fix`, 110 `feat`, ~29 UI/redesign, 57 automated audit/monitor).
- **Auto-fixes shipped:** 6 substantive (signal leak, premium gating, fail-open sweep, engine/health, signal-analytics 500, X-Powered-By) + cron/feature work.
- **Errors:** UW data-WS stall (NEW, Mon RTH) · options-socket 1006 storm (RESOLVED — 0 hits today) · db-cleanup crash (one-off, recovered).
- **Security issues resolved:** 4 (signal leak → 401, 2 premium endpoints gated, 5 fail-open guards closed, header leak) — net posture ↑, with 2 new admin-auth P1s queued.
- *(First digest — no prior week to compare; these become the baseline.)*

---

## Night Hawk
- **Editions generated this week: 1 / 5.** Only the Mon 6/29 edition exists (5 valid plays, Claude-true, critic-vetted, well-grounded).
- **Failed nights: YES — 3 consecutive (Tue 6/23 → Fri 6/26).** 22 failed cron runs with *"Claude returned no parseable plays."* Recovered via an off-window ~04:05 ET Fri build (grounded in Thursday's session, not Friday's close, because the evening cron no-op'd on idempotency).
- **Average generation time: ~61 min** (Claude synthesis + 40-candidate dossier fan-out).
- **Caveats:** recovery is one-edition-deep and unproven across a clean evening cycle; one orphaned `running` job (6/26) never reaped; grounding counts not persisted to `meta`. Tool is launch-gated, so the empty week was admin-only-visible. Keep #77 open until ≥2 clean cycles.

---

## Full Reports
All detailed reports at: `blackout-web/docs/api-audit/`
- Ranked roadmap: `SYNTHESIS.md` · Open issues: `OPEN-ISSUES.md` · Shipped: `IMPLEMENTATION_LOG.md`
- Daily error triage: `error-log.md` · CTO deep audit: `cto/cto-audit-20260629.md`
- Night Hawk: `services/night-hawk.md` · Security: `security/pentest-report.md` · Network: `network/https-monitor.md`

*Generated by the `weekly-digest` scheduled task. No secrets/keys/connection-strings printed. Commit stays LOCAL per cron-no-push policy — review and push to deploy.*
