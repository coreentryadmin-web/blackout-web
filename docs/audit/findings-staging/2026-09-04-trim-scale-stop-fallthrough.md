> **kind:** `FINDING`

## trim_scale dead-zone guard could suppress a real plan-stop EXIT, letting a stopped-out 0DTE position fall through to TRIM instead — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P0 (live risk-management defect — 0DTE, real money) |
| **File** | `src/lib/zerodte/exit-engine.ts` (`decideTrimScale`), regression test in `src/lib/zerodte/exit-engine.test.ts` |
| **Found by** | Autonomous parallel bug-hunt workflow (8-dimension scan + adversarial verify), 2026-09-04 |

### Root cause

`decideTrimScale` computes:

```ts
const trimAvailable = armed > taken;
const sharedFloor = ratchetFloorPct(peakPnlPct, input.trimmed);
const floorBreached = sharedFloor != null && pnlPct <= sharedFloor && !trimAvailable;
```

The 2026-08-27 "dead-zone guard" forces `floorBreached` false whenever a trim tranche is
armed-but-not-taken (`trimAvailable`), so that a peak which has armed tranche 1 but hasn't yet
banked it doesn't get dumped whole to the shared breakeven/early-arm floor — it banks the tranche
instead (E5: "don't scratch a momentum runner at breakeven"). That part is correct and intentional.

The bug: in the normal risk configuration the shared ratchet floor sits well **above** the raw
plan stop (e.g. floor = breakeven = entry, stop = −50% of entry), so the separate plan-stop branch
(`stopIsHigher && !floorBreached`, where `stopIsHigher = planStop >= floorMark`) is *already* false
in that configuration regardless of `trimAvailable` — it structurally defers all protection to the
floor-EXIT branch (`floorBreached && sharedFloor != null`). That is exactly the branch the dead-zone
guard suppresses whenever `trimAvailable` is true. So once price has crashed not just past the
shared floor but **past the raw plan stop itself**, with a tranche still armed-but-unbanked, *both*
exit-returning branches are suppressed and execution falls through to the trim ladder
(`if (armed > taken) return {action:"TRIM", ...}`) — banking one third "into strength" while the
position is actually down past its own hard stop, leaving two thirds open with zero protective
action that tick.

The code's own prior comment claimed this guard "does not change... the plan-stop comparison, so a
real stop breach still outranks a pending trim exactly as before" — that guarantee was never
actually enforced; a regression test (`exit-engine.test.ts`, "ADDENDUM... KNOWN GAP") already pinned
the gap but was marked "unreachable in production today," because at the time `exit-sync.ts`
derived `trimsTaken` with the identical formula used for `armed`, so `armed === taken` always and
`trimAvailable` was always false.

**That precondition no longer holds.** `exit-sync.ts`'s `resolveTrimBankLive()` defaulted ON
2026-09-03, switching `trimsTaken` to the row's real persisted `trims_taken` column — a value that
can legitimately lag `armed` (a faster live-marks writer latches `peak_premium` ahead of the slower
trim-bank persistence cadence, or the prior tick's `onTrimBank` write hasn't landed yet). So
`trimAvailable` can now genuinely be true while price is also below the plan stop, and the
"unreachable" gap became live.

### Failure scenario

entry = $2.00, regime = neutral (trim thresholds [20, 50]), plan stop = $1.00 (−50%). Peak premium
hits $2.50 (peak +25%) — a faster live-marks writer latches `row.peak_premium = 2.50` before the
slower persistence path has written `trims_taken = 1` for that tranche, so this tick still reads
`trims_taken = 0`. Price then crashes to `currentMark = $0.90` (−55%, past the −50% stop).

- `armed = trimTranchesArmed(25, "neutral") = 1`, `taken = 0` → `trimAvailable = true`
- `floorBreached` forced false → the floor-EXIT branch does not fire
- `sharedFloor = ratchetFloorPct(25, false) = 0` (breakeven) → `floorMark = $2.00`
- `stopIsHigher = planStop($1.00) >= floorMark($2.00) = false` → the plan-stop branch does not fire either
- falls through to `if (armed > taken)` → returns `{action: "TRIM", reason: "trim_scale_first"}`

Two thirds of the position remain open, no protective action taken, while the mark sits 5 points
past the hard stop.

### Fix

Carve the raw plan-stop breach out of `trimAvailable` itself, in `exit-engine.ts`:

```ts
const stopAlreadyBreached = input.planStop != null && currentMark <= input.planStop;
const trimAvailable = armed > taken && !stopAlreadyBreached;
```

Once `currentMark <= planStop`, `trimAvailable` is forced false, so `floorBreached` is no longer
suppressed and the floor-EXIT branch fires (protecting the position, via the floor's own reason
label — same behavior the pre-2026-08-27 code had for this specific case). The dead-zone guard's
original purpose is fully preserved for every case it was built for: it only ever engaged when
`currentMark` was still above the plan stop (merely past the *shared floor*, not the hard stop), and
that path is untouched by this change.

### Evidence

RED→GREEN: reverted the one-line `exit-engine.ts` change (`git stash`) and re-ran
`exit-engine.test.ts` — the new regression test ("FIXED: a real plan-stop breach always EXITs even
when a trim tranche is available") failed as expected (`not ok`, action was `TRIM` not `EXIT`).
Restored the fix — same test file: **80/80 pass**. `npx tsc --noEmit` clean.

### Blast radius

Single call site — `decideTrimScale` is the only trim_scale exit-decision function, invoked from
`exit-sync.ts`'s live poll loop and from `zerodte-sim.mjs`'s grading replay. Ratchet mode
(`decideRatchet`) was checked and is unaffected — its own protective gate is a plain
`stopBreached || floorBreached` OR with no dead-zone suppression, so it was never exposed to this
class of bug (confirmed while investigating, not itself changed).

### What was deliberately left unchanged

The dead-zone guard's core behavior (bank a tranche instead of dumping the whole position to the
shared floor) is untouched for every case where price is between the tranche's own trigger and the
raw plan stop — that is the exact case the 2026-08-27 fix targeted (live SLS/TSM shapes) and it
still passes unmodified (`exit-engine.test.ts` DEAD ZONE tests, currentMark above planStop
throughout).
