# BlackOut Daily Error Triage Log

> Automated morning triage of production Railway logs. Reads yesterday's logs across all services,
> categorizes errors, auto-fixes safe high-confidence issues, and flags the rest with a diagnosis.
> Append-only — newest run at the top.

---

## 2026-06-29 (Mon) Daily Error Triage

### Summary
- **New errors found:** 1 (UW **data** WebSocket stall — OPEN but no data for ~5h, market-hours outage)
- **Recurring errors:** 1 (Discord alerting blind — Day 3; this run the blind spot actually bit during RTH)
- **Auto-fixed:** 0 (the one critical finding is an upstream WS auth/subscription issue, not a safe <10-line code bug; the reconnect path is heavily guarded — see reasoning below)
- **Requires human attention:** 2 (HIGH: UW data-WS stall blocking SPX plays during RTH · HIGH: alerting blind spot let a real RTH staleness go undelivered)
- **Resolved / not re-observed:** 1 (the 06-28 options-socket reconnect storm — **0 hits** today; observability restored)
- **False alarms / known baseline:** 1 (nighthawk-outcomes + nighthawk-playbook daytime staleness — evening-only crons, expected at 10 AM ET)

First weekday run with markets open (Mon ~10 AM ET / 14:00 UTC). The headline is the item the 06-28 report told us to "re-check on Monday RTH" — and it is real and biting. No runtime exceptions, stack traces, `TypeError`/`ReferenceError`, OOM/heap, pool exhaustion, or unhandled rejections appeared in any service log. The REST crons returned **200 OK** with healthy payloads (uw-cache-refresh `refreshed=24/24`, flow-ingest `polled=100`), which is a key diagnostic — see below.

### New Errors (first occurrence)
| Service | Error | Count | Root Cause | Status |
|---|---|---|---|---|
| blackout-web | `[uw-socket] stall watchdog — OPEN but no data for 17937s … 18327s, reconnecting` | 27 distinct stall lines + **65** `multiplex connected — joining channels` reconnects in the 500-line tail | The **Unusual Whales data WebSocket** (`src/lib/ws/uw-socket.ts`, feeds `flow_alerts` / `market_tide` / `net_flow` / `interval_flow` / `off_lit_trades` / `trading_halts`) connected at container boot (deploy `5e9cf94` @ **07:40:53 UTC**), delivered data briefly, then went **completely silent** — `freshestUwMessageAt()` is frozen and the no-data counter climbs monotonically (17937→18327s ≈ **5.09h**) **straight through the 13:30 UTC market open**. The stall watchdog (`uw-socket.ts:361` `reconnectIfStalled`) fires every 30s, tears down and rejoins ("multiplex connected — joining channels", `uw-socket.ts:283`), but UW delivers **zero** messages after the rejoin, so the counter never resets. The reconnect logic is working **as designed**; the failure is upstream. **Key narrowing:** the UW **REST** crons succeed (`refreshed=24/24`, `polled=100`) → the UW API **key is valid**; the fault is isolated to **WS data delivery**, pointing at a WS subscription/keepalive/auth-frame that `joinActiveChannels` is not re-establishing after reconnect (UW silently dropping the channel sub server-side), **not** a UW-wide outage. No `401/403/auth/token` lines — socket reports OPEN and joins cleanly, just receives nothing. **Cascade:** `flow_data_age_ms: 584538` (~9.7 min stale) → `[spx-play-gates] halt channel stale — failing OPEN` + `[spx-play-engine] entry gates blocked: "Flow data stale (10m) — tape and 0DTE signals unreliable"` → **SPX plays cannot open during RTH** (this is the [[project_spx_plays_never_open]] / [[project_pending_items]] Monday-RTH verification item, now failing for a *data* reason). | ⚠️ HIGH — HUMAN, upstream WS auth/subscription |

### Recurring Errors (seen before, not yet fixed)
| Service | Error | Days Recurring | Escalation |
|---|---|---|---|
| blackout-web / Cron-Staleness-Watchdog | Discord alerting blind (`DISCORD_OPS_WEBHOOK_URL` unset) — this run the watchdog logged `problems=8 rth_stale=5 … alert_delivered=false` during market hours | **3** (06-27 → 06-29) | **HIGH (escalated).** Per triage policy a 3+ day recurrence is HIGH, and today it stopped being theoretical: at 13:41 + 14:00 UTC the watchdog detected **5 RTH-stale crons** (flow-ingest, uw-cache-refresh, nights-watch-warm, heatmap-warm, grid-warm) — a genuine market-hours data event correlated with the UW-WS stall — and `alert_delivered=false`. The safety net was off at the exact moment it was needed. Set `DISCORD_OPS_WEBHOOK_URL` in the blackout-web Railway env. |

