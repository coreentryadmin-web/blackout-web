> **kind:** FINDING

## Banger board's "$-volume" discovery stat had no billions tier and no round-first-then-promote guard — FIXED

| | |
|---|---|
| **Area** | Night Hawk "Bangers" tab — `src/features/nighthawk/components/BangerBoard.tsx`'s `DiscoveryRationale` (the "Why it was picked" stat strip on every open/closed banger position card) |
| **Severity** | P3 — correctness/display (member-visible number renders in the wrong unit; not a trading-decision bug) |
| **Status** | FIXED |

### Root cause

`DiscoveryRationale`'s `$-volume` stat hand-rolled its own compact-dollar formatter instead of
using the repo's single source of truth (`fmtPremium`, `src/lib/fmt-money.ts`):

```ts
items.push({ label: "$-volume", value: `$${(discovery.dollar_vol / 1_000_000).toFixed(1)}M` });
```

This has two defects, both already independently fixed in ~18+ other money formatters across
this repo (per `fmt-money.ts`'s own header comment and FINDINGS.md), but never caught here because
this was a sixth, uncoordinated copy of the same math:

1. **No billions tier at all.** Any `dollar_vol` ≥ ~$1B renders as an ugly, wrong-unit four-plus
   digit `M` label (e.g. `$2500.0M`) instead of promoting to `$2.5B`.
2. **No round-first-then-promote guard at the M boundary.** A value whose `/1e6` quotient *rounds*
   to `1000.0` — e.g. `999_950_000` → `999.95` → `.toFixed(1)` → `"1000.0"` — renders the literal
   overflowed `"$1000.0M"` even when it hasn't technically reached a full billion, because the
   branch is picked off the raw unrounded value and the rounding happens only afterward, inside
   the already-chosen branch.

This is NOT a theoretical edge case for this specific call site. `discovery.dollar_vol` (`vol *
close`) comes from `screenBangerMovers` (`src/lib/banger/discovery.ts`), the whole-market banger
screen: `DEFAULT_BANGER_SCREEN_CONFIG` allows any close price `$5`–`$400` with **no upper bound on
share volume**, and the screen **sorts its qualifying candidates by raw dollar-volume
DESCENDING**. So the candidates this exact card is most likely to display are, by construction,
the highest-$-volume names that cleared that session's gain/close-strength bar — e.g. a $300
stock trading 10M+ shares on a breakout day already clears $3B, well within normal real-world
volume for a liquid mid/large-cap mover on an active session.

### Evidence

Reproduced directly against the extracted, exported `DiscoveryRationale` component (now exported
specifically for this), rendered via `react-dom/server`'s `renderToStaticMarkup` — no network/DB:

```
discovery.dollar_vol = 2_500_000_000  (a plausible breakout-day $-volume)
  pre-fix:  "$2500.0M"   (wrong unit, four-digit overflow)
  post-fix: "$2.5B"

discovery.dollar_vol = 999_950_000  (rounds to exactly 1000.0 of the M unit)
  pre-fix:  "$1000.0M"   (literal overflowed label)
  post-fix: "$1.0B"
```

Confirmed RED→GREEN via a targeted revert of just the formatting line (`git diff` restored after):
both new regression tests fail pre-fix with the exact pre-fix strings asserted above
(`'$1000.0M' !== undefined` for the match assertion — actual rendered HTML captured and shown in
the test failure output), pass after restoring the fix. Full
`src/features/nighthawk/components/BangerBoard.test.ts`: 3/3 green post-fix. Sibling
`src/lib/fmt-money.test.ts` (the shared formatter this fix now delegates to): 21/21 green,
unaffected. `npx tsc --noEmit` clean.

### Blast radius

Repo-wide grep for `dollar_vol` confirms `DiscoveryRationale` (`BangerBoard.tsx`) is the **only**
render-side consumer that formats this field into a displayed string — every other reference is
either the DB column name (`discovery_dollar_vol`), the API route that passes the raw number
through unformatted (`/api/market/banger/board/route.ts`), or an unrelated field with a similar
name (`breakout_source.ts`'s `dollar_volume`, a different metric on a different, excluded 0DTE
decision-logic surface). The fix is fully contained to this one card.

### Fix rationale

Delegate to the existing shared formatter (`fmtPremium`, `src/lib/fmt-money.ts`) instead of adding
a sixth narrower copy of the same billions/millions/thousands math — that module's own header
comment states this is deliberately the "single source of truth" for exactly this reason (several
of its ~15 prior duplicate copies rendered different strings for the same dollar figure). No other
line in `DiscoveryRationale` changed; `fmtPremium`'s sign handling is a no-op here since
`dollar_vol` (`vol * close`) is always non-negative.

### Regression tests added

`src/features/nighthawk/components/BangerBoard.test.ts` (new file — `DiscoveryRationale` is now
exported from `BangerBoard.tsx` specifically to make this testable without a full board mount):
- `promotes a billions-scale dollar_vol to the B tier instead of an overflowed 4-digit M label`
- `promotes a dollar_vol that ROUNDS to 1000.0M across the boundary, not just one that exceeds $1B
  outright`
- `still renders an ordinary sub-billion dollar_vol as an M figure` (no-regression guard)
