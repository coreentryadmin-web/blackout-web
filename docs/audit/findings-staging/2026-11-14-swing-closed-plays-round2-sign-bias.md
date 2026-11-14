## 2026-11-14 — [FINDING, swing closed-deck] closed-plays.ts's own round2 ties toward +Infinity, mismatching record.ts's already sign-safe compositePnl and silently nulling known fields

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | `closed-plays.ts`'s local `round2` had the same sign-bias rounding-tie bug as ~27 other instances fixed this session — and here it didn't just mis-DISPLAY a number, it broke an equality comparison against an already-fixed sibling value |
| **Status** | FIXED |

## What broke

`src/lib/swing/closed-plays.ts` defined its own `round2 = (n) => Math.round(n * 100) / 100`, the
naive tie-toward-+Infinity rounding this session's sweep has fixed ~27 times elsewhere
(`Math.round(-12.5) === -12` but `Math.round(12.5) === 13`, so a negative value exactly on a 2dp
tie rounds to a SMALLER magnitude than the identical positive magnitude would).

`closedDeckSourcesFromChains` uses this `round2` for two equality comparisons against
`compositePnl` (`record.composite.worstLegPnlPct`), which `src/lib/swing/record.ts` already
computes with the **correct** sign-safe algorithm (`roundSignSafe`, added in an earlier round of
this same sweep):

- `worstLegIsTerminal = ... && round2(terminalPnl) === compositePnl` (line ~405)
- `worstLegRow = ordered.find((r) => round2(fin(r.realized_pnl_pct)) === compositePnl)` (line ~463)

When a leg's `realized_pnl_pct` sits exactly on a 2dp rounding tie (e.g. `-0.125`, where
`-0.125 * 100 === -12.5` bit-exact — not a float-residue artifact), the naive `round2` here
disagrees with `record.ts`'s sign-safe `compositePnl` by one cent. On a **single-leg chain**
(where the terminal leg is trivially the only/worst leg), both comparisons above then fail,
`worstLegRow` stays `null`, and every "borrow from worst leg, else fall back to the terminal leg's
own value" field in the pushed row — `entryPremium`/`peakPremium`/`troughPremium`/`exitAt`/
`committedAt`/`firstSeenAt`/`cortex`/`budgetVerdict`/`laneRankAtCommit`/
`entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`/`trimEnforcedBeforeClose` — is served as a
fabricated `null` instead of the real, known value sitting right there on the only row in the
chain, because `worstLegIsTerminal` reads as false.

## Fix

Changed `closed-plays.ts`'s local `round2` to the same sign-safe algorithm already established
across the codebase this session (`record.ts`'s `roundSignSafe`, `fmt-money.ts`, `api.ts`, etc.):
`(Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100`. Kept it local (not imported from
`record.ts`) because `record.ts` doesn't export `roundSignSafe` and this file is pure/import-light
by design. `entryPremium`/`peakPremium`/`troughPremium` (also rounded by this helper) are always
non-negative premiums, so only the two `compositePnl` equality comparisons were actually affected
by the sign bias — but the fix is the one shared helper, so both the signed and unsigned call
sites move together, matching the repo-wide convention.

## Verify

```
npx tsx --experimental-test-module-mocks --test src/lib/swing/closed-plays.test.ts
```
New test: `closedDeckSourcesFromChains > does not null out known fields on a single-leg chain
whose P&L sits on a 2dp rounding tie` — RED with the naive `round2` (entryPremium/peakPremium/
troughPremium/positionId all wrongly `null`/mismatched), GREEN after the fix.
