## trim_scale's breakeven-floor dead zone is NOT fixed in production — the 2026-08-27 fix was verified with an input the real caller never produces — REOPENED

> **kind:** `FINDING`

| **Status** | REOPENED — `fix/trim-scale-floor-dead-zone` (merged 2026-08-27) does not change production behavior; the underlying SLS/TSM bug (breakeven-floor dump preempting an armed trim tranche) is still live |
| **Severity** | P1 — real trade P&L, live 0DTE exit engine, same defect class as the original finding |
| **Surface** | `src/lib/zerodte/exit-engine.ts` `decideTrimScale` (Night Hawk 0DTE, `trim_scale` exit mode) + `src/lib/zerodte/exit-sync.ts` (the only real caller) |

### Root cause

The 2026-08-27 fix made `decideTrimScale` suppress the shared breakeven-floor EXIT whenever
`trimAvailable = armed > taken`, where `armed = trimTranchesArmed(peakPnlPct, regime)` and `taken`
is `input.trimsTaken` (clamped/floored). That guard is correct **in isolation** — but its own
regression test proved it with `trimsTaken: 0`, a value the real production caller can never send.

`exit-sync.ts` (the only place that calls `evaluateExitState` for a live ledger row) derives
`trimsTaken` as:

```ts
const trimsTaken = exitMode === "trim_scale"
  ? trimTranchesArmed(pinnedLivePnlPct(entry, peak), regime ?? "neutral")
  : 0;
```

That is **the exact same function, on the exact same peak/regime**, that `decideTrimScale`
independently uses to compute `armed`. There is no persisted trim-tranche counter anywhere in the
ledger row — `taken` is re-derived from the peak on every tick instead of reflecting how many
tranches were actually banked. So on the real call path, `taken === armed` on every single tick,
`trimAvailable = armed > taken` is **always false**, and the dead-zone guard the fix added can
never fire. The comment in `exit-sync.ts` already flags this as an intentional simplification
("the graduation follow-up — FINDINGS 2026-07-23", i.e. a persisted trim-tranche counter was always
known to be needed) — but the 2026-08-27 finding's "FIXED" status did not account for it, so the
fix reads as closing the SLS/TSM bug when it does not touch the code path that actually runs.

### Evidence

New regression test in `src/lib/zerodte/exit-engine.test.ts` ("trim_scale DEAD ZONE — KNOWN GAP"),
which pins `trimsTaken` using the real caller's own formula (`trimTranchesArmed`) instead of the
hand-picked `0` the original fix's test used:

```ts
const peakPremium = 4.8836; // peak +22.09%, the live SLS shape
const trimsTakenAsRealCallerDerivesIt = trimTranchesArmed(peakPnlPct, "neutral"); // === 1
const d = evaluateExitState(input({
  exitMode: "trim_scale", regime: "neutral", peakPremium,
  currentMark: 4.0, // round-tripped to 0%
  trimsTaken: trimsTakenAsRealCallerDerivesIt,
}));
// d.action === "EXIT", d.reason === "ratchet_breakeven_floor"  <-- still dumps to breakeven
```

Run: `npx tsx --test src/lib/zerodte/exit-engine.test.ts` → 77/77 pass, including this test —
i.e. the current shipped behavior for the exact SLS/TSM shape (peak +22.09%, round-tripped to
breakeven, `neutral` regime) is still `ratchet_breakeven_floor`, not `trim_scale_first`. The
original fix's own test (`trimsTaken: 0`) still also passes and still returns `TRIM` — both tests
are correct about what they each input; the point is that `trimsTaken: 0` is not a value the real
ledger sync path ever sends.

### Blast radius

Same single call site as the original finding — `decideTrimScale`, reached only via
`evaluateExitState` from `exit-sync.ts`'s live ledger tick and from `zerodte-sim.mjs`'s offline
replay harness (which passes its own hand-computed `trimsTaken`, so the simulator's numbers for
this scenario do not reflect what production actually does). Any future SLS/TSM-shaped peak under
`trim_scale` (neutral or range regime, since those are the two where the floor and the first
tranche threshold coincide/cross) will still round-trip to breakeven in production exactly as
before 2026-08-27.

### Fix rationale — NOT shipped now, scoped as future work

The real fix needs a **persisted trim-tranche counter** on the ledger row (a genuine "how many
thirds has this specific position banked" fact), not a value re-derived from the peak every tick —
because re-deriving it from the same formula `armed` uses makes the two values structurally
identical by construction, no matter how the comparison inside `decideTrimScale` is written. That
requires a DB column + write path in `exit-sync.ts` at the point a TRIM action is actually taken,
which is schema/migration work with real live-risk-management blast radius. Given the repo's
existing "graduation follow-up" note already flagged this and given the risk of a rushed schema
change to code that manages real position P&L, this finding stops at correcting the record and
adding a regression test that pins the current (still-buggy) behavior so it cannot silently regress
further or be re-claimed as fixed — it does not attempt the schema change in this PR.

**What was done here:** reopened the record (this file) + the pinning regression test above.
**What is NOT done:** the persisted-counter fix itself, left as documented future work.
