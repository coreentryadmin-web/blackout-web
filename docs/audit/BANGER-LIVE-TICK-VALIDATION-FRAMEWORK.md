# Banger live-tick-log validation framework (2026-09-27, phases 3-4)

**Status: framework built AND made admin-visible/always-on (phase 4). Live coverage not yet
accumulated. No production behavior changed, no exit-rule tuning. No exit candidate recommendation
changes from `BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md`'s own conclusion (don't ship
100/33/70 — the historical Polygon-reconstruction study found +0.3pp, CI spans zero). This
document is about HOW a future session (or an admin, on demand) re-tests that conclusion against
better data, not a new conclusion itself.**

## Why this exists

`BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md` (phase 2) found the cleaned 100/33/70 Banger
exit candidate's headline edge (+26.3pp) does not survive tick-level NBBO verification once
Polygon's **archived** `/v3/quotes` tape is used as ground truth (+0.3pp, CI `[-2.4, +2.9]`,
spans zero) — but also found, with direct evidence (AVAV id=39), that the archived tape can
genuinely disagree with what production's own live poll actually saw at the exact instant it
made a decision. There is no way to retroactively recover the real bid/ask production's live
poll saw for a position that already closed before this was discovered — it was never persisted.

PR #5522 closed that gap **prospectively**: `banger_quote_tick_log` (migration 015) now persists
the exact same snapshot data (`bid`/`ask`/`last_trade`/`raw_mark`/`reliable_mark`)
`banger-live-sync`'s real cron already fetches, every tick, going forward — fire-and-forget,
never on the decision path (`src/lib/banger/quote-tick-log.ts`).

This document + the scripts it describes are the **framework** that turns that log into a
trustworthy validation once enough real, live-captured observations exist. It does not itself
change any recommendation — a fresh table has almost no data the day it's created, and this
framework says so honestly rather than forcing a verdict out of a handful of rows.

## What was built (this session, 2026-09-27)

