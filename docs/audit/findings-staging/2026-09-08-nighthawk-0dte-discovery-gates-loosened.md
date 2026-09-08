> **kind:** `FINDING`

## Night Hawk 0DTE: whole-market discovery/commit gates loosened — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `src/lib/zerodte/gates.ts`, `board.ts`, `governor.ts`, `breakout-cap.ts`, `breakout-discovery.ts`, `src/features/nighthawk/lib/candidates.ts` |
| **PR** | (pending — `fix/loosen-nighthawk-discovery-gates`) |

### Symptom

Operator-reported, live and repeated twice in the same session in near-identical language:
*"0dte and swings should have had more plays... whole day its just 1 play on 0dte for the entire
market"* / *"how could there be possibly be only one 0dte play... something is wrong... gates or
architecture itself is so fucked up... you have to look closely into the full design architecture
gates floors and fix up all shit so we get better more plays."* Operator explicitly instructed
shipping loosened gates immediately rather than waiting on further backtests ("ship first, watch
it live"), and to loosen both 0DTE and swing "aggressively."

### What changed and why each one was chosen

This gate stack has ~15 independent count-limiting knobs (mapped this session — see
`docs/audit/INTENTIONAL-DESIGN.md` and `docs/audit/0DTE-RESEARCH.md` for the underlying evidence
trail). Two categories were treated very differently:

**Loosened — pure scarcity/breadth knobs with no direct negative-EV evidence tied to the specific
number being raised:**

| Knob | File | Old → New |
|---|---|---|
| `ZERODTE_CONFLUENCE_MIN` (G-12) | `gates.ts` | 2 → 1 |
| `CONFLICT_SCORE_FLOOR` (G-6) | `gates.ts` | 65 → 55 |
| `SETUP_MIN_GROSS` | `board.ts` | $200k → $150k |
| `SETUP_MAX_OTM_PCT` | `board.ts` | 12% → 16% |
| `RUNNER_SETUP_MAX_OTM_PCT` | `board.ts` | 20% → 26% |
| `GOVERNOR_MAX_SESSION_STOPS` | `governor.ts` | 3 → 4 |
| `GOVERNOR_REENTRY_LOCK_MS` | `governor.ts` | 20m → 10m |
| `breakout-cap.ts` `DEFAULT_CEILING` / `POOL_PCT` | `breakout-cap.ts` | 150/0.30 → 220/0.40 |
| `BREAKOUT_MAX_CANDIDATES_CEILING` / `BREAKOUT_SCREEN_POOL` (mirrors) | `breakout-discovery.ts` | 150/200 → 220/280 |
| `BREAKOUT_MIN_VOLUME` / `BREAKOUT_MIN_GAIN` | `candidates.ts` | 1M/3% → 750k/2% |

The `breakout-cap.ts` ceiling is the one with the *strongest* case for raising: the file's own
evidence header already shows win rate does NOT decay with momentum rank (43.1% top-40, 44.9%
ranks 41-100, 50.0% ranks 101+) and the ceiling already binds on 10/13 measured sessions — i.e.
real candidates were being cut off on a majority of days with no quality justification.

**Deliberately left untouched — these specific numbers have their own direct, recently-measured
negative-EV evidence, so reopening them isn't "unproven, ship and watch," it's re-admitting a
band this desk already spent real capital proving loses money:**

- `ZERODTE_SCORE_FLOOR` / `ZERODTE_SCORE_FLOOR_BREAKOUT` / `ZERODTE_SCORE_FLOOR_PIN` (65) — F-2:
  the 55-64 score band measured 18.8% WR / −24.5% avg P&L (n=16), far below the 33.3% breakeven.
- `ZERODTE_SINGLE_RAIL_PRIME_MIN` (75) — G-17 extension, real n=152 over 90 days: the 65-74 band
  graded 35.7% WR / −10.4% avg P&L, worse than every other measured population.
- `GOVERNOR_MAX_CORRELATED_SAME_DIR` (2) — tied to a real P0/P1 incident (2026-07-30, 14 losers /
  1 winner) where unmeasured same-direction concentration was a named contributing root cause.
- All fail-closed data-absence firewalls (`vixUnavailable`, `macroUnavailable`,
  `haltFeedStale`/`earningsUnavailable`, veto-blind) — these are correctness guards against
  trading blind to a real risk event, not artificial scarcity, and were explicitly out of scope
  per the operator's own "keep the fail-closed firewalls" framing.

### Blast radius / test updates

22 existing tests were pinned to the old threshold values across `board.test.ts`,
`breakout-cap.test.ts`, `breakout-discovery.test.ts`, `gates.test.ts`, `governor.test.ts`,
`runner-otm.test.ts`, plus one cross-file pin in `zerodte-service.test.ts`
(`board.governor!.max_session_stops === 3`) and one in the audit-script test
`scripts/audit/lib/breakout-cohort-split.test.mjs` (`productionScreenPool` sanity pin against the
live `BREAKOUT_MAX_CANDIDATES_CEILING`/`BREAKOUT_SCREEN_POOL` constants). All updated to assert
the new values/behavior — no test was weakened or deleted, each still asserts a real boundary,
just at the new threshold.

### Fix rationale

Not a uniform "turn everything down" — each knob was individually checked against this repo's own
audit trail before touching it, and the two categories above were kept strictly separate. Where
raising a number would re-admit a population this desk has already measured losing money on
(G-3/G-17's score bands, the correlated-concentration cap), it was left alone even though the
operator's instruction was "aggressive" — shipping a known-bad reversal isn't "ship and watch,"
it's ignoring evidence that already exists. Everywhere else, this trades some of that evidence's
margin of safety for volume, exactly as instructed, and the desk watches live outcomes from here
rather than waiting on a fresh backtest first.

`npx tsc --noEmit` clean. Full suite green on Node 20 via `scripts/run-tests.mjs`: 13320/13320
pass, 3 pre-existing skips (confirmed via `git stash` A/B that this is the same pass count as
clean `main` — no regression introduced).
