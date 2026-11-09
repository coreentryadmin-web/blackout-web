## SPX 0DTE intel feed `moneyShort` rounds past a unit boundary without promoting the label — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | `src/features/spx/lib/spx-odte-intel-feed.ts` (SPX desk "Playbook terminal" / 0DTE intel feed — scroll-log of material desk/heatmap/Night Hawk events) |
| **Status** | FIXED |
| **Severity** | P3 (display-only formatting defect, no decision logic touched) |

### Root cause

`moneyShort()` picked its unit (K/M/B) by comparing the **raw, unrounded** `abs(n)` against each
threshold, then rounded the value **inside** that unit's branch:

```ts
function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
```

A value just under a unit's 1000-boundary rounds **up** into the next unit's territory without the
label being promoted:

- `moneyShort(999_600)` → `abs < 1_000_000` so takes the **K** branch → `Math.round(999600/1000)`
  = `Math.round(999.6)` = `1000` → renders **`"$1000K"`** instead of `"$1.0M"`.
- `moneyShort(999_950_000)` → `abs < 1_000_000_000` so takes the **M** branch →
  `(999950000/1_000_000).toFixed(1)` = `"1000.0"` → renders **`"$1000.0M"`** instead of `"$1.0B"`.

This is the exact "round-first-then-promote" money-formatter vein already fixed in ~20 other call
sites across the repo (e.g. `src/lib/helix-discord-format.ts`'s `moneyShort`, which this fix mirrors
pattern-for-pattern), but this particular local duplicate inside the SPX 0DTE intel feed had not yet
been touched.

### Why this is live-reachable, not theoretical

`moneyShort()` here formats, among other things, every 0DTE **flow-print premium** rendered in the
intel feed (`MASSIVE ... · ${moneyShort(f.premium)}`, line ~590). The feed's own floor is
`INTEL_FLOW_PREMIUM_MIN = 500_000` (`INTEL_SWEEP_PREMIUM_MIN = 250_000` for sweeps), so real flow
prints routinely land in the $500K-$2M range — squarely straddling the K→M boundary this bug breaks.
It also formats `net_gex`/`gex_net`/`flow_0dte_net` (GEX dollar totals and 0DTE net-flow deltas),
which on SPX routinely approach the hundreds-of-millions-to-low-billions range, straddling the M→B
boundary.

### Blast radius

Only this one local `moneyShort` definition in `spx-odte-intel-feed.ts` — it is not exported or
imported anywhere else, and is a separate copy from the already-fixed `helix-discord-format.ts`
version. A sibling local `moneyShort` in `src/features/spx/lib/spx-play-terminal-lines.ts` (used to
render "0DTE flow net" in the SPX play terminal) has the **same K→M rounding defect and additionally
has no B tier at all** — left untouched here to keep this PR single-issue; flagging it as the next
candidate in this vein for a follow-up round.

### Fix

Re-check the **rounded** quotient before committing to a unit's label, same pattern as the earlier
`helix-discord-format.ts` fix: round the M-quotient to one decimal first, and if that rounds to
`>= 1000`, promote to B; round the K-quotient to an integer first, and if that rounds to `>= 1000`,
promote to M. No other behavior changed — below the boundary, output is byte-identical to before.

### Evidence (RED → GREEN)

Added two regression tests directly exercising the exported `moneyShort` (newly exported purely for
testability, not used elsewhere):

```
moneyShort(999_600)      // before: "$1000K"   after: "$1.0M"
moneyShort(999_950_000)  // before: "$1000.0M" after: "$1.0B"
```

Confirmed RED on the pre-fix function body (temporarily re-exported, unmodified) and GREEN after the
fix — 17/17 tests pass in `src/features/spx/lib/spx-odte-intel-feed.test.ts`. `npx tsc --noEmit`
clean.