| Component | Purpose |
|---|---|
| `src/lib/banger/quote-tick-log.ts` (`fetchBangerQuoteTicksForContract`, `fetchBangerQuoteTickCoverage`) | Read accessors for the log — a per-contract tick series, and a cheap per-contract aggregate (count/first/last tick) across every contract the log has ever seen. |
| `GET /api/admin/banger/quote-tick-export` | Admin-gated export route exposing both of the above (`?occ=` for detail, coverage by default) — mirrors `admin/banger/closed-export` and `admin/swing/closed-position-snapshots`' own conventions. Read-only. |
| `scripts/audit/lib/banger-live-tick-coverage-eval.mjs` | Pure: maps a DB tick row to the replay engine's `{t, mark, bid}` shape; assesses whether ONE closed position's logged ticks actually span its real lifecycle with no dangerous interior gap (`FULL` / `PARTIAL_START` / `PARTIAL_END` / `PARTIAL_BOTH` / `GAPPY` / `NONE`); aggregates a population into a readiness report gated on the same n≥30 floor this toolkit already uses elsewhere (`helix-score-signal.mjs`, `swing-score-calibration.mjs`); projects an ETA to readiness from the **observed** rate of new full-coverage closes (never a guessed one — returns `null`, not `Infinity`/`NaN`, when the rate can't yet be measured). 22 unit tests. |
| `scripts/audit/lib/banger-tick-verdict-agg.mjs` | Pure: the same win-rate/expectancy/profit-factor/equity-curve/mean-delta-with-CI aggregation the phase-2 study used, applied to live-tick-log-sourced trade rows. Reuses `meanDeltaCi`/`equityCurveStats` from `banger-exit-headtohead-eval.mjs` unmodified — only the thin, row-shape-specific glue is separate (documented why: isolation from an unrelated script, same reasoning that script's own header already gives for not reusing `aggregateHeadToHead`). 5 unit tests. |
| `scripts/audit/banger-live-tick-validation.mjs` | Orchestrates the above against real (once deployed) admin routes: builds a readiness report every run; computes the actual CONTROL-vs-CANDIDATE verdict (via the SAME oracle-tested `replayPairTick` from `banger-quote-tick-replay-eval.mjs`, phase 2) only once population clears the floor. |

## How readiness is assessed (no tuning against thin data)

For every closed banger position since the log's own **discovered** start date (the earliest
tick timestamp across every contract the log has ever seen — discovered from the data itself,
never a hardcoded date, so this framework stays correct no matter when it's next run):

1. Cheap pre-filter using only the aggregate coverage scan: does this position's contract have
   ANY logged coverage whose `[first_tick_at, last_tick_at]` envelope overlaps its own
   `[committed_at, closed_at]` window (± a 25-minute edge tolerance)? A position that fails this
   is provably `NONE` — skipped before any per-tick fetch.
2. For positions that pass, fetch the real per-tick detail and classify:
   - `FULL`: the first tick lands within 25 minutes of entry, the last tick within 25 minutes of
     exit, AND no consecutive-tick gap exceeds `cadenceMinutes × 3` (default 5min × 3 = 15min,
     confirmed against the real deployed cron schedule as of phase 4 — tolerates one missed cron
     cycle, not a real outage; an ordinary overnight/weekend session-boundary gap is separately
     exempted regardless of size — see phase 4 below).
   - `PARTIAL_START` / `PARTIAL_END` / `PARTIAL_BOTH`: an edge is missed, but no interior gap.
   - `GAPPY`: an interior gap large enough to have silently missed the exact tick that decided
     the outcome — takes priority over edge classification, since a hidden interior gap can hide
     the ONE tick that mattered even when both edges look fine.
   - `NONE`: zero coverage at all (the position closed before the log started, or coverage
     doesn't overlap even loosely).
3. Only `FULL` rows count toward the `n≥30` floor. The floor is never lowered to manufacture a
   bigger "ready" population, and the edge/gap tolerances are never tightened after the fact to
   shrink it either — they're fixed, documented constants.

## Phase 4 (2026-09-27): made admin-visible and always-on, plus two real bugs found and fixed

The operator's phase-4 directive was explicit: verify the log is actually collecting what the
study needs, confirm readiness is detected AUTOMATICALLY rather than depending on someone
remembering to run a script, add safeguards against bad data, and give an admin-visible READY /
NOT_READY status. This phase ported the pure phase-3 logic from `scripts/audit/lib/*.mjs` into
typed, in-process TypeScript modules and wired them into a new admin route:

| Component | Purpose |
|---|---|
| `src/lib/banger/quote-tick-readiness.ts` | TS port of `banger-live-tick-coverage-eval.mjs` — `assessTickQuality`, `assessPositionCoverage`, `coverageEnvelopeOverlaps`, `buildReadinessReport`, `buildEligibilityReadiness`, `projectDaysToReadiness`, `isLegitimateSessionBoundaryGap`. 31 unit tests. |
| `src/lib/banger/quote-tick-verdict.ts` | TS port of `banger-quote-tick-replay-eval.mjs` + `banger-tick-verdict-agg.mjs` — `replayTickState`, `replayPairTick`, `crossCheckScaledFlag`, `median`, `equityCurveStats`, `meanDeltaCi`, `aggregateVerdict`. `CONTROL_RULES` asserted byte-identical to production's real `SCALE_OUT_RULES` in its own test. 16 unit tests. |
| `GET /api/admin/banger/quote-tick-validation-status` | The admin-visible status endpoint (directive point 6). Fetches closed positions + their tick logs, classifies each, and returns eligible positions, rejected positions + reasons, tick-coverage breakdown, and — **only once `n≥30` eligible positions exist** — the real CONTROL and CANDIDATE results (MODEL and EXEC fill tracks). Computed fresh, in-process, on every call: no caching, no stale snapshot, no manual script run required to get a current answer. |

### Bug 1: the interior-gap check was RTH-unaware, and would have permanently starved this study

`banger-live-sync`'s real deployed schedule (confirmed via `cron-registry.ts`'s
`schedule_cron_utc`) is `*/5 11-21 * * 1-5` — every 5 minutes, 11:00-21:00 UTC, Monday-Friday,
**market hours only**. A Banger position routinely holds for several DTE days. Between every
trading session it has a genuine ~17.5-hour overnight gap (and a ~65-hour weekend gap) with zero
ticks logged, because the cron simply doesn't run then. The phase-3 `assessPositionCoverage`
classified any tick-to-tick gap over `cadenceMinutes × 3` as an abnormal outage using **raw
wall-clock minutes**, with no exemption for this — meaning every multi-day position would have
been flagged `GAPPY` forever, regardless of how much real tick data it had, and the `n≥30` floor
could never be reached by any position held longer than one session day.

**Fixed** (`isLegitimateSessionBoundaryGap` in `quote-tick-readiness.ts`): an interior gap is only
checked against the cadence ceiling when it falls within one ET trading session. A gap that
crosses to the very next REAL ET trading day — using the app's own real `todayEt`/`isTradingDayEt`
(holiday-aware) — is expected and exempt. A gap that skips one or more full trading days with zero
ticks logged on them is still a real outage and is still flagged. The legacy
`scripts/audit/lib/banger-live-tick-coverage-eval.mjs` got the same fix (`isLegitimateWeekend
OrOvernightGap`), but deliberately narrower — weekend/overnight only, not holiday-aware, since
duplicating a multi-year NYSE holiday calendar into a standalone script not on the authoritative
path isn't worth the permanent-sync burden (see that function's own header). Also corrected:
`cadenceMinutes`'s default (both the TS port and the legacy script's own `--cadence-minutes` CLI
flag) was an unverified guess of 20 minutes; the confirmed real value is 5.

