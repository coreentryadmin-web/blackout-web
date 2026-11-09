> **kind:** FINDING

## SPX matrix tape strip rounds $999.5K-$999.9K flow premiums into "$1000K" instead of "$1.0M" — FIXED

| **Status** | FIXED (PR, this branch) |
|---|---|
| **Area** | SPX desk — `SpxMatrixTapeStrip` (the flow-skew strip on the SPX Matrix header) |
| **Severity** | P3 — cosmetic/display correctness, no trading-decision impact |
| **Class** | Round-first-then-promote money formatter (same vein as `fmt-money.ts`, `zerodte-board-format.ts`, `helix-tide-money-format.ts`, `gex-heatmap-money-format.ts`, `DarkPoolPanel.tsx`, `spx-pulse.ts`'s `fmtNotional` — 17 prior confirmed instances; this is a fresh, previously-unfixed 18th) |

### Root cause

`fmtTapePremium` in `src/features/spx/lib/spx-tape-display.ts` picked its unit (K vs M) by
comparing the **raw, unrounded** value against the 1,000/1,000,000 thresholds, then rounded
*inside* the chosen branch:

```ts
export function fmtTapePremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;   // <- rounds AFTER the unit is already picked
  return `$${Math.round(n)}`;
}
```

For any `n` in `[999_500, 999_999]`, the raw value is `< 1_000_000` so the function commits to the
K-branch — but `Math.round(n / 1_000)` then rounds `999.5…999.999` up to **1000**, producing the
nonsensical label `"$1000K"` instead of the correct `"$1.0M"`.

### Evidence

```
$ node -e equivalent of fmtTapePremium(999_500)  -> "$1000K"   (should be "$1.0M")
$ node -e equivalent of fmtTapePremium(999_999)  -> "$1000K"   (should be "$1.0M")
```

Regression test added at `src/features/spx/lib/spx-tape-display.test.ts` — RED (pre-fix) failure:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ '$1000K'
- '$1.0M'
```

GREEN after the fix (3/3 passing), confirmed via `git stash` revert-and-rerun (not from memory).

### Blast radius

Single consumer confirmed by repo-wide grep (`grep -rn "fmtTapePremium" src/`):
`src/features/spx/components/SpxMatrixTapeStrip.tsx`, which formats `flowCallPrem`/`flowPutPrem`
(SPX 0DTE call/put flow **aggregates** — sums across the session's flow prints, not single
trades) and `flow0dteNet`. These aggregates routinely sit in the high hundred-thousands during
RTH, so the `[999_500, 999_999]` boundary is a realistic, frequently-reachable range in
production, not a theoretical edge case — unlike `spx-pulse.ts`'s `fmtPremium`, which round 473
correctly left alone because its single-trade premium floor (`SPX_SWEEP_MIN_PREMIUM = $1,000,000`)
makes its own sub-$1M branch dead code by construction. No other file imports or duplicates this
function (verified not just by name but by re-grepping the whole repo for the same two-line shape
elsewhere already covered by the prior 17 fixes).

### Fix rationale

Applied the same pattern already shipped in the sibling formatters (`fmt-money.ts`,
`zerodte-board-format.ts`, etc.): round the candidate K value first, then check whether *that
rounded* value crosses 1000 before committing to the K label; if it does, re-render through the M
branch instead. Left the M-branch and the bare-dollar branch untouched — this file has no B tier
at all, and (per round 473's parallel finding on `spx-pulse.ts`'s `fmtPremium`) a sub-$1B single
SPX flow aggregate cannot realistically reach the $1B tier, so adding one here would be
speculative scope creep, not a fix for anything reachable.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-tape-display.test.ts` — 3/3 pass (Node 20).
- `npx tsc --noEmit` — clean.
- RED→GREEN proven via `git stash` revert of the one-file fix and re-run (see Evidence above).