### Auto-Fixed This Run
| Error | File | Fix Applied | Commit |
|---|---|---|---|
| _none_ — the UW-WS stall is an upstream auth/subscription failure (REST works, WS delivers nothing after a clean rejoin); not a mechanical <10-line code bug. `uw-socket.ts` reconnect/teardown carries deliberate identity-guards (lines 296-327, 101-128) — blindly editing it risks clobbering the live socket. Correct fix is config/upstream investigation, not an autonomous code change. | — | — | — |

### Requires Human Attention
| Error | Severity | Why It Needs Human | Suggested Fix |
|---|---|---|---|
| UW **data** WebSocket OPEN but delivering no data for ~5h through market open → flow/halt/tide/net-flow all stale → SPX play gates block all entries | **HIGH** | Live market-hours data outage on the primary tape feed; blocks the product's headline feature (SPX plays) and corrupts any flow-derived signal. REST works so it's not a key revocation — needs eyes on the WS handshake. Not safely auto-fixable. | (1) Confirm whether `joinActiveChannels` re-sends UW's expected **auth + channel-subscribe** frames after a reconnect, or assumes the prior auth persists — UW typically requires (re)subscribe per connection. (2) Check whether UW rate-limited/closed the data WS for this container (5 replicas may each hold a WS; cf. [[reference_blackout_api_scaling]] 2 RPS cluster-wide). (3) Verify the UW **WS** token/entitlement vs the REST key. (4) Consider a "no-data-since-connect after N reconnects" escalation (alert + optional process-level resubscribe) so a silent-but-OPEN socket self-reports instead of looping for 5h. A `railway redeploy --service blackout-web` is the fast operational mitigation to re-establish the feed. |
| Watchdog `alert_delivered=false` on a real RTH staleness (5 stale crons) — Discord webhook still unset (Day 3) | **HIGH** | The detect-and-alert pipeline is detect-only; a genuine market-hours outage today produced no notification. Cannot be fixed in code (I don't hold the webhook URL). | Set `DISCORD_OPS_WEBHOOK_URL` (and/or `DISCORD_PLAY_WEBHOOK_URL`) in the blackout-web Railway service env. Until then every cron failure / RTH staleness is silent. |

### Needs Verification (medium — could be downstream of the WS stall)
| Item | Note |
|---|---|
| Watchdog `rth_stale=5` keys: `flow-ingest, uw-cache-refresh, nights-watch-warm, heatmap-warm, grid-warm` first flagged 13:41 UTC (post-open) | These crons return 200 OK when they run, so the staleness is most likely **downstream** of the UW-WS stall (their warmed caches depend on the silent feed) rather than 5 independent missed runs. Verify each executed since 13:30 UTC (`railway logs` per service) and whether their freshness key is fed by the WS. If they ran but data is stale → confirms the WS is the single root cause. |

### False Alarms / Known Baseline
| Item | Why it is benign |
|---|---|
| Watchdog `problems` includes `nighthawk-outcomes` + `nighthawk-playbook` on **every** daytime tick | Both are **evening-only** crons (publish 21-23 UTC weekdays). At 14:00 UTC their last run was last evening, so daytime "staleness" is the expected baseline, **not** a generation failure. Re-confirm tonight's run actually publishes; only escalate if it misses the evening window. |

### Resolved / Not Re-Observed
- **options-socket reconnect storm** (06-28 HIGH, code 1006 auth-never-completing, was 496/500 lines): **0 hits** today. Either resolved or quiet — buffer is no longer saturated, so `blackout-web` observability is restored this run. Re-watch; it was an entitlement/endpoint hypothesis that may recur.

### Services With No Errors
- **Flow-Ingest-Cron** — `/api/cron/flow-ingest -> 200`, `ok=true ingested=0 polled=100` (REST path healthy; 0 ingested is the WS-vs-REST split, not a fault)
- **UW-Cache-Refresh-New** — `/api/cron/uw-cache-refresh -> 200`, `ok=true refreshed=24 total=24`
- **Cron-Staleness-Watchdog** — running every ~20m, `200 OK`, `error_count=0 error_spike="none"` (it is *detecting* correctly; the failure is delivery, see above)
- **NightHawk-Playbook** — no log output (evening-only worker; idle mid-morning, as expected)

### Triage Notes
- **Diff vs 2026-06-28:** options-socket storm **gone** (observability restored). UW **data**-WS stall is **net-new** and is the first *market-hours* data outage this log has captured — it is the realization of the 06-28 "re-check Monday RTH" flag. Discord-unset carried over to **Day 3** and escalated from theoretical to actually-bit. db-cleanup staleness (06-28) not re-checked this run (RTH buffer dominated by uw-socket).
- **Top priority before user is active:** (1) restore the UW data feed (operational: redeploy blackout-web to re-handshake; root-cause: WS resubscribe/auth path) — it is blocking SPX plays *right now*; (2) set the Discord webhook so the next outage actually pages.
- The "5 hours" duration is authoritative (computed in-message as `now - freshestMessageAt` at log time, 18327s); the "~09:00 UTC start" is inferred from the 07:40 deploy + buffer position.
- No secrets were printed; no log line contained a credential value requiring redaction. `RAILWAY_TOKEN` was loaded into env only, never echoed.

---

## 2026-06-28 (Sun) Daily Error Triage

### Summary
- **New errors found:** 2 (options-socket reconnect storm · db-cleanup tipped stale)
- **Recurring errors:** 2 (Discord alerting unset — Day 2 · nighthawk-playbook weekend staleness — Day 2)
- **Auto-fixed:** 0 (no finding met the safe / <10-line / clear-code-bug / non-breaking bar — every item is env-config, watchdog calibration, or needs-verification)
- **Requires human attention:** 3 (HIGH: options WS reconnect storm + observability blackout · HIGH: alerting blind spot Day 2 · MEDIUM: db-cleanup possible missed run)
- **False alarms identified:** 1 (nighthawk-playbook weekend staleness — expected on a Sunday)

No runtime exceptions, stack traces, `TypeError`/`ReferenceError`, OOM/heap, connection-pool exhaustion, or unhandled rejections appeared in any service log. The RTH crons that ran (flow-ingest, uw-cache-refresh, cron-staleness-watchdog) all returned **200 OK** with healthy payloads. Today is a **Sunday** — markets closed — so weekday-only/evening crons are legitimately idle.

> ⚠️ **Observability caveat:** **496 of 500** lines in the `blackout-web` log tail are `[options-socket] shard 0 reconnect` warnings (~4/min). The reconnect storm has **saturated the log buffer** — any other `blackout-web` error older than ~2 minutes is pushed out of the 500-line tail and is invisible to this triage. The clean-looking web log below is therefore a *floor*, not a guarantee. Yesterday's heatmap-pagination / 0-contracts market-data warnings could not be re-confirmed for this reason (buffer drowned, not necessarily resolved).

### New Errors (first occurrence)
| Service | Error | Count | Root Cause | Status |
|---|---|---|---|---|
| blackout-web | `[options-socket] shard 0 connected (1 contracts)` → `reconnect in 60000ms (code=1006, failures=822…883)` | 496 lines (~4/min, **~14h+ continuous**; counter climbed 822→883 in this window) | The shared Massive **options** WebSocket (Night's Watch live marks, `OPTIONS_WS_ENABLED`) connects with 1 held contract, sends `auth`, then the server drops it with **code 1006 (abnormal close, no frame)** before `auth_success`. The `consecutiveFailures` counter **never resets** (reset only fires on `auth_success`, `options-socket.ts:405-406`) → auth is **never** completing. Pattern matches an entitlement/endpoint/key-class problem, not transport flakiness: most likely the key lacks an **options** WS entitlement (cf. the GEX note that `POLYGON_API_KEY` must be a *Massive* key), or `OPTIONS_WS_URL` is wrong. **Fails safe** — `getLiveOptionMark` ages out to the REST snapshot, so valuation is unaffected; the harm is (a) log saturation killing observability and (b) a 60s reconnect hammer for 14h+. | ⚠️ HUMAN — config/entitlement |
| Cron-Staleness-Watchdog / blackout-web | `problems=2 problem_keys=["nighthawk-playbook","db-cleanup"]` — **db-cleanup** is newly stale (only nighthawk was flagged yesterday) | 4 (every watchdog tick 13:01–14:00 UTC) | `db-cleanup` runs **nightly ~3 AM ET**, `stale_after_min: 36h`, **no** `weekdays_only`. For it to tip stale by Sun ~10 AM ET, the last logged success is >36h ago → the **Saturday ~3 AM ET run appears missing/unlogged** (Fri 3 AM was ~31h old on Sat morning, so it only crossed the 36h line today). Could be a genuine missed run **or** an SDLC-redeploy churning the `cron_job_runs` heartbeat (see `reference_railway_cron_health_reading`). `rth_stale=0` — not a market-hours outage. | ⚠️ HUMAN — verify last run |

### Recurring Errors (seen before, not yet fixed)
| Service | Error | Days Recurring | Escalation |
|---|---|---|---|
| blackout-web | `[notify] ops alert DROPPED — neither DISCORD_OPS_WEBHOOK_URL nor DISCORD_PLAY_WEBHOOK_URL is set` → `ALERT NOT DELIVERED for 2 stale/failed cron(s)` | **2 days** (since 2026-06-27) | **HIGH** — alerting has now been blind for 2 consecutive days. Every cron problem (incl. any real RTH outage Monday) will be silently dropped. One day short of the 3-day auto-escalation threshold; treat as HIGH now given it is the safety net itself. |
| Cron-Staleness-Watchdog | `problem_keys` includes `nighthawk-playbook` (weekday-evening worker flagged stale off-window) | **2 days** | **LOW / FALSE ALARM** — expected. `nighthawk-playbook` is `weekdays_only`, 5:30 PM ET; the 2.5× weekend multiplier (→10h) cannot cover a 2-day weekend gap, so it false-positives every Sat/Sun morning. Not a generation failure. Calibration item, not an outage. |

### Auto-Fixed This Run
| Error | File | Fix Applied | Commit |
|---|---|---|---|
| _none — no finding met all safe-auto-fix criteria (clear code root-cause, <10 lines, non-breaking, reversible, tsc-clean). The options-socket root cause is config/entitlement (not a code bug), the watchdog weekend calibration is a deliberate-threshold behavior change that risks masking a real Friday-night miss, db-cleanup needs ground-truth verification, and Discord/OPTIONS_WS are env vars I don't hold._ | | | |

### Requires Human Attention
| Error | Severity | Why It Needs Human | Suggested Fix |
|---|---|---|---|
| **options-socket reconnect storm** (code=1006 × 883, auth never completes) + it has **blacked out blackout-web observability** | **HIGH** | Not a code bug — the reconnect/backoff logic is behaving correctly in response to an upstream rejection. Root cause is an options **WS entitlement / endpoint / key-class** question I can't resolve from logs, and the mitigation is an env decision. Per `project_nights_watch`, Night's Watch valuation is to be rebuilt as a cache-reader, so the live-WS-marks path may be premature in prod. | **Fastest:** set `OPTIONS_WS_ENABLED=0` on `blackout-web` until the Massive **options** WS entitlement is confirmed — stops the storm and restores log visibility immediately (REST snapshot already covers valuation). **Then:** confirm `POLYGON_API_KEY`/`MASSIVE_API_KEY` is entitled for the options Q feed and that `OPTIONS_WS_URL` (`wss://socket.massive.com/options`) is correct. If kept on, throttle the reconnect `console.warn` after N failures so it can't saturate the buffer (`options-socket.ts:299-301`). |
| **Discord alerting unconfigured** → all cron alerts silently dropped (**Day 2**) | **HIGH** | Cannot be fixed in code and I don't hold the webhook URL. With both `DISCORD_OPS_WEBHOOK_URL` and `DISCORD_PLAY_WEBHOOK_URL` unset, **any real cron failure or RTH staleness goes completely unnoticed** — and Monday is the next RTH session (per pending-items, SPX-play-open / signal-panel verification is due then). | Set `DISCORD_OPS_WEBHOOK_URL` (and/or `DISCORD_PLAY_WEBHOOK_URL`) on the `blackout-web` Railway service before Monday open. Until then the watchdog is detect-only. |
| **db-cleanup** stale — possible missed Saturday ~3 AM ET run | **MEDIUM** | Needs ground-truth: query `cron_job_runs` for the last `db-cleanup` success. If genuinely missed, it's an unattended-table-growth risk; if it ran but the heartbeat wasn't written, it's a recording artifact from SDLC redeploy churn (known false-#90 source). Either way it's a verify-before-fix, not a blind code change. | Check `SELECT * FROM cron_job_runs WHERE job_key='db-cleanup' ORDER BY ran_at DESC LIMIT 5` on prod Postgres. If last success >36h: trigger `/api/cron/db-cleanup` manually and confirm the nightly trigger fired. If it ran but didn't log: the heartbeat write in the db-cleanup route needs hardening. |

### Services With No Errors
- **Flow-Ingest-Cron** — `/api/cron/flow-ingest → 200`, `ok=true ingested=0 polled=100` (clean; 0 ingested expected on a Sunday off-session)
- **UW-Cache-Refresh-New** — `/api/cron/uw-cache-refresh → 200`, `ok=true refreshed=24 total=24` (all 24 refreshed)
- **Cron-Staleness-Watchdog** — `/api/cron/cron-staleness-watchdog → 200`, `checked=21 rth_stale=0` every tick (the 2 `problems` are the weekend nighthawk false-positive + the db-cleanup verify item above; **no** market-hours outage)
- **NightHawk-Playbook** — no log output (evening-only `weekdays_only` worker; idle Sat/Sun, as expected — last edition was Friday evening)

### Triage Notes
- **Diff vs 2026-06-27:** options-socket storm is **net-new** in today's tail (yesterday's web log was not dominated by it); db-cleanup **newly** tipped stale (crossed 36h overnight). Discord-unset and nighthawk weekend-staleness **carried over** (Day 2). Yesterday's heatmap-pagination + 0-contracts market-data warnings were **not re-observed** — but the options-socket buffer saturation means *absence is not confirmation of resolution*; re-check on Monday RTH.
- **Top priority before Monday open:** (1) silence the options-socket storm to restore observability, (2) set the Discord webhook so Monday's RTH verification (SPX-play opens / signal panel) is actually alertable.
- No secrets were printed; no log line contained a credential value requiring redaction. `RAILWAY_TOKEN` was loaded into env only, never echoed.

---

## 2026-06-27 (Sat) Daily Error Triage

### Summary
- **New errors found:** 4 (first log — no prior baseline)
- **Recurring errors:** 0 tracked (this is the first run; baseline established)
- **Auto-fixed:** 0 (no findings met the safe/<10-line/clearly-code-bug bar — all are env-config or judgment-call behavior changes)
- **Requires human attention:** 2 (HIGH: alerting blind spot · MEDIUM: heatmap pagination truncation)
- **False alarms identified:** 2 (nighthawk weekend staleness · GEX 0-contracts on a non-trading Saturday)

No runtime exceptions, stack traces, OOM, connection-pool exhaustion, or unhandled rejections appeared in any service log. RTH crons (flow-ingest, uw-cache-refresh, cron-staleness-watchdog) all returned **200 OK** with healthy payloads.

### New Errors (first occurrence)
| Service | Error | Count | Root Cause | Status |
|---|---|---|---|---|
| blackout-web | `[notify] DISCORD_OPS_WEBHOOK_URL not set` → `ops alert DROPPED` → `ALERT NOT DELIVERED for 1 stale/failed cron(s)` | 3 lines (1 cascade) | Neither `DISCORD_OPS_WEBHOOK_URL` nor `DISCORD_PLAY_WEBHOOK_URL` is set in prod → the watchdog detected a problem but had nowhere to deliver the alert. **Alerting is effectively blind.** | ⚠️ HUMAN — env config |
| Cron-Staleness-Watchdog | `problems=1 problem_keys=["nighthawk-playbook"]` | 1 | `nighthawk-playbook` has `stale_after_min: 240` (4h) but runs **weekdays 5:30 PM ET only**. On a Saturday-morning check (~10 AM ET) the last run was Friday 5:30 PM ET (~16h ago) → flagged stale. **Generation did NOT fail — this is a weekend/overnight false positive.** (`src/lib/cron-registry.ts:66`) | ℹ️ FALSE ALARM — see note |
| blackout-web | `[polygon-gex] fetchHeatmapBand(I:SPX) truncated: hit 16-page guard with next_url still set — chain incomplete, walls/OI/IV understated` | 1 | The I:SPX option-chain paginator stops at a 16-page guard while `next_url` is still set, so heatmap walls / OI / IV are computed from an incomplete chain and understated. Data-correctness concern. | ⚠️ HUMAN — judgment call |
| blackout-web | `[polygon-gex] 0 I:SPX contracts for 2026-06-27 @ 7354.02 via api.massive.com — GEX walls will be empty` | 1 | massive.com returned 0 I:SPX contracts for **2026-06-27 (a Saturday, non-trading day)**, so the GEX path fell back to `greek-exposure/strike` cumulative (805 strikes, succeeded). 0 contracts for a non-session date is plausibly expected weekend behavior, not necessarily a key/access fault. Low confidence. | ℹ️ LIKELY BENIGN — re-check on a weekday |

### Recurring Errors (seen before, not yet fixed)
| Service | Error | Days Recurring | Escalation |
|---|---|---|---|
| _none — first run, no baseline_ | | | |

### Auto-Fixed This Run
| Error | File | Fix Applied | Commit |
|---|---|---|---|
| _none — no finding met all safe-auto-fix criteria (clear code root-cause, <10 lines, non-breaking, reversible, tsc-clean). All findings are env-var config or behavior-policy changes._ | | | |

### Requires Human Attention
| Error | Severity | Why It Needs Human | Suggested Fix |
|---|---|---|---|
| Discord alerting unconfigured → all cron alerts silently dropped | **HIGH** | Cannot be fixed in code and I don't hold the webhook URL value. With both `DISCORD_OPS_WEBHOOK_URL` and `DISCORD_PLAY_WEBHOOK_URL` unset, **any real cron failure or RTH staleness goes completely unnoticed** — the safety net is off. | Set `DISCORD_OPS_WEBHOOK_URL` (and/or `DISCORD_PLAY_WEBHOOK_URL`) in the blackout-web Railway service env. Until then the watchdog is detect-only. |
| Heatmap I:SPX chain truncated at 16-page guard → walls/OI/IV understated | **MEDIUM** | Raising the page guard or switching to full pagination increases UW/Polygon API cost and latency — a deliberate trade-off, not a mechanical fix. Touches the GEX data contract. | Decide between (a) raising the page guard, (b) paginating fully with a hard cap + telemetry on truncation rate, or (c) accepting understatement and surfacing a "partial chain" flag in the heatmap. Located in the polygon-gex `fetchHeatmapBand` path. |
| Watchdog over-flags `nighthawk-playbook` on weekends/overnight | **LOW (P3)** | The 4h `stale_after_min` for a weekday-evening-only cron means every weekend morning and every weekday before 5:30 PM ET trips a (false) stale alert. Making the staleness window schedule-aware is a behavior change >10 lines — not a safe blind auto-fix. | Make `stale_after_min` schedule-aware for `nighthawk-playbook`: skip Sat/Sun and don't enforce until after the evening publish window. Matches the prior #77 hardening intent (catch a *missed weekday* night) without crying wolf overnight/weekends. |

### Services With No Errors
- **Flow-Ingest-Cron** — `/api/cron/flow-ingest → 200`, `ok=true ingested=0 polled=100` (clean; 0 ingested expected off-session)
- **UW-Cache-Refresh-New** — `/api/cron/uw-cache-refresh → 200`, `ok=true refreshed=24 total=24` (all 24 refreshed)
- **Cron-Staleness-Watchdog** — `/api/cron/cron-staleness-watchdog → 200`, `checked=16 rth_stale=0` (the 1 problem is the benign nighthawk weekend false-positive above)
- **NightHawk-Playbook** — no log output (evening-only worker; idle on Saturday morning, as expected)

### Triage Notes
- This is the **first run** of daily error triage — no prior `error-log.md` existed, so there is no recurring-error baseline yet. Subsequent runs will diff against this entry.
- The two HUMAN items (Discord webhook, heatmap pagination) and the LOW watchdog item are **not** tracked in `docs/api-audit/OPEN-ISSUES.md` as of 2026-06-27 07:15 ET — they are net-new from log analysis.
- No secrets were printed; no log line contained a credential value requiring redaction.
