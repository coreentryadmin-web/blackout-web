> **kind:** FINDING

## Night Hawk Legacy — no measurement of the bearish-posture gate's real historical fire rate — FIXED (measurement tool)

| **Status** | FIXED |
|---|---|

**Root cause.** A live audit cycle (2026-09-18) found Legacy's published book was 47 LONG vs 1
SHORT over the trailing 30 sessions (`GET /api/admin/nighthawk/analytics?days=30`'s `by_direction`),
during a window SPY closed -1.31% with 17 of 22 sessions red (Polygon `SPY` daily bars,
2026-08-19..2026-09-18) — and `wrong_direction` is the dominant graded failure mode in the same
window (30 of 63 graded plays, 47.6%). `bearish-posture.ts` (PR-N9) already exists specifically to
stop the book going all-LONG on a bearish tape, via `detectBookPosture()` — a deliberately
conservative gate requiring >=2 of 3 independent bearish signals (`tide_bias`, breadth
`advance_pct`, `composite_regime`) before re-ranking toward SHORT. Nobody had ever measured how
often that gate actually fires against real history, so it was impossible to tell whether the
LONG:SHORT imbalance reflects a genuinely-rare bearish tape (gate correctly quiet) or a gate too
strict to fire even when the tape was bearish (gate silently failing its own stated purpose).

**Evidence.** `publish-context.ts`'s `market` block already pins `tide_bias`, `composite_regime`,
and `breadth.pct_advancing` onto every published play's `publish_context` JSONB column
(`nighthawk_play_outcomes`), and `fetchNighthawkOutcomeAnalytics` (used by the existing admin
analytics route) already fetches that column in full for every resolved row in a window. The raw
ingredients `detectBookPosture()` needs were already durably captured and already fetched — they
were simply never re-assembled into that function's own input shape and re-run against it.

**Blast radius.** New, additive files only — `posture-backtest.ts` (pure) and its admin route.
Touches no existing scoring/gating/discovery code; `detectBookPosture()` itself is imported
unmodified.

**Fix.** Added `src/features/nighthawk/lib/posture-backtest.ts`:
- `regimeContextFromPersistedMarket()` — re-derives the `NightHawkRegimeContext` shape
  `detectBookPosture()` consumes from the persisted (differently-shaped/named) `publish_context.market`
  blob, null-honest throughout (a missing field reads null, never a fabricated default; an
  unrecognized `tide_bias` string falls back to NEUTRAL rather than crashing).
- `buildPostureBacktestReport()` — groups resolved rows by `edition_for` (one regime pin per
  evening, not per play), re-runs the unmodified gate once per session, and cross-references
  against what the book actually published that night (`published_long`/`published_short`,
  `gate_short_but_book_all_long` for the specific disconnect where the gate fires SHORT but the
  book still carries zero shorts). Summary reports the gate's fire rate as a percentage over
  sessions that actually HAD a regime pin (never inflating/deflating the rate with regime-less
  sessions), and never fabricates a rate over an empty window (0/0 reads `null`, not `0%`).
- New admin route `GET /api/admin/nighthawk/posture-backtest?days=N`, identical
  fetch→pure-shape→JSON pattern as the existing `candidate-leaderboard`/`tier-export` routes.

**Rationale.** Zero new DB capture, zero schema change, zero live-picks-logic change — this is
pure measurement over data already durably persisted and already fetched elsewhere. Deliberately
did NOT touch `bearish-posture.ts`, any scoring weight, or the gate's 2-of-3 threshold: per the
standing escalation policy, a finding this close to live-picks logic is measured and reported, not
acted on unilaterally. The measurement itself will answer whether the threshold needs revisiting —
this PR only builds the instrument.

**Sample size / evidence.** 11 new unit tests (`posture-backtest.test.ts`), covering: null-market
non-fabrication, the breadth-field name mapping, an invalid tide_bias falling back safely, one
regime-read-per-session grouping, a genuine 2-of-3 SHORT trigger, the deliberate 1-signal-stays-NEUTRAL
floor, a regime-unavailable session excluded from the fire-rate denominator, the percentage math
itself, an empty-input non-crash, and the all-long-session counter. `npx tsc --noEmit` clean. Full
`npm test`: 14837/14837 passing, 0 regressions.

**Next action.** Run the new route once tonight's edition data settles (`GET
/api/admin/nighthawk/posture-backtest?days=30`) and read the result — that answers the actual
question this cycle's investigation opened (gate fire rate vs. real bearish-tape frequency) without
guessing. If the gate turns out to be firing rarely despite a genuinely bearish tape, that is the
evidence a threshold change would need — still not built here, per the escalation policy.
