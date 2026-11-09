> **kind:** FINDING

## Vector Pulse flow-print premium formatter had no billions tier and no round-first-then-promote guard — FIXED

| | |
|---|---|
| **Area** | Vector Pulse live signal feed (`src/features/vector/lib/vector-pulse.ts`) |
| **Status** | FIXED (PR, round 516) |
| **Severity** | P3 — display-layer only, no trading/data impact |

### Root cause

`vector-pulse.ts`'s local `fmtPremium(n)` (used only to render the `💰 <premium> <ticker> ...`
flow-print line in the Pulse feed) was a standalone copy of the "pick the K/M/B display unit off
the **raw**, unrounded magnitude, then round the quotient to that unit's own precision afterward"
defect shape that this repo's audit lanes have already found and fixed in several sibling
formatters this session (`fmt-money.ts`'s own `fmtPremium`, `helix-flow-format.ts`'s `fmtOi`,
`thermal-compact-matrix.ts`, `gex-heatmap-money-format.ts`, `helix-tide-money-format.ts`,
`helix-contract-notional-format.ts`, `vector-crosshair-format.ts`'s `fmtGex`, among others — each
of those files' own BUG FIX comments document the identical root cause). This instance was missed
because it is a separate, drifted duplicate of the canonical `fmtPremium` in `fmt-money.ts` rather
than an import of it, so the canonical fix never reached it.

Concretely, the old code was:

```ts
function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}
```

Two compounding defects:
1. **No billions tier at all.** `flowAlertToPulseSignal` only calls `fmtPremium` on
   `flow.premium` values that have already cleared the `$1,000,000` `FLOW_MIN_PREMIUM` whale
   floor (`if (flow.premium < FLOW_MIN_PREMIUM) return null;`), with no upper bound — real
   options-flow premium prints do reach hundreds of millions and occasionally cross $1B on large
   block/sweep trades. Any such print rendered a raw, unpromoted four-digit-plus `M` label, e.g.
   `$1234.5M` instead of `$1.2B`.
2. **Round-after-pick at the M boundary.** Even below $1B, a premium that **rounds** to 1000 at
   the M unit's own 1-decimal precision (e.g. `999_950_000` → `(999_950_000 / 1e6).toFixed(1)` =
   `"1000.0"`) rendered the literal overflowed `"$1000.0M"` instead of promoting to `"$1.0B"`,
   exactly the boundary bug already fixed in the sibling formatters named above.

### Evidence

Added a regression test (`vector-pulse.test.ts`) feeding `flowAlertToPulseSignal` a
`premium: 999_950_000` flow alert. RED (pre-fix): rendered line contained the literal
`"$1000.0M"`. GREEN (post-fix): renders `"$1.0B"`. Confirmed via stash/unstash
(`git stash` the source fix, run the test to see it fail, `git stash pop`, run again to see it
pass).

### Fix

Rewrote `fmtPremium` to match the canonical fix's shape — add the billions tier, and guard the
millions tier with the same round-first-then-promote check `fmt-money.ts`'s `fmtPremium` and
`thermal-compact-matrix.ts` already use: compute the candidate unit's rounded magnitude *before*
deciding whether it crossed into the next tier.

```ts
function fmtPremium(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) {
    const m = Math.round((n / 1_000_000) * 10) / 10;
    if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${m.toFixed(1)}M`;
  }
  return `$${(n / 1_000).toFixed(0)}K`;
}
```

### Blast radius

Checked every other call site of this local `fmtPremium` — there is exactly one
(`flowAlertToPulseSignal`'s rendered `line` string), so the fix is fully contained to this file.
The canonical `fmtPremium` in `fmt-money.ts` and the other sibling formatters named above were
already independently fixed in prior rounds and are untouched here. Did not switch this call site
to import the canonical helper instead of fixing the local copy in place — the local copy's
return type/signature (`(n: number) => string`, no null-handling, slightly different K-unit
precision choice) is a deliberate, narrower contract for this one call site, and `fmt-money.ts`'s
version additionally accepts `null` and returns `"—"`, which is a different (wider) contract this
caller doesn't need; duplicating the fix keeps this change minimal and single-issue rather than
also changing the import surface.

### Test

`src/features/vector/lib/vector-pulse.test.ts` — new test:
"flowAlertToPulseSignal: huge print near the M/B boundary promotes to B, not an overflowed 4-digit
M label (round-first-then-promote bug class, same fix already shipped in fmt-money.ts's
fmtPremium but missed in this duplicate)".
