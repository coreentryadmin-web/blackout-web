## 2026-10-08 — [FINDING, nighthawk-0dte] Vector-pulse 0DTE contract attach skipped DTE validation and never synced the resolved expiry/horizon back onto the setup — displayed DTE/horizon understated real contract risk — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (live P&L tracking itself followed the real contract correctly — this is not a wrong-contract bug — but the DISPLAYED expiry/DTE/horizon materially understated real theta/gamma/time-value exposure on a product whose entire premise is same-day expiry) |
| **Component** | `src/lib/zerodte/vector-contract-resolve.ts`, `src/lib/zerodte/scan.ts` |
| **PR** | fix/zerodte-vector-pulse-dte-sync |
| **Found via** | Standing Night Hawk 0DTE live-journal mandate, reading each committed play's full story off `GET /api/market/zerodte/record?days=1` (this cycle) |

### Root cause

Spotted live: 2 of 4 committed 0DTE plays (SPY, CIFR) showed a mismatch between the board's
displayed `expiry` field and the actual expiry **encoded in the OCC contract symbol** being
traded/tracked. SPY was 1 day off (already closed, low impact). CIFR was **7 days off**
(`expiry` field said 2026-10-09 / `expiration_dte: 1` / `expiration_horizon: ZERO_DTE`, but the
`occ` the position was actually tracking expired 2026-10-16) while the position was still OPEN
with `live_pnl_pct` actively updating — a real 8-DTE contract displayed as a 1-DTE/ZERO_DTE play.

Reading source confirmed two distinct gaps, both in the Vector-pulse fast-attach path:

1. `resolveVectorPulseContract()` (`vector-contract-resolve.ts`, the fast path used when a Vector
   pulse already carries an OCC) returned `{occ: pulse.occ, strike: pulse.strike, source:
   "vector_pulse"}` with **no DTE validation at all** — unlike its sibling
   `rankVectorContractAlternatives()`, which explicitly filters `if (aligned.dte > 4) continue`
   against `ZERODTE_MAX_DTE`. Vector tracks contracts across its own (longer) horizons, so a pulse
   OCC can carry any expiry Vector happens to be holding for that ticker/direction, with nothing
   in the 0DTE attach layer rejecting an out-of-window one.
2. `scan.ts`'s Vector-attach call site (`attachContractPlans`, ~line 1399) set `s.top_strike` and
   the OCC map entry from the resolved attach, but never wrote the resolved `expiry`/`dte` back
   onto `s.expiry`/`s.contract_horizon`/`s.actual_dte_at_commit`/`s.grading_policy` — unlike the
   **other two** contract-resolution call sites in this exact codebase (`scan.ts`'s own
   vector-rank/discovery fallback a few hundred lines below, and `contract-attach.ts`'s
   `attachThesisContractPlans`), which both sync all four fields together whenever a contract is
   (re)resolved.

Ruled out the other two attach paths as the source of CIFR's specific mismatch: `vector_rank`
already caps at `dte <= 4`, and `discovery` builds its OCC directly from `s.expiry`, so it cannot
diverge from the displayed field by construction. Only the unvalidated `vector_pulse` path could
produce a 7-day gap.

### Fix

- `resolveVectorPulseContract()` now parses the pulse OCC's embedded expiry (`occExpiryYmd`,
  already used elsewhere for the same purpose) and computes its calendar DTE via the existing
  `calendarDteBetween` helper. A pulse OCC whose DTE exceeds `ZERODTE_MAX_DTE` is rejected
  (returns `null`), falling through to the DTE-capped `vector_rank`/`discovery` paths instead of
  attaching a contract whose real DTE contradicts the setup's displayed 0DTE/ZERO_DTE horizon. An
  in-window pulse OCC now carries its parsed `expiry`/`dte` on the returned `VectorContractAttach`
  (previously always `undefined`).
- `scan.ts`'s Vector-attach call site now syncs `s.expiry`/`s.contract_horizon`/
  `s.actual_dte_at_commit`/`s.grading_policy` from the resolved attach's `expiry`/`dte` whenever
  present — mirroring exactly what the other two call sites already do, so all three
  contract-resolution paths now keep the displayed fields consistent with the contract actually
  being traded.

Two new regression tests in `vector-contract-resolve.test.ts` pin both outcomes: a pulse OCC 8
days out is rejected (`null`), and a pulse OCC 1 day out is accepted and carries `dte: 1` /
the matching ISO `expiry`. Verified RED before the fix (`git stash` of the two source files alone,
new tests included — 2/7 failed in the affected test file) and GREEN after (51/51 across the
Vector-contract-resolve and scan test files; full suite 15818/15818 pass, 0 fail; `tsc --noEmit`
clean; lint clean).

### Blast radius

Both gaps live entirely inside the Vector-pulse fast-attach path (`resolveVectorPulseContract`)
and its one call site in `attachContractPlans`. No change to `rankVectorContractAlternatives`,
`discoveryContractOcc`, `contract-attach.ts`, live-mark tracking, or grading — all already correct
for their own paths. Live P&L tracking was not affected by this bug (it correctly followed the
real OCC-embedded contract throughout); only the displayed expiry/DTE/horizon/grading-policy
fields were wrong for any setup that attached via an out-of-window Vector pulse OCC.
