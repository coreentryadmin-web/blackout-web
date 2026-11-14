## 2026-11-14 — [FINDING, cross-lane outcomes] mapSwingOutcome's pnl_pct rounded with a sign-biased tie, understating losses in get_horizon_outcomes

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | `src/lib/horizon-outcomes.ts`'s `mapSwingOutcome`/`mapZeroDteOutcome` rounded `pnl_pct` with a naive tie-toward-+Infinity `Math.round(n*100)/100`, the same sign-bias bug class fixed ~28 times this session — here it's the first rounding of the swing lane's raw P&L |
| **Status** | FIXED |

## What broke

`mapZeroDteOutcome` and `mapSwingOutcome` (the unified cross-lane `get_horizon_outcomes` read
layer Largo's track-record tools use) both rounded their `pnl_pct` field with
`Math.round(pnl * 100) / 100` — ties toward +Infinity (`Math.round(-12.5) === -12` but
`Math.round(12.5) === 13`), so a losing position's P&L sitting exactly on a 2dp tie would report
a smaller loss magnitude than the identical positive gain would.

For `mapZeroDteOutcome` this call is a harmless no-op in practice: its `pnl` comes from
`asManagedPnlPct` (`src/lib/zerodte/record.ts`), which already applies that file's own sign-safe
`round2` before returning, so re-rounding an already-2dp value with either algorithm gives the
same result. `mapSwingOutcome` is different: its `pnl` is `row.realized_pnl_pct` — the RAW DB
column, never rounded by anything upstream — so this was the first and only rounding of that
value, and the sign bias actually bites. `label` itself is unaffected (computed from the raw,
unrounded sign via `isSwingWin`), but the served `pnl_pct` number understates a tied negative
loss by exactly 1 cent of percentage.

## Fix

Added a shared sign-safe `round2` helper (`(Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100`,
the same algorithm established across the codebase this session) and used it at both call sites,
so the two map functions share one rounding convention instead of a bare inline `Math.round`.

## Verify

```
npx tsx --experimental-test-module-mocks --test src/lib/horizon-outcomes.test.ts
```
New test: `mapSwingOutcome: a negative realized_pnl_pct exactly on a 2dp rounding tie is not
understated` (`realized_pnl_pct: -0.125`, bit-exact `*100 === -12.5` tie). RED before the fix
(`pnl_pct` served as `-0.12`), GREEN after (`-0.13`).
