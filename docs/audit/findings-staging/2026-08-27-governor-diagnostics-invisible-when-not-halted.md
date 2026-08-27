> **kind:** FINDING

## 2026-08-27 — [FINDING, P2 Night Hawk] Governor's realized-loser/session-P&L diagnostics were invisible in the UI whenever the halt wasn't tripped — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — a monitoring/visibility gap, not a trading-logic defect |

**Symptom.** `GOVERNOR_ENFORCE_LOSS_HALT` (the AUDIT SEV-3 realized-loser session halt) was
disabled earlier today by explicit operator directive, with governor.ts's own comment stating
the intent that "the board keeps showing `realized_losers`/`session_pnl_pct`/`would_halt` as
live diagnostics" during the disabled period. Live, this session (2026-08-27):

```
GET /api/market/zerodte/board
governor.realized_losers = 5   (== the old halt threshold — the condition IS met)
governor.session_pnl_pct = -9.7
governor.would_halt = "Session governor: 5 realized losers today (max 5, ...) — no new
                       commits for the rest of the session. 7/13's bleed came the same way,
                       uncapped (AUDIT SEV-3)."
governor.halted = false   (only 2/3 hard stops tripped, so the still-enforced hard-stop
                          halt channel hasn't fired either)
```

A repo-wide grep for `summarizeGovernorForBoard`/`GovernorSummary` and `realized_losers`
confirmed exactly one consumer of these fields across the whole member + admin surface:
`ZeroDteBoard.tsx`'s `GovernorStrip`, and there they were rendered ONLY inside
`{gov.halted && (...)}`. With `halted` now only reachable via the hard-stop channel, these
values were live in the API payload but invisible everywhere in the product — a genuine
"5 realized losers, -9.7% today" session was only visible to whoever thought to hit the raw
API directly.

**Root cause.** The diagnostics were computed unconditionally (correct, deliberate design),
but the UI never had a code path to show them independent of the halt banner — the banner
was the only renderer that ever read these fields.

**Fix.** Two small, neutral-toned (non-alarm) `GovPill`s in `GovernorStrip`, shown whenever
there's something to report, independent of `gov.halted`:
- **Losers**: `realized_losers/loss_halt_count` (or just the count if the threshold field is
  absent), toned `bear` only when actually halted, `sky` otherwise.
- **Session P&L**: signed `session_pnl_pct`, toned by sign.

**Fix rationale.** Additive only — no gate/commit/governor logic touched, and the existing
halted-banner behavior (which already correctly prefers `would_halt` over the generic
hard-stop sentence, per the 2026-08-27 fix documented in the same file) is completely
unchanged. This restores exactly the visibility governor.ts's own doc comment already
promised, nothing more.

**Blast radius.** `ZeroDteBoard.tsx` only — a presentational component; no data-layer or
governor-logic file touched.

**Regression guard.** `ZeroDteBoard.test.ts`: new source-assertion test (matching this file's
existing pattern — there's no React render harness in this repo) confirming the two new pills'
conditions live in the pill strip, before the halted-banner block, so they can't regress back
into being gated on `gov.halted`. 28/28 tests pass in the file.
