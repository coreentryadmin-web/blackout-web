> **kind:** FINDING

## SPX Pulse Rail `fmtNotional` renders `"+$1000M"` instead of `"+$1.0B"` at the unit boundary — FIXED

| | |
|---|---|
| **Area** | Night Hawk / SPX Pulse Rail (display-only formatter) |
| **File** | `src/features/spx/lib/spx-pulse.ts` — `fmtNotional()` |
| **Status** | FIXED |
| **Severity** | P3 (cosmetic/display correctness — wrong unit label, no data integrity impact) |

### Root cause

`fmtNotional(v)` formats a signed gamma-notional magnitude (`-$1.8B`, `+$640M`, `+$12M`). It
picked its display unit (B / M / K) off the **raw, unrounded** magnitude, then rounded the
quotient to that unit's own display precision **afterward**, with no check for whether the
rounding itself crossed into the next unit's threshold:

```ts
if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(1)}B`;
if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(0)}M`;   // <- no promote check
if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;            // <- no promote check
```

A notional of `$999,600,000` is `< 1_000_000_000`, so it took the **M** branch, then
`(999_600_000 / 1_000_000).toFixed(0)` rounds **up** to `"1000"` — rendering the literal
`"+$1000M"` instead of promoting to `"+$1.0B"`. The identical shape bites the K→M boundary
(`$999,600` → old `"+$1000K"` instead of `"+$1.0M"`).

This is the exact same bug class already fixed 16+ times across this repo this session
(`src/lib/fmt-money.ts`'s `fmtPremium`, `src/features/nighthawk/components/zerodte-board-
format.ts`'s `fmtMoney`, `src/features/helix/lib/helix-tide-money-format.ts`,
`src/features/thermal/lib/gex-heatmap-money-format.ts`, `src/features/helix/components/
DarkPoolPanel.tsx`'s `fmtShares`, among others) — `fmtNotional` was written as its own
standalone copy of the K/M/B threshold algorithm rather than reusing one of the already-fixed
shared helpers, so it silently carried the same defect every sibling formatter had already been
patched for.

### Evidence

RED (pre-fix, reverted locally): `fmtNotional(999_600_000)` → `"+$1000M"` (expected `"+$1.0B"`);
`fmtNotional(999_600)` → `"+$1000K"` (expected `"+$1M"`). Confirmed via a local revert of just
the function body, re-running `npx tsx --experimental-test-module-mocks --test
src/features/spx/lib/spx-pulse.test.ts` — 2 of the 3 new regression tests failed with exactly
this output before the fix, 0 failed after restoring it (38/38 pass).

### Blast radius

`fmtNotional` is exported and used at every live call site in this file and its consumer:
- `src/features/spx/components/SpxPulseRail.tsx` — the rail's live `gex_net` display
  (`netG = fmtNotional(desk.gex_net)`).
- `spx-pulse.ts`'s own wall-break-tracker narration (`why: "... grew ... ($…→$…) between
  polls."`) and the magnitude chip on those same signals (both call sites, growing and
  shrinking branches).
- `spx-pulse.ts`'s key-level gamma magnitude chip (`mag("notional", k.netGex, ...)`).

SPX net gamma exposure genuinely spans hundreds of millions to multiple billions in production
(this file's own test fixtures already use `netGex: 800_000_000` / `-600_000_000`), so the $1B
(and $1M) boundary is an ordinary live value for this caller, not a theoretical edge case.

A sibling local formatter in the same file, `fmtPremium` (used only for Tier-3 sweep-premium
headlines, unexported, ~line 650), has the same K-branch shape but was left unchanged here: its
input is a single flow print's premium, which realistically never approaches the $1B tier this
finding is about, and touching it would be a second, unrelated change outside this fix's scope.
It is flagged here for a future pass rather than silently left for someone to re-discover.

### Fix rationale

Round the quotient to its unit's own display precision **first**, then re-check (by magnitude,
since the quotient can be negative via `v`) whether the rounded value reached 1000 of that
unit — if so, re-render from the next unit up. This is the identical round-first-then-promote
guard shape already used by every sibling fix in this repo, chosen specifically so this change
stays mechanically identical to the established, reviewed pattern rather than introducing a new
one. Every non-boundary output (`+$800M`, `-$600M`, `+$12M`, `+$640`, `+$1.8B`) is byte-identical
to the pre-fix output — only the boundary case changes.

### Regression test

`src/features/spx/lib/spx-pulse.test.ts` — three new tests: K→M promotion, M→B promotion, and a
non-boundary-magnitudes-unchanged guard (covering the exact pre-existing doc-comment examples
`-$1.8B`, `+$640M`, `+$12M`).
