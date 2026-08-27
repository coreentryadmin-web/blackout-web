> **kind:** `FINDING`

## 0DTE hard-stop exits can lock in a phantom loss when a single bad/erroneous quote tick fires — MEASURED, OPEN

| | |
|---|---|
| **Status** | MEASURED — real evidence gathered live; no code change to exit logic yet (calibration-first, see below) |
| **Component** | `src/lib/zerodte/exit-sync.ts` (`evaluateLedgerRowExit`) |
| **Severity** | P2 — a real-money risk-logic gap, but rare by construction (requires a bad tick at the exact instant a play is checked) |

### Discovery context

Found live, mid-session, answering the user's direct question "why do we have losers and can we
make the system stronger." Pulled all 11 of today's closed 0DTE ledger rows: 4 real winners, 3
breakeven ratchet-floor exits, 2 small "flat is losing" scratches, and 2 hard stops (NVDA -52.9%,
QQQ -77.06%). NVDA's stop overshot its ~-50% plan trigger by 2.9 points — ordinary slippage.
QQQ's overshot by **27.1 points**, and did so **0.357 seconds** after the play was flagged
(`first_flagged_at` and `exit_at` are 357ms apart). QQQ's own 1-minute bars for that exact window
(`2026-08-27T14:12` UTC) show it trading 717.06–718.19 — a **0.15%** range.

### Root cause

`evaluateLedgerRowExit` picks "freshest mark wins" (lane mark if fresh, else the sync pass's own
snapshot mark) and treats that mark as authoritative for a stop decision the moment it crosses the
plan's stop level — there is no check of any kind on whether the mark's implied move is plausible
given what the underlying itself did in the same window. A single bad/erroneous quote tick (a
busted print, a crossed or momentarily-stale NBBO glitch) that happens to land at or below the stop
level is indistinguishable, to this code, from a genuine market move — both trigger an immediate,
irreversible "stop, printed stop is authoritative" exit. A 0.15% underlying move cannot legitimately
reprice a 0DTE option -77% in a third of a second; there is no real-market mechanism for that
disparity. This strongly indicates QQQ's -77.06% realized loss reflects a data artifact, not an
actual tradeable price the market offered.

### Why this is left OPEN rather than fixed now

This touches live risk/exit logic on real capital. This repo's own established convention
(`gex-depth-validate.mjs`, `discovery-recall-probe.mjs`, `INTENTIONAL-DESIGN.md`) is
calibration-first: measure the real distribution before picking a threshold, rather than reacting
to one incident with an untested guard that could just as easily suppress a genuine fast move and
let a real loser run further before exiting (the opposite failure mode). One incident is a single
data point, not a distribution.

### What was built instead: a reusable measurement instrument

- `scripts/audit/lib/stop-plausibility-eval.mjs` — pure, unit-tested (`stop-plausibility-eval.test.mjs`,
  8 tests, including the exact QQQ/NVDA fixtures from today) verdict function: given a STOP-reason
  ledger row and the underlying's concurrent high-low move %, flags SUSPECT only when ALL of —
  overshoot past the plan stop ≥15pts, flag→exit latency ≤5s, underlying move <1% — hold together.
  Every threshold is a documented first pass (see the file's own doc comments for the reasoning),
  not a calibrated cutoff.
- `scripts/audit/zerodte-stop-plausibility.mjs` — the live IO harness: fetches today's ledger,
  cross-checks every STOP exit against real Polygon 1-minute bars for the underlying, applies the
  pure evaluator. Read-only; one temp Clerk user, deleted in a `finally`. Exits non-zero when any
  row is flagged, so it can gate a future scheduled check.
- **First live run, 2026-08-27**: 2 stops checked, 1 SUSPECT (QQQ, exactly as measured above), 1
  clean (NVDA).

### Next step (not done here)

Run this tool across more sessions to build a real distribution — how often a stop-reason exit is
flagged SUSPECT, and by how much — before designing any guard on `evaluateLedgerRowExit` itself
(e.g., requiring one corroborating tick before honoring an outlier-sized instantaneous move). A
single session's evidence is a strong signal but not yet a calibrated policy.
