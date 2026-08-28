> **kind:** FINDING

## 0DTE exit-sync used a STALE pinned stop after the achievability ceiling capped entry down — instant phantom stops, contributing to a false session halt — FIXED

| **Status** | Fixed in PR (fix/nighthawk-ceiling-phantom-stop) |
|---|---|

**Symptom (live, 2026-08-28):** Investigating a member report of "zero open plays all day", found
the board had actually committed several plays, but two — **AMD** (flagged 14:59:24 UTC, closed
14:59:24.814Z, ~0.8s later) and **NVDA** (flagged 15:03:57 UTC, closed 15:04:00.200Z, ~3.2s later)
— closed as `closed_reason: "stop"` (the ENGINE-exit family, distinct from the mechanical board's
`"stopped"`) essentially the instant they were flagged, both with `exit_pnl_pct: 0` despite the
narrated detail text describing a real but tiny adverse move (-0.41%, -1.14%). `governor.halted`
was `true` with 4 entries in `stops[]` against `max_session_stops: 3`, even though only 2 of those
stops (SNDK, MSFT) were real -50% losses.

**Root cause:** `plan.ts`'s `resolveLedgerEntryPremium` has two symmetric adjustments to the
ledger's tracked entry premium versus the plan's own `entry_max` (the flow's fill): an
**ACHIEVABILITY FLOOR** (raises the ledger basis UP toward the mark when the flow fill sat well
below it — shipped 2026-08-06) and an **ACHIEVABILITY CEILING** (caps the ledger basis DOWN toward
the mark when the flow fill sat well ABOVE it — shipped 2026-08-27, PR #2986). `exit-sync.ts`'s
`entryBasisDiverged` check exists precisely so the exit engine re-derives the operative stop from
the CURRENT ledger basis whenever it disagrees with the plan's pinned `stop_premium` (which is
always computed from the original, un-adjusted `entry_max`). That check was written for the FLOOR
case only (`entry > planEntryMax`, 2026-08-06) and was never updated when the CEILING shipped three
weeks later — so a ceiling-capped row (`entry < planEntryMax`) left `entryBasisDiverged` **false**,
and the exit engine kept using the STALE pinned stop computed from the pre-cap, much-higher
`entry_max`.

**Live numbers:** AMD's `stop_pct` is a fixed -50%. The narrated exit detail cited "plan stop 1.9"
against a ledger `entry_premium` of 1.23 — algebraically, `1.9 = entry_max × 0.5` implies the
original flow fill was **$3.80**, capped down by the achievability ceiling to $1.23 because the
real market never traded anywhere near $3.80. Since the stale pinned stop (1.9) sits ABOVE the
correctly-capped ledger entry (1.23), *any* real market quote for this contract reads as
"at/below 1.9" — so the very next evaluation pass after commit fired an immediate false stop,
regardless of real price action. Same shape on NVDA. This is the mechanical cause of both the
near-zero holding times and the `exit_pnl_pct: 0` (the fixed -50% stop label was applied at a real
premium level that hadn't actually moved).

**Fix:** `entryBasisDiverged` in `exit-sync.ts` now checks divergence in EITHER direction
(`Math.abs(entry - planEntryMax) > 0.005`, a half-cent epsilon for round2() noise) instead of only
`entry > planEntryMax`. When it fires (either the floor or ceiling path), the operative stop/target
are re-derived from the row's own correct ledger basis (`entry * (1 + stopPct/100)`), exactly as
the existing floor-case logic already did — this is a one-line generalization of an existing,
already-shipped mechanism, not new behavior.

**Blast radius:** `src/lib/zerodte/exit-sync.ts` only — the sole call site (`syncLedgerLiveState`,
used by both the 1s live-marks lane and the scan-pass sync). No other stop consumer is affected:
`gradePlanFromBars`/`derivePlayStatus` (plan.ts) both already compute their stop fresh from
`row.entry_premium` (the ledger basis) with no pinned-stop shortcut, so they were never exposed to
this divergence — this file was correctly identified as "the sole holdout" in the original
2026-08-06 comment, which is exactly why fixing it here is sufficient.

**Evidence:** New test `entry-basis coherence: a ledger basis BELOW entry_max (achievability
ceiling) also re-bases the stop — no instant phantom stop` in `exit-sync.test.ts`, using the exact
AMD numbers (entry_max $3.82, ledger entry $1.24, pinned stop $1.91, live mark $1.225) — confirmed
FAILING against the pre-fix code (asserts `CLOSED` when pre-fix it actually closes) and PASSING
post-fix, plus confirms the correct re-derived stop (entry × 0.5) still fires when the mark
genuinely reaches it. Full `src/lib/zerodte/*.test.ts` suite: 1188/1188 pass (1 pre-existing skip),
`npx tsc --noEmit` clean, on Node 20.

**Why this matters beyond the two phantom rows:** every genuinely-stopped play increments the
governor's session stop tally toward `max_session_stops` and can trip `governor.halted`, which
blocks new commits for the rest of the trading day. A false stop is not cosmetic — it can end a
member's session early on a day the desk would otherwise still be committing legitimate plays.
