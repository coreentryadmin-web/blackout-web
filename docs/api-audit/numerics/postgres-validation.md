# Postgres Numeric Integrity — Daily Audit
Last updated: 2026-06-29 (DB clock 2026-06-30 01:14 UTC)

## Overall Health: **PASS**

No real data-integrity defects found. Two checks tripped the SKILL's hard-coded
thresholds but both are **false positives** explained below (schema/units differ
from the SKILL's assumptions). All true integrity checks — null premiums, bad
timestamps, duplicate dedup keys, orphaned rows, P&L consistency — are clean.

> Note: the SKILL's column assumptions are stale vs the live schema. Actual
> mappings used: `flow_alerts.premium`→`total_premium`, `event_at`→`created_at`;
> `user_positions.entry_price`→`entry_premium`, `exit_price`→`exit_premium`
> (there is **no** `realized_pnl` column); `nighthawk_editions.plays_count`→
> `jsonb_array_length(plays)`, `edition_date`→`edition_for`, no `status` col.

## Flow Alert Integrity
| Check | Count | Status |
|---|---|---|
| Null/zero premium (`total_premium`) | 0 | ✅ |
| Bad timestamps (future / pre-2024) | 0 | ✅ |
| Duplicate alert_ids | 0 | ✅ |
| Flows "today" (CURRENT_DATE, UTC) | 0 | ⚠️ artifact — see note |
| Flows last 24h | 1,987 | ✅ healthy |
| Total flows | 14,815 | ✅ |
| Premium min / max | $200,000 / $72,540,000 | ✅ sane |
| Premium avg / median | $685,692 / $347,850 | ✅ in $10K–$10M band |

**`flow_today=0` is a UTC-date artifact, not a defect.** DB `NOW()` = 2026-06-30
01:14 UTC, so `CURRENT_DATE` already rolled to June 30 UTC — but it is still the
evening of June 29 ET. The most recent flow landed 2026-06-29 20:12 UTC (16:12 ET,
right at the cash close), 5.0h ago. The 1,987 flows in the trailing 24h confirm
ingestion is healthy. (24h == 48h count because the 24–48h window falls on the
closed weekend, Sat/Sun June 27–28.)

## Position Integrity (`user_positions`, 2 rows)
| Check | Count | Status |
|---|---|---|
| Null entry price (open) | 0 | ✅ |
| <=0 or null contracts | 0 | ✅ |
| Impossible entry premium (≤0 or >$1000) | 0 | ✅ |
| Orphaned positions (no user_id) | 0 | ✅ |
| Closed missing closed_at | 0 | ✅ |
| Closed missing exit_premium | 0 | ✅ |
| Future entry_date | 0 | ✅ |

> P&L math spot-check is N/A: `user_positions` has no stored `realized_pnl`
> column, so there is nothing to cross-check (P&L is computed at read time from
> `entry_premium`/`exit_premium`). Proxy check (closed rows have exit premium) passed.

## Largo Session Integrity
| Check | Count | Status |
|---|---|---|
| Empty sessions (no messages) | 1 | ✅ benign |
| Orphaned messages | 0 | ✅ |
| Stale sessions (>30d) | 0 | ✅ |

One empty session = a chat opened with no message sent. Harmless; not an
integrity violation.

## SPX Play Outcomes (`spx_play_outcomes`, 3 rows)
| Check | Value | Status |
|---|---|---|
| Total plays ever | 3 | ✅ (empty-table bug resolved) |
| Plays "today" (UTC) | 0 | ✅ (same UTC-rollover note) |
| "Impossible" entry prices (SKILL >500 rule) | 3 | ⚠️ **false positive** |
| P&L consistency (`pnl_pts` vs exit−entry) | 0 errors | ✅ |
| Outcomes | 3× `loss` | ℹ️ track-record note |

**The 3 "impossible entry prices" are a false positive.** `entry_price` here is
the **SPX index level**, not an option premium: observed range 7430.9–7435.05,
with `target` 7444.9–7449.05 and `stop` 7427–7432 — all in index points, and
internally consistent (target > entry > stop for LONGs). The SKILL's `>500`
ceiling assumes an option-premium scale and does not apply to SPX point-based
plays. No defect.

ℹ️ Separately worth flagging to product (not a data bug): all 3 recorded SPX
plays closed as `loss`. With only 3 outcomes this is not statistically
meaningful, but worth watching as the table fills.

## Night Hawk Editions (`nighthawk_editions`, 2 rows)
| Check | Value | Status |
|---|---|---|
| Most recent edition | 2026-06-30 (5 plays, published) | ✅ |
| Prior edition | 2026-06-29 (5 plays, published) | ✅ |
| Empty editions (0 plays) | 0 | ✅ |
| Total editions | 2 | ✅ |

## Table Sizes (live rows > 0)
| Table | Rows |
|---|---|
| api_telemetry_events | 791,343 |
| admin_audit_log | 59,550 |
| flow_alerts | 14,820 |
| cron_job_runs | 4,258 |
| nighthawk_job_log | 561 |
| open_flow_positions | 247 |
| flow_anomalies | 198 |
| largo_messages | 196 |
| spx_signal_observations | 108 |
| error_events | 79 |
| largo_sessions | 46 |
| market_regime | 32 |
| admin_incidents | 31 |
| users | 22 |
| coaching_alerts | 21 |
| nighthawk_play_outcomes | 12 |
| platform_meta | 11 |
| nighthawk_jobs | 6 |
| lotto_plays | 6 |
| spx_open_play | 3 |
| spx_play_outcomes | 3 |
| user_positions | 2 |
| nighthawk_editions | 2 |
| spx_signal_weight_reports | 2 |
| spx_signal_log | 2 |
| platform_briefs | 1 |
| push_subscriptions | 1 |

## P0 Issues Found
**None.** Every impossible-value check on correctly-mapped columns returned 0.
The two non-zero counts (`spx_bad_entry=3`, `flow_today=0`) are false positives
driven by the SKILL's stale unit/timezone assumptions, verified above.

## Recommendations
1. **Update this SKILL's hard-coded checks** to match the live schema, so future
   runs don't re-raise these false positives:
   - `flow_alerts`: use `total_premium` and `created_at` (not `premium`/`event_at`).
   - `user_positions`: use `entry_premium`/`exit_premium`; drop the `realized_pnl`
     math check (column doesn't exist).
   - `spx_play_outcomes`: drop or raise the `entry_price > 500` ceiling — entries
     are SPX **index points** (~7400), not option premiums. A meaningful check is
     `target`/`stop` ordering vs `entry_price` (currently consistent).
   - `nighthawk_editions`: use `jsonb_array_length(plays)` and `edition_for`.
   - "today" checks: compare against ET session date, not UTC `CURRENT_DATE`, to
     avoid the evening-UTC-rollover false zero.
2. **Track SPX play outcomes** as the table grows — 3/3 losses is noise at n=3 but
   the play-quality loop should be watched once n is larger.
3. **No psql on this host** — audit now runs via a Node `pg` script
   (`_pg_audit_tmp.mjs`); consider folding that into the SKILL.
