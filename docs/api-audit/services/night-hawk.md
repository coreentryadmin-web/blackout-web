# Night Hawk — Deep End-to-End Audit
Last audit: 2026-06-30 ~08:00 ET (Tue, automated)
Last edition date: 2026-06-30 (session built evening of 2026-06-29)

## Overall Health: WARN

The flagship deliverable is intact: **last night's edition exists, is published, and carries 3
valid, Claude-generated, real-data-grounded plays.** Outcome recording and morning-confirmation
both work end-to-end. The WARN is driven by a newly-discovered operational defect: **an external
authenticated caller force-rebuilt the already-published edition 6× overnight** (00:12–03:38 UTC),
producing wildly non-deterministic output (3→5→0→1→3→1→3 plays) and, at 01:18 UTC, briefly
publishing a **zero-play recap-only edition**. The current served edition is fine, but the churn is
wasteful (6× Anthropic + UW spend) and risks replacing a good edition with a worse/empty one.

---

## Last Edition Status
- **Generated:** YES — `edition_for=2026-06-30`, published, `available:true`, `recap_only:false`.
- **Plays count:** 3 (ANET LONG/A, AVGO LONG/B, ORCL SHORT/B).
- **All plays valid:** YES — real tickers, real strikes, future expiries, grounded premiums.
- **On-time build:** ✅ First publish at **21:37:51 UTC (5:37 PM EDT)** — squarely in the 5:30 PM ET
  window. Full build (context → 40 dossiers → rank → synthesis → critic → publish) took **~7.5 min**.
  The #77 Claude-synthesis timeout fix (90s/maxRetries:1) is clearly working — synthesis returned
  parseable plays, unlike the 4 consecutive `stage_synthesis` failures 2026-06-22 → 2026-06-26.