### Bug 2 (design gap, not yet a bug in production): no duplicate-tick or stale-quote safeguard

`banger_quote_tick_log` has no unique constraint on `(contract_occ, polled_at)`, so a racing or
retried cron invocation could in principle log two rows at the same instant. If their marks
disagree, replaying both blindly is a real contamination risk — the replayed state machine would
see fabricated tick-to-tick movement that never happened. **Fixed**: `assessTickQuality` dedupes
same-timestamp rows (later `id` wins when they agree) and, when they disagree by more than a cent,
flags the position `DUPLICATE_CONFLICT` and excludes it from `FULL` rather than silently picking a
value. Separately: `reliableMarkFromQuote`'s backstop-quote-divergence guard (PR #4969) firing on
more than half a position's ticks (`BACKSTOP_HEAVY_RATIO = 0.5`) means the replay would be riding
on last-trade fallback marks, not real two-sided quotes, for most of the position's life — flagged
`BACKSTOP_HEAVY`, also excluded from `FULL`.

### Safeguard 3: the "partial fill" cross-check (directive point 5)

Even a `FULL`-coverage tick series can still miss a real partial fill that happened between two
polls, at a price the log never captured. `crossCheckScaledFlag` (`quote-tick-verdict.ts`)
compares the replayed CONTROL state machine's own `scaled` boolean against the REAL recorded
`banger_positions.scaled_already` column for that trade. A disagreement means the reconstructed
trade is not the same trade that actually happened — the position is excluded from the eligible
population (`buildEligibilityReadiness`) even though its raw tick coverage looked clean. This is a
gate SEPARATE from tick-quality coverage (`buildReadinessReport`), by design: they answer different
questions ("is the log dense/clean enough" vs "does the replay agree with the real recorded
outcome"), and conflating them into one bucket would have hidden which check actually failed.

### How "automatic n≥30 detection" actually works (directive point 3)

The admin route computes eligibility fresh on every call — there is no cron that "detects" n=30
and fires an alert; instead, whoever/whatever calls `GET /api/admin/banger/quote-tick-validation-
status` gets a live, self-computing answer that is automatically correct the moment the real
population crosses 30 eligible positions, with no code change, cache invalidation, or manual
re-run required to make that transition visible. What is NOT automatic: nothing currently polls
this route on a schedule and pushes a notification when it flips to `READY`. Wiring that (e.g. a
cron matching the existing Discord-notify pattern other audit crons use) is a natural follow-up,
not yet built — see "What a future session should do" below.

## What a future session (or an admin, right now) should do

**Primary: hit the admin route directly, any time, for a live answer:**

```
GET /api/admin/banger/quote-tick-validation-status?days=180&minN=30
```

(admin-gated, same auth as every other `/api/admin/*` route). Returns `study.status` (`READY` /
`NOT_READY`), `study.eligibleN`/`shortfall`/`projectedDaysToReady`, `tickCoverage.byBucket`,
`eligiblePositions`/`rejectedPositions` (each with its exact rejection reason), and — only when
`study.ready === true` — `control`/`candidate` results on both fill tracks.

**Secondary: the offline CLI script**, useful when independent re-verification outside the running
app is wanted (e.g. no admin session available, or cross-checking the TS port against a second
implementation):

```
node --import tsx scripts/audit/banger-live-tick-validation.mjs --days=180 --min-n=30 --json
```

- If not ready: the exact shortfall and, once a rate is measurable, an ETA. Nothing further to do
  until then — re-running more often than the ETA suggests just re-confirms "not yet."
- If ready: the actual verdict (MODEL and EXEC fill tracks, win rate / expectancy / profit factor /
  mean delta with CI) for 100/33/70 vs production's real 100/50/50, sourced entirely from
  live-captured ticks. **Read the VERIFICATION section first** (CLI script) — if full-coverage rows
  fail to reproduce their own real recorded `realized_pnl_pct` within 0.5pp, that is a
  framework-correctness signal worth investigating BEFORE trusting the verdict below it.
- **Do not tune the CANDIDATE parameters (100/33/70) based on this run.** If the live-tick verdict
  disagrees with phase 2's archived-data verdict, that is itself the finding to report — not a
  cue to search for a different fraction/trail that "works" against whatever data currently
  exists. The whole point of this framework is measuring the SAME fixed candidate against better
  data, not curve-fitting a new one.
- **Still do not change production exit logic** without a separate, explicit operator go-ahead —
  this framework's job is evidence, the same as phase 2's.

## Known limitation, disclosed

The log only started capturing ticks when PR #5522 deployed (2026-09-27). Every banger position
that closed before that date has **zero** coverage and will always read `NONE` — this is
expected and correct, not a bug to chase. The population this framework can ever use grows only
with genuinely NEW closes going forward; there is no way to backfill it, by design (that's
exactly the gap phase 2 found no honest way to close retroactively).
