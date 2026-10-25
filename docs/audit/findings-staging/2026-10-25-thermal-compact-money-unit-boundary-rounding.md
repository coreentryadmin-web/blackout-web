## 2026-10-25 — [FINDING, P2 Thermal] `fmtCompactHeatMoney` overflows into a four-digit label at every K→M and M→B unit boundary instead of promoting to the next unit — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Thermal compact money formatting — `src/lib/thermal-discord-card.ts` (live, feeds the real Discord GEX card) and `src/features/thermal/lib/thermal-compact-matrix.ts` (same function name/bug, currently dead code — zero callers outside its own test) |
| **Found by** | DISCOVERY-lane standing audit mandate, fresh-angle sweep on 2026-10-25 |

### Symptom

`fmtCompactHeatMoney` renders a compact magnitude label (`"+$1.0M"`, `"-$150K"`, etc.) for GEX/premium
figures on the Thermal Discord card. For any value whose magnitude, once rounded to one decimal of
its unit, reaches `1000`, the function never promotes to the next unit — it prints the overflowed
four-digit label instead:

```
999700     -> "+$1000K"   (should be "+$1.0M")
999500     -> "+$1000K"
999999     -> "+$1000K"
999950000  -> "+$1000.0M" (should be "+$1.0B")
999999999  -> "+$1000.0M"
```

Thermal's GEX/premium magnitudes routinely span hundreds of thousands to billions, so a cell landing
in either ~$500-wide boundary band is a real, non-negligible occurrence over the many cells rendered
each Discord-card cycle — not a theoretical edge case.

### Root cause

Both `src/lib/thermal-discord-card.ts:232-244` (live) and its near-identical twin
`src/features/thermal/lib/thermal-compact-matrix.ts:93-101` (dead code today — no callers outside
its own test file; `ThermalCompactMatrix.tsx` never imports it despite importing its siblings) check
`abs >= 1_000_000` / `abs >= 1_000_000_000` **before** rounding the quotient. A value just under a
threshold that **rounds up to** `1000` of the smaller unit (e.g. `999,700` → `999.7K`, which rounds
to `"1000"` when formatted) slips past the `>=` check for the next tier and gets rendered in the
wrong, overflowed unit.

### Fix

Both functions now compute the rounded quotient first, then check whether *that* rounded value
reached `1000` — if so, promote to the next unit up (recursing through the same `abs`, now against
the next tier's own, correctly-thresholded formatting), rather than trusting the pre-round magnitude
check alone. `thermal-discord-card.ts`'s existing `k < 10` decimal-vs-integer K-display split is
preserved unchanged; only the overflow boundary is newly guarded.

### Blast radius

Two call sites, same bug, same fix shape:
- `thermal-discord-card.ts` — live, rendered on every Discord GEX card (`buildThermalDiscordCardSvg`,
  line ~621).
- `thermal-compact-matrix.ts` — not currently wired into any UI (confirmed via `git grep`), but fixed
  for consistency so a future caller doesn't inherit the same defect silently.

### Tests

Added a regression test to each file's own test suite asserting the exact live-repro values promote
correctly: `999_700 → "+$1.0M"`, `999_500 → "+$1.0M"`, `999_999 → "+$1.0M"`, `999_950_000 → "+$1.0B"`,
`999_999_999 → "+$1.0B"`, plus the negative-sign case. RED→GREEN confirmed: reverted both source
files only (kept the new tests) — 23 pass / 2 fail, exactly the two new assertions; reapplied — 25/25
pass. Full Thermal lib+component suite: 104/104 pass, no regressions. `npx tsc --noEmit`: clean.
