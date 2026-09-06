## 2026-09-06 — [FINDING, P1 SPX Slayer / 0DTE] Live condor status derivation uses DIRECTIONAL peak/trough semantics — a winning condor can be latched CLOSED "stopped" and contaminate the session-halt count — OPEN, flagged for the coordinator

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | OPEN — reproduced by code trace with high confidence; NOT attempted here. Multi-file, safety-relevant (session-halt governor logic) — needs a design decision on what live TRIM/CLOSED should even mean for a condor before a fix is written, not something to redesign unilaterally in one lane pass. Flagged for the coordinator / Cursor. |
| **Priority** | P1 — real-money risk-management logic (governor session-halt stop count) can fire on a false signal, and the member-facing card can show "STOPPED" on a winning position. |
| **Area** | 0DTE / SPX Slayer — live position tracking + risk governor |
| **PR** | none (write-up only, per this file's own README: bigger findings get flagged, not unilaterally built) |

## Context

Found while auditing `src/lib/zerodte/gates.ts`'s `computeGateCalibration` for more instances of
today's condor-exemption bug class (fixed twice already: #4138 for G-6 cross-system-conflict,
#4160 for G-4 VIX regime) — both were a secondary/duplicate computation silently treating a
delta-neutral condor as directional. A background sweep for other instances of the same shape
(never touching `gates.ts`/`calibration.ts` again, both already fixed) found this third, larger
instance in the LIVE position-tracking lane rather than the calibration lane.

## Root cause

`src/lib/zerodte/plan.ts`'s `derivePlayStatus` (line 734) is the shared state machine both
`src/lib/zerodte/live-marks.ts` (the ~1s poller, via `advancePlayLatch` in `marks-math.ts`) and
`src/lib/zerodte/scan.ts` (the cron sync twin, `syncLedgerLiveState`) call for **every** entered
play, condor included, with zero `play_type`/`is_condor` branch:

```ts
// plan.ts:764-791
const stop = entryPremium * (1 + stopPct / 100);
const target = entryPremium * (1 + targetPct / 100);
if (peak != null && peak >= target) {
  return { status: "TRIM", ... };
}
if (!deferPlanStop && trough != null && trough <= stop) {
  return { status: "CLOSED", live_pnl_pct: stopPct, closed_reason: "stopped" };
}
```

This assumes a **directional, premium-BOUGHT** play: `entryPremium` is the debit paid, `mark`
rises toward the target and falls toward the stop, so `peak` (max mark seen) approaching the
target is a win and `trough` (min mark seen) approaching the stop is a loss.

For a condor, `entry_premium` is the **net CREDIT received** (confirmed by `governor.ts`'s own
doc, lines 220-231) and the `mark` fed in is the **net DEBIT-to-close**
(`condorNetMarkPerShare`, wired at `live-marks.ts:242` via `resolveActivePlayStoreMark`,
`live-marks.ts:236-256`). A condor's P&L is the exact mirror of a directional play's — confirmed
by the codebase's OWN correct formula elsewhere, `marks-math.ts:102-105`:

```ts
export function condorSellerPnlPct(entryCredit, mark) {
  return ((entryCredit - mark) / entryCredit) * 100; // note: (credit - mark), not (mark - entry)
}
```

`derivePlayStatus` never uses this — it always computes `(mark - entryPremium) / entryPremium`
and compares `peak`/`trough` the DIRECTIONAL way. So for a condor: a **falling** mark (credit
being retained — the condor's *winning* direction) drives `trough` down toward
`entryPremium * (1 + stopPct/100)` = `credit * 0.5`, which `derivePlayStatus` reads as **hitting
the stop** — the opposite of what's happening.

## Concrete divergent scenario

SPX condor sold for $0.60/share net credit (`entry_premium = 0.60`). Price stays inside the wings;
theta decays the position normally and the net debit-to-close mark falls to $0.25 — a genuine,
healthy **+58.3%** win (`condorSellerPnlPct(0.60, 0.25) = (0.60-0.25)/0.60 = 58.3%`, the CORRECT
number, computed correctly elsewhere for display). But `$0.25 <= $0.60 * (1 + (-50)/100) = $0.30`,
so `derivePlayStatus` fires:

```ts
{ status: "CLOSED", live_pnl_pct: -50, closed_reason: "stopped" }
```

on a play that is actually up 58%.

## Confirmed downstream contamination

1. **`db.ts::updateZeroDteLiveState`** persists this `status`/`trough_premium` onto the row
   unconditionally (no condor guard) — the corrupted state lands in the DB, not just in memory.
2. **`governor.ts::ledgerRowStopped`** (line 434-443) independently re-derives the SAME directional
   stop condition off the now-corrupted persisted row (`status === "CLOSED" && trough_premium <=
   entry_premium * (1 + PLAN_RULES.stop_pct/100)`) — also with **zero condor branch** — to decide
   whether this row counts toward the session's stop-count, which the governor uses to **HALT new
   commits** after N stops in a session. A winning condor can therefore contribute a false stop to
   the count that halts trading for the rest of the session.
3. **`governor.ts::ledgerRowRealizedPnlPct`** (line 445-455) falls back to `PLAN_RULES.stop_pct`
   (−50%) as the row's realized session P&L contribution when `ledgerRowStopped` is true and
   `plan_pnl_pct` isn't stamped yet — so the session's live realized-P&L readout can show −50% for
   a position that is actually a winner, before the (correct) post-hoc condor grader ever runs.
4. **Member-facing UI has no rescue for this specific case.** `play-card-lifecycle.ts` (line
   337-340) explicitly guards `isCondor` in its OPEN/HOLD/TRIM branch with a documented reason
   ("a condor's exit is 4-leg credit-structure geometry... the coarse ACTIVE pill stays honest")
   — but its CLOSED branch (line 315-335) has **no such guard**: `closedReason === "stopped"`
   unconditionally renders `{ label: "STOPPED", tone: "closed" }`. A member would see a winning
   condor labeled STOPPED on the board.

This is distinct from `condor.ts::gradeCondorFromBars` (line 490-532), the actual condor
settlement grader — that function is correct (grades on the underlying's breach levels against
the condor's real geometry) and would eventually produce the right `plan_outcome`. The problem is
that the live latch/status corruption happens FIRST, every ~1s tick, well before settlement, and
pollutes `status`/`trough_premium`/the governor's running stop count in the meantime.

## Why this isn't fixed in this pass

Two design questions need an answer before a correct fix can be written, not just a mechanical
"invert the comparison for condor" patch:

1. **Does the product want live intraday TRIM/early-exit management for a condor at all**, the way
   directional plays get ratchet/trim_scale exits? If condors are meant to be held to expiry and
   graded only by `gradeCondorFromBars`, the right fix might be to make `derivePlayStatus` simply
   never emit `TRIM`/`CLOSED("stopped")` for a condor (stay `OPEN`/`HOLD` until the hard time-stop),
   letting the settlement grader own the real outcome — the minimal, safest change. If the product
   DOES want early risk management on a condor (e.g., closing early on a real max-loss approach),
   the comparison needs the condor's own mirrored math (`trough` as the good direction, `peak`
   approaching something like the condor's max-loss debit as the bad direction), which needs its
   own threshold design (there is no existing `condorTargetPct`/`condorStopPct` — `PLAN_RULES` is
   directional-only).
2. **`ledgerRowStopped`/`ledgerRowRealizedPnlPct` in `governor.ts` need their own condor branch
   regardless of (1)'s answer** — they re-derive the stop condition independently rather than
   trusting the persisted `status`, so fixing `derivePlayStatus` alone does not fully close this;
   both call sites need to agree, and `governor.ts`'s own `riskContribution`/
   `aggregatePremiumAtRisk` already show the codebase knows how to branch condor-aware here (they
   use `max_loss` instead of `entry_premium`), so the fix should follow that existing precedent
   rather than inventing a new pattern.

Given the safety-relevant blast radius (a live risk-governor halt decision) and that a fully
correct fix touches at least `plan.ts`, `marks-math.ts`, `governor.ts`, and possibly
`play-card-lifecycle.ts`'s CLOSED branch, this is written up per this file's own README guidance
("write up bigger findings/enhancements rather than unilaterally building them") for the
coordinator to scope and for Cursor to independently confirm/challenge before anyone implements it.

## Evidence trail (code-read, not yet a live repro)

- `src/lib/zerodte/plan.ts:734-805` (`derivePlayStatus`) — no `play_type`/`is_condor` parameter at all.
- `src/lib/zerodte/marks-math.ts:102-105` (`condorSellerPnlPct`) and `:114-120` (`livePnlPctFor`) —
  the CORRECT, already-shipped condor P&L formula, proving the codebase knows the right math; it's
  just not wired into `derivePlayStatus`.
- `src/lib/zerodte/marks-math.ts:499-521` (`advancePlayLatch`) — calls `derivePlayStatus` with no
  condor branch, called from both:
  - `src/lib/zerodte/live-marks.ts:646` and `:684` (the live ~1s poller, `entered` includes condor
    plays per `toActivePlay`, `live-marks.ts:290-304`, which explicitly sets `is_condor: true`).
  - `src/lib/zerodte/scan.ts:2411-2462` (`syncLedgerLiveState`, cron twin) — same call shape,
    `playRailsFromRow` (`exit-sync.ts:229-249`) returns directional `PLAN_RULES` defaults for
    every row with no condor awareness either.
- `src/lib/zerodte/governor.ts:434-443` (`ledgerRowStopped`) and `:445-455`
  (`ledgerRowRealizedPnlPct`) — independently re-derive the same directional-only stop condition
  off the persisted row.
- `src/lib/zerodte/db.ts` (`updateZeroDteLiveState`, ~line 7100-7166) — persists `status`/
  `trough_premium`/`peak_premium` unconditionally for any row, condor included.
- `src/features/nighthawk/command-deck/play-card-lifecycle.ts:315-340` — OPEN/HOLD/TRIM branch is
  condor-guarded (with a doc comment showing the team already knows this class of issue exists for
  *some* statuses); the CLOSED branch is not.
- No test in `live-marks.test.ts` or `scan.test.ts` exercises `runZeroDteMarkTick`/
  `syncLedgerLiveState` with an `is_condor` play through the latch/persist path — the only condor
  test in `live-marks.test.ts` (line ~905) covers a separate, correctly-condor-aware display
  function (`buildZeroDteLiveMarksPayloadFrom`), not this one.

## Suggested next step (for whoever scopes the fix, not prescriptive)

Reproduce live: find (or synthesize via `zerodte-sim-feed.mjs`) a session with a committed condor
whose net debit-to-close genuinely falls below 50% of its entry credit while the underlying stays
inside the wings, and confirm the row's persisted `status`/`trough_premium` and the governor's
stop count both go wrong exactly as traced above. Then pick between the two options in "Why this
isn't fixed in this pass" above before touching `plan.ts`/`governor.ts`.