- **Served `published_at`:** 03:38:13 UTC — **NOT the on-time build**; this timestamp is from the
  last of 6 overnight force-rebuilds (see Known Issues #1). The 21:37 edition was the correct one.

## Play Quality Verification
| Check | Result | Notes |
|---|---|---|
| Tickers are real | ✅ PASS | ANET, AVGO, ORCL — all liquid single-names |
| Strikes are real numbers | ✅ PASS | ANET $170C, AVGO $400C, ORCL $160P — no 0/9999 placeholders |
| Expiries are future dates | ✅ PASS | 2026-07-17, 2026-07-17, 2026-08-21 (all > 2026-06-30) |
| Thesis references real data | ✅ PASS | cites flow $/strike stacks, streak days, MA stack, max-pain, FCF — not generic |
| Direction is clear | ✅ PASS | LONG/LONG/SHORT |
| Premium cap enforced | ✅ PASS | entry prem $5.53 / $6.32 / $19.83 per-share — all ≤ $20/sh cap ($2k/contract) |
| Numeric grounding enforced | ✅ PASS | `NIGHTHAWK_GROUNDING_ENFORCE` defaults ON; plays grounded vs prefetched ATM±5% chain |

## Data Grounding
What live data feeds into generation (all fetched fresh at build, no hardcoding):
- **GEX / SPX desk:** `marketPlatform.spx.getSpxDeskSummary()` — recap shows SPX 7440.43 (+1.18%),
  VIX 18.89. Cache-reader path (no extra fan-out).
- **Flow alerts:** `getFlowTapeSummary({limit:30})` + market-wide flow (limit 450) → 40 candidates
  extracted from real stock_flows + hot_chains. Per-play theses cite real $ flow (e.g. AVGO $147.5M,
  $72.89M block into $410C).
- **Option chains:** `fetchEditionChains` prefetches ATM±5% front-two-expiry rows for the top 12;
  used for both the Claude prompt AND deterministic post-grounding (strike/premium validation).
- **SPX close:** 7440.43 — sourced live from desk, not hardcoded.
- **Fundamentals/technicals:** dossiers carry IV-rank, flow-streak, MA-stack, max-pain, FCF/margin.
- **Play-outcome feedback:** prior `fetchPlayOutcomeStats()` is fed into the prompt (learning loop).

⚠️ **Data discrepancy to verify (P2):** the edition recap recorded the 2026-06-29 SPX reading as
**7440.43**, but the 06-30 morning-confirm reports **prior_close = 7354.02** (and premarket 7440.43,
gap +86.4). The prior close on the 06-30 open should equal the 06-29 close. One of the two figures is
off by ~86 pts — likely the recap captured a live/after-hours last rather than the official close, or
morning-confirm's prior_close is a stale session. Worth confirming which surface is authoritative.

## Cron Health
- **NightHawk-Playbook** (`railway.nighthawk-playbook.toml`): schedule `*/15 21-23 * * 1-5` UTC,
  fire-and-forget HTTP trigger (`hit-cron.mjs /api/cron/nighthawk-edition`, no `force`). In-window
  fires 22:31–23:30 UTC behaved correctly (resumed the already-published job, no rebuild). ✅
- **NightHawk-Outcomes** (`railway.nighthawk-outcomes.toml`): dual-band `30 20,21 * * 1-5` UTC.
  Ran 20:32 + 21:32 UTC 2026-06-29 (`ok`); off-band fire self-skips. ✅
- **NightHawk Morning-Confirm** (`railway.nighthawk-morning-confirm.toml`): `15 13 * * 1-5` UTC.
  Ran 13:19 UTC 2026-06-30 (`ok`) — produced per-play CONFIRMED/DEGRADED status. ✅
- **Generation window:** correctly configured (default 17:30 ET, 120-min catchup; env hour/min unset
  → defaults). `NIGHTHAWK_EDITION_ENABLED=1`. `?force=1` override available. ✅
- ⚠️ **DISCORD_OPS_WEBHOOK_URL is UNSET** — every ops alert in the builder (hard-fail, anomalous
  recap-only, rescue, watchdog) is a silent no-op. A future dark-fail would not page anyone. The code
  logs LOUD as a fallback, but there is no active alerting channel. (P2)

## Outcomes Recording
- **Yesterday's outcomes recorded:** ✅ YES — all 5 plays of the 2026-06-29 edition resolved with
  real next-day OHLC: AAPL `stop`, AMAT `stop` (both target & stop hit intraday → conservative stop),
  HIMS `target`, MRK `target`, OKTA `target`.
- **This week's resolved win rate:** **3 target / 2 stop = 60%** (5 resolved). Pending: today's 3.
- **Today's plays:** ANET/AVGO/ORCL all `pending` (correct — 06-30 session not yet closed at 8am).
- The `nighthawk_play_outcomes` table upserts on each edition rebuild, so it reflects the final
  (03:38) 3-play set; intermediate overnight rebuilds churned this table too.

## Known Issues

### 1. (P1 — NEW) Overnight `?force=1` rebuild storm churns a good edition
- The edition published correctly at **21:37 UTC with 3 plays**, then was **force-reset and fully
  rebuilt 6 times** between 00:12–03:38 UTC. Job-log evidence (`nighthawk_job_log`, edition 06-30):
  `00:12 Force rebuild` → 5 plays, `01:13 Force rebuild` → **recap-only 0 plays**, `01:50` → 1 play,
  `02:08` → 3, `02:25` → 1, `03:27` → 3 (current). 323 log rows for one edition.
- **Source:** the calls hit the **cron route** (`/api/cron/nighthawk-edition?force=1`; the
  "build dispatched in background" message is route-only) with a valid Bearer secret. It is **NOT**
  the documented Railway cron: `hit-cron.mjs` never appends `force`, the Railway schedule is 21-23
  UTC only, and **no code in the repo constructs that URL with `force`** (grep-confirmed). nighthawk
  is deliberately excluded from `cron-dispatch.ts`, so it is not the watchdog self-heal or admin
  "Run now" either. The caller is external/undocumented — candidates: a Railway dashboard schedule
  override, an autonomous task holding `CRON_SECRET`, or a manual/loop caller. **Needs identification.**
- **Impact:** 6× redundant 40-dossier UW fan-out + 6× Claude synthesis/critic spend per night for
  zero user benefit; non-deterministic output means a good 5-play edition can be overwritten by a
  1-play or empty one; `published_at` is pushed to the small hours.
- **Defensive fix (independent of finding the caller):** make `force` refuse to reset an
  already-`published` edition once outside the edition window (or require an explicit second flag like
  `&allow_late=1`). Today `force=1` blindly resets any published row at any hour.

### 2. (P2) Synthesis/critic non-determinism
- Same inputs across the night yielded 0–5 plays. The critic occasionally rejects **everything**
  (01:18 recap-only). Recommend: never downgrade a published edition — if a rebuild yields fewer or
  zero plays than the currently-published row, keep the existing edition.

### 3. (P2) Ops alerting disarmed — `DISCORD_OPS_WEBHOOK_URL` unset (see Cron Health).

### 4. (P2) SPX close vs morning-confirm prior_close ~86-pt mismatch (see Data Grounding).

### Task #77 (cron failed / edition zeroing): **RESOLVED & holding.**
The synthesis-timeout root cause is fixed; the last 2 editions published with plays. The four
`stage_synthesis` failures (2026-06-22 → 06-26) predate the fix. No recurrence on 06-29/06-30.

## Recommendations
1. **(P1)** Identify and stop the overnight `?force=1` caller — check the Railway NightHawk-Playbook
   **dashboard** cronSchedule (may override the TOML's 21-23 window) and any service/task holding
   `CRON_SECRET`. Then add the window-guard so a published edition cannot be force-reset post-window.
2. **(P2)** Add a "no-downgrade" rule in `buildEveningEdition`: on a force rebuild, only overwrite if
   the new edition has ≥ the published play count (never replace plays with a recap-only).
3. **(P2)** Set `DISCORD_OPS_WEBHOOK_URL` so build failures, anomalous recap-only collapses, and
   watchdog escalations actually page.
4. **(P2)** Reconcile the SPX close figure between the edition recap and morning-confirm prior_close;
   ensure the recap stores the official session close, not a live/after-hours last.
5. **(P3)** Investigate the double-publish at 00:22 + 00:23 UTC (two `published` log entries 89s
   apart) — likely two overlapping background dispatches racing on the same job.

---
_Verification basis: read full pipeline source (cron route, edition-builder, claude-edition,
grounding, constants, worker, 3 TOMLs, serving + play-status routes, page); live-queried prod
Postgres (`nighthawk_editions`, `_jobs`, `_job_log`, `_play_outcomes`, `cron_job_runs`); live-hit
the edition + play-status APIs via apex host + Bearer. No secrets printed._
