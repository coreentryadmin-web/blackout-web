# Banger live-tick-log validation framework (2026-09-27, phase 3)

**Status: framework built, live coverage not yet accumulated. No production behavior changed.
No exit candidate recommendation changes from `BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md`'s
own conclusion (don't ship 100/33/70 — the historical Polygon-reconstruction study found +0.3pp,
CI spans zero). This document is about HOW a future session re-tests that conclusion against
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
     exit, AND no consecutive-tick gap exceeds `cadenceMinutes × 3` (default 20min × 3 = 60min —
     tolerates one missed cron cycle, not a real outage).
   - `PARTIAL_START` / `PARTIAL_END` / `PARTIAL_BOTH`: an edge is missed, but no interior gap.
   - `GAPPY`: an interior gap large enough to have silently missed the exact tick that decided
     the outcome — takes priority over edge classification, since a hidden interior gap can hide
     the ONE tick that mattered even when both edges look fine.
   - `NONE`: zero coverage at all (the position closed before the log started, or coverage
     doesn't overlap even loosely).
3. Only `FULL` rows count toward the `n≥30` floor. The floor is never lowered to manufacture a
   bigger "ready" population, and the edge/gap tolerances are never tightened after the fact to
   shrink it either — they're fixed, documented constants.

## What a future session should do

Re-run `scripts/audit/banger-live-tick-validation.mjs` periodically (e.g. as part of a routine
Night Hawk Swings / Ask Largo × Banger sweep, or a scheduled check-in) once this PR has merged
and deployed:

```
node --import tsx scripts/audit/banger-live-tick-validation.mjs --days=180 --min-n=30 --json
```

- If `readiness.readyForVerdict` is `false`: the script reports the exact shortfall and, once a
  rate is measurable, an ETA. Nothing further to do until then — re-running more often than the
  ETA suggests just re-confirms "not yet."
- If `readiness.readyForVerdict` is `true`: the script computes and prints the actual verdict
  (MODEL and EXEC fill tracks, win rate / expectancy / profit factor / mean delta with CI) for
  100/33/70 vs production's real 100/50/50, sourced entirely from live-captured ticks. **Read the
  VERIFICATION section first** — if full-coverage rows fail to reproduce their own real recorded
  `realized_pnl_pct` within 0.5pp, that is a framework-correctness signal worth investigating
  BEFORE trusting the verdict below it (these are the exact ticks production itself computed, so
  a mismatch here means something is wrong with the replay, not with the data).
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
