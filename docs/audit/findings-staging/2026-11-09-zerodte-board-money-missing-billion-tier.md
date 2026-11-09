# 2026-11-09: 0DTE Command board's `fmtMoney` had no B tier — a second instance of the already-fixed K→M overflow, one unit higher

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/features/nighthawk/components/zerodte-board-format.ts`'s `fmtMoney` — the formatter behind
the 0DTE Command board's flow strips (`ZeroDteBoard.tsx`'s `s.gross_premium`/
`s.recent_premium_30m`, e.g. "$1.2M gross · ... · $840K last 30m") — had no billions tier at all.
Its own doc comment already documents one instance of the repo-wide "pick the unit off the raw
value, round the quotient afterward" defect class (the K→M boundary, fixed in an earlier round),
but the fix stopped one unit short: the M branch (`abs >= 1_000_000`) returned unconditionally,
with no check for whether the value — or its own 1dp-rounded quotient — actually belonged in a B
tier that didn't exist in this file at all. This is the exact "missing B tier entirely" shape
`meridian-earnings-intel-core.ts` was already fixed for in round 419, just not re-checked here.

## Root cause

```ts
if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
```

Any `n` with `abs >= 1_000_000` — including one in the billions — fell straight into this branch
with no overflow check. Two concrete failures:

- A genuinely >=$1B value (e.g. a whole-market 0DTE flow aggregate on an extreme session) rendered
  as the four-digit, wrong-unit `"$1250.0M"` for `$1,250,000,000`, instead of promoting to `"$1.3B"`.
- A value that only ROUNDS up into the billions at M's own 1dp display precision —
  `999_950_000` — hit the identical round-first-then-promote overflow this same file's K→M guard
  already describes in its own comment, just one unit higher: `(999_950_000 / 1_000_000).toFixed(1)`
  is `"1000.0"`, rendering the literal `"$1000.0M"` instead of `"$1.0B"`.

`gross_premium`/`recent_premium_30m` are per-ticker 0DTE flow aggregates (sibling gates in
`src/lib/zerodte/thesis/rails/flow.ts` treat `>= $5,000,000` as already a strong boost), so a
single ticker clearing a full $1B in one session is an extreme-tail case rather than a routine
one — but it is a real, reachable input shape (not a hypothetical type), and the missing tier is
an objective defect regardless of how often it fires, consistent with every other instance of
this bug class already fixed elsewhere in the repo on the same reasoning.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change — not a reimplementation): 4/5
pass, 1 fail in `zerodte-board-format.test.ts` — the new test, `fmtMoney(1_250_000_000)` returned
`"$1250.0M"` against the expected `"$1.3B"`.

GREEN (post-fix): 5/5 pass in that file. `npx tsc --noEmit` (Node 20) clean. Full `npm test`
launched in background after push.

## Fix

Added a B branch ahead of the M branch, with the same round-first-then-promote guard shape the
file's own K→M branch already uses (and the same B-before-M ordering `fmt-money.ts#fmtPremium`
uses):

```ts
if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
if (abs >= 1_000_000) {
  const m = Math.round((abs / 1_000_000) * 10) / 10;
  if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  return `$${(n / 1_000_000).toFixed(1)}M`;
}
```

Deliberately left untouched: the K branch, the sub-$1,000 raw branch, the null/NaN/Infinity
guard, and the file's pre-existing sign-inside-the-glyph convention for negatives (`"$-1.2M"`,
now also `"$-1.3B"`) — this fixes only the one missing-tier/unit-boundary defect, not a second,
unrelated formatting convention.

## Blast radius

Grepped every repo call site of this module (`fmtMoney` from
`@/features/nighthawk/components/zerodte-board-format` or the relative `./zerodte-board-format`):
exactly one production consumer, `ZeroDteBoard.tsx`'s two call sites (`gross_premium`,
`recent_premium_30m`), both already covered by this fix. No other file imports this specific
formatter — it is a standalone copy, not a shared helper, per its own doc comment's note that it
was "written as its own standalone copy rather than reusing the already-fixed shared helper."
Also independently re-swept the broader "unit picked off raw value, rounded afterward" bug class
repo-wide this round (grepping for `toFixed([0-9])}M`/`}K`/`}B` outside files already carrying a
"round-first-then-promote"/"BUG FIX" doc comment): every other sibling formatter found this way
(`helix-contract-notional-format.ts`, `helix-tide-money-format.ts`, `gex-heatmap-money-format.ts`,
`flow-brief-money-format.ts`, `meridian-earnings-analytics-core.ts`,
`meridian-earnings-intel-core.ts`) was already fixed with the full B (and, where relevant, T)
tier in place — this file was the one remaining gap.
