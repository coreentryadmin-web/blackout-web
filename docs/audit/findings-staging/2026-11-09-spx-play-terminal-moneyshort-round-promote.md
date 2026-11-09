# 2026-11-09: SPX play-terminal `moneyShort()` rounded a near-$1M flow net to "$1000K" instead of promoting to "$1.0M" — FIXED

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/features/spx/lib/spx-play-terminal-lines.ts`'s local `moneyShort()` formatter — used to
render the "0DTE flow net" line in the SPX Slayer play terminal (`desk.flow_0dte_net`, an
unbounded signed net-premium sum computed server-side from the live 0DTE flow tape) — picked its
K/M unit by comparing the RAW, unrounded magnitude against the `1_000_000` boundary, then rounded
INSIDE the chosen branch. A net premium value just under that boundary (e.g. `999,600`) has
`abs < 1_000_000`, so it took the K branch, where `Math.round(999600 / 1000)` evaluates to
`1000` — rendering the line as `"0DTE flow net $1000K"` instead of the correct `"$1.0M"`. Same
defect, same sign, on the negative side (`-999,600` rendered `"$-1000K"` instead of `"$-1.0M"`).

This is the same "round-first-then-promote" money-formatter bug class already fixed in ~18 other
instances this audit cycle (the shared `fmtPremium` in `src/lib/fmt-money.ts`, and
`DarkPoolPanel.tsx`'s `fmtShares`, among others) — `moneyShort()` in this file was an independent,
unfixed copy of the same shape that those prior passes had not reached yet.

## Root cause

```ts
function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;   // <-- rounds AFTER the unit is chosen
  return `$${Math.round(n)}`;
}
```

The unit-selection comparison (`abs >= 1_000_000`) runs against the raw value, but the displayed
K value is only computed afterward, inside the branch — so a value that *rounds* up to 1000 of
that unit never gets a chance to re-evaluate which unit it belongs in. `moneyShort()` is called
with `desk.flow_0dte_net` (`spx-play-terminal-lines.ts:212`), a live signed dollar sum (confirmed
via `src/lib/platform/types.ts`, `src/lib/admin-spx-dashboard.ts`, `src/lib/bie/spx-desk-brief.ts`
and the engine's own test fixtures using values from `-400_000` to `900_000`) with no floor/ceiling
that would keep it away from the `[999,500, 999,999]` boundary band — a real RTH session can land
exactly there.

## Evidence

Added a regression test (`spx-play-terminal-lines.test.ts`) feeding `flow_0dte_net: 999_600` (and
the negative mirror `-999_600`) through the real, exported `buildPlayTerminalLines()` entry point
(not a reimplementation) and asserting the rendered line:

- **RED (pre-fix):** `"0DTE flow net $1000K · aligned with bias"` — assertion on `/\$1\.0M/`
  failed; `/1000K/` matched.
- **GREEN (post-fix):** `"0DTE flow net $1.0M · aligned with bias"` for the positive case, and
  `"$-1.0M"` for the negative case; no `1000K` anywhere in the rendered output.

## Blast radius

`moneyShort()` is private to this file and has exactly one call site
(`spx-play-terminal-lines.ts:212`, the `flow_0dte_net` line), confirmed via grep — no other
consumer of this specific function is affected. It is NOT the same function as the shared
`fmtPremium`/`fmtShares` helpers already fixed elsewhere; those live in `fmt-money.ts` and
`lib/api.ts` respectively and are unrelated copies that happened to share the same original bug
shape before being fixed independently.

Two other round-474-flagged candidates in this same bug-class sweep were checked and found
**already fixed / not reachable, no change needed**:
- `src/features/vector/lib/vector-pulse.ts`'s `fmtPremium` — its only call site
  (`flowAlertToPulseSignal`) already returns `null` before calling it for any premium below
  `FLOW_MIN_PREMIUM = 1_000_000`, so the K branch is unreachable by construction (same shape as
  the previously-confirmed-dead `spx-pulse.ts` `fmtPremium`) and there is no higher (B) tier for a
  "stuck at 999M" variant of this bug to manifest against.
- `src/features/helix/components/DarkPoolPanel.tsx`'s local `fmtShares` — already carries the
  round-first-then-promote fix (explicit code comment: "same round-first-then-promote fix as
  darkpool-discord-format.ts's own sibling fmtShares"); the imported `fmtPremium` in the same file
  resolves to `src/lib/fmt-money.ts`'s shared formatter, also already fixed.

## Fix rationale

Round first, then re-check whether the rounded value reached 1000 of that unit before committing
to the K label — the same pattern already applied to the shared formatters:

```ts
if (abs >= 1_000) {
  const k = Math.round(n / 1_000);
  if (Math.abs(k) >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${k}K`;
}
```

No behavior changed for any value outside the `[999,500, 1,000,000)` / `(-1,000,000, -999,500]`
boundary bands — every other branch and every other call path is untouched.

## Bonus cleanup (separate, no behavior change)

While re-verifying round 474's flagged dead-code candidate, independently confirmed
`src/features/meridian/components/MeridianEventDetailPanel.tsx`'s local `fmtPrem()` (lines 28-33)
was declared but never called anywhere in the file or the rest of the repo (repo-wide grep).
Removed it in the same PR as a small, separate, no-test-needed cleanup — it has zero behavioral
effect since nothing ever referenced it.
