## ZERODTE entry-premium achievability ceiling left a 20-49% dislocation dead zone — real TSLA/SPXW 0DTE "losses" were graded off an unachievable ledger basis — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — corrupts realized win/loss grading and member-facing trade-management math on real 0DTE commits |
| **Area** | `src/lib/zerodte/plan.ts` — `resolveLedgerEntryPremium` (achievability ceiling) |

### Trigger

Member-driven audit: the operator shared a third-party "Swift" 0DTE trade recap as a
benchmark and asked for the BlackOut 0DTE board to be audited end-to-end against it,
explicitly instructing: *"Before concluding TSLA was an exit failure, reconstruct our
exact option contract's price path, spread, and drawdown... Calling the entry correctly
timed without comparing the actual contract and entry conditions"* needs reconciling, not
assuming. This finding is the result of doing that reconstruction with real data.

### Root cause

`resolveLedgerEntryPremium` (plan.ts) persists the premium every subsequent win/loss grade,
stop/target level, and trade-management percentage is computed against. It has an
"achievability ceiling" that caps the recorded entry basis DOWN to the live mark when a flow
fill is dislocated far enough above the real market to be unachievable — but the ceiling only
fired at dislocations >= 50% (originally tied to `STOP_TRIGGER_PCT = |PLAN_RULES.stop_pct|`,
on the premise that only a dislocation large enough to *already* blow through the hard stop
mattered). That premise is false: a dislocation well under 50% still corrupts every
percentage-based exit/grade computed off it, because those are relative to the (possibly
wrong) entry — the hard stop doesn't need to fire independently for the basis itself to
already be fiction.

### Evidence

**TSLA, 2026-10-19, O:TSLA261019C00365000** (committed 14:21:16.277Z, 10:21 ET):
- Ledger `entry_premium`: **3.50** (persisted, confirmed via `/api/admin/zerodte/tier-export`).
- Real Polygon NBBO at the exact commit instant: **bid 2.28 / ask 2.30** — a tight, liquid
  2-cent spread, not stale or thin.
- Real contract minute bars, 9:30 ET open through the commit instant: max high **2.48** — the
  contract never traded anywhere near 3.50 in the entire pre-commit window. It only reached
  that level ~43 minutes later (15:04 UTC, high 3.51).
- Dislocation: **34.6%** below the old 50% ceiling trigger — never corrected.
- Real exit: `thesis_break:gex-walls` at mark **2.71** (14:29:23Z), graded **-22.57%** off the
  inflated 3.50 basis. Off the REAL 2.29-ish entry, the SAME real exit mark (2.71) is
  **+18.3%, a win**, not a loss. The exit logic itself (a real gex-walls thesis-break veto)
  behaved exactly as designed; the only defect is the entry basis.
- The underlying (TSLA stock) RTH-only move that session was **+2.96%** (357.50 → 368.09) —
  a prior "+3.27%" figure mixed extended-hours bars into an RTH-only narrative and should be
  disregarded in favor of this RTH-filtered number.
- `peak_pnl_pct: 0` ("unrealized flat") and the `-22.57%` exit are NOT contradictory — both
  are computed off the same inflated 3.50 basis, which was itself the highest price the
  position's own tracking ever recorded (nothing beat an already-fictional anchor).

**32-row probe** (`scripts/audit/zerodte-entry-dislocation-probe.mjs`, every real same-day-
expiry 0DTE commit over the trailing 14 sessions, real NBBO at each exact commit instant):

| Ticker | Date | Entry | Real mid | Dislocation | Outcome |
|---|---|---|---|---|---|
| TSLA | 2026-10-19 | 3.50 | 2.29 | **34.6%** | stopped -50% |
| SPXW | 2026-10-13 | 11.20 | 7.05 | **37.1%** | stopped -50.45% |
| TSLA | 2026-10-09 | 2.37 | 1.58 | **33.5%** | stopped -49.79% |
| HIMS | 2026-10-09 | 0.14 | 0.12 | 14.3% | doubled +100% |
| ...29 other rows | | | | all <15% | mixed (clean) |

All 3 rows with dislocation >=30% graded a hard "stopped near -50%" exit computed off the
inflated basis. All 29 other rows measured under 15% dislocation (ordinary bid/ask noise) and
graded normally. The 20-point gap between the worst clean case (14.3%) and the best-separated
bad case (33.5%) is real, measured separation, not a guessed cutoff.

Checked for the mechanism directly: for SPXW 2026-10-13 (mark 5.55, stop 5.60, reason
`plan_stop`) and TSLA 2026-10-09 (mark 1.19, stop 1.19, reason `plan_stop`), the stop PRICE
LEVEL itself is computed off the inflated entry (`entry_max * (1 + stop_pct/100)`) — so these
two didn't just grade wrong after the fact, the hard-stop trigger fired at a dollar level that
never corresponded to a real 50% drawdown from an achievable entry.

### Fix

Lowered the achievability ceiling's trigger from the stop-coupled 50% to a standalone,
measured `ACHIEVABILITY_CEILING_PCT = 20` (plan.ts). Lowering the threshold strictly expands
coverage — every case the old 50%/55% thresholds already corrected is still corrected (50 and
55 are both >= 20); only the newly-measured 20-49% dead zone changes behavior. The
member-facing `entry_max`/stop/target instructions shown at flag time are unchanged (this
function only ever touched the ledger's internal grading basis, same as the existing floor);
the hard stop PERCENTAGE (-50%) is unchanged — only the basis it's computed from is corrected
when demonstrably unachievable.

### Blast radius

`resolveLedgerEntryPremium` has one call site family in `scan.ts` (directional commit +
CONDOR net-credit path) and is also referenced by `exit-sync.ts`'s own ratchet/trim-tranche
documentation (same achievability boundary, not a second implementation) — no other file
duplicates this logic.

### Tests

`src/lib/zerodte/board.test.ts` — extended the existing achievability-ceiling test with the
new 20%-boundary cases (RED→GREEN proven: new assertions failed against the old 50%-threshold
code, pass against the fix) and added a dedicated regression test reproducing the real TSLA
34.6% shape. Full suite + `tsc --noEmit` clean.

### Remaining / explicitly not done here

- n=32 over 14 sessions is a real but limited sample for the exact 20% cutoff — re-run
  `zerodte-entry-dislocation-probe.mjs` as more sessions accumulate, same discipline as every
  other threshold in this codebase that started from a live finding.
- SPY's 2026-10-19 short (-17.61%, thesis_break:gex-walls) was independently checked and is
  CLEAN (-0.5% dislocation, a real loss, not an artifact of this bug).
- The "did the system miss a subsequent bullish SPY setup" question was checked against real
  price action: SPY drifted +0.4% to a session high ~90 minutes after the short's exit, then
  faded back to flat/slightly negative by close — not a clear missed high-conviction move.
- Real scan-pass cadence (distinct `first_flagged_at` clusters per session) ranges from ~20s
  to ~160 minutes between commits across the 14-session sample — this measures time between
  successful, gate-clearing COMMITS, not the underlying ~5-minute scan loop's own polling
  interval (which this sandbox cannot verify directly — no CloudWatch/AWS access this
  session). A long gap is consistent with a 5-minute scanner finding nothing gate-clearing for
  many consecutive passes (matches the separately-documented near-zero joint gate-pass rate in
  `docs/audit/INTENTIONAL-DESIGN.md`), not necessarily with the scanner itself stalling — this
  distinction needs real cron-invocation logs to resolve, which is a genuine data gap.
