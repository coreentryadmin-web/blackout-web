> **kind:** FINDING

# Two duplicated `formatPrem` copies in the Largo compare/pre-earnings cards overflowed to "$1000K" instead of promoting to "$1.0M"

| | |
|---|---|
| **Area** | Largo chat UI cards — `src/features/largo/components/LargoPreEarningsPackCard.tsx`, `src/features/largo/components/LargoCompareCard.tsx` |
| **Severity** | P3 — cosmetic money-format defect (same class as the ~27 instances already fixed this session), member-visible but not a correctness/data issue |
| **Status** | FIXED |

## Root cause

Both files carried their own private copy of the same K/M-tier compact-money formatter:

```ts
function formatPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
```

This is the exact "round-first, promote-second" ordering bug this session has already fixed
across the rest of the app (`fmt-money.ts`'s `fmtPremium`, `helix-flow-format.ts`'s `fmtOi`,
`darkpool-discord-format.ts`'s `fmtShares`, `thermal-discord-card.ts`'s `fmtCompactHeatMoney`,
`discord-context-enrichment.ts`'s `formatAdvShareLabel`, etc.): the `abs >= 1_000_000` gate is
evaluated **before** rounding, so a value just under one million — e.g. `999_700` — fails that
gate, falls into the K branch, and `(999_700 / 1_000).toFixed(0)` rounds to the string `"1000"`.
The result renders as the overflowed, four-digit `"$1000K"` instead of promoting to `"$1.0M"`.

Both call sites feed this from a real, unbounded live dollar figure:
- `LargoPreEarningsPackCard.tsx` renders `card.flow.net_premium`, which
  `src/lib/largo/pre-earnings-pack.ts` computes as `net_premium: total >= 1 ? net : null` — a raw
  summed flow premium with no upper or lower bound away from the $1M boundary.
- `LargoCompareCard.tsx` renders the same shape's `net_premium` on **two** separate render paths:
  the HELIX-vs-Thermal `CompareSide` ("Net premium …") and the peer-ticker table's
  `PeerTickerCompareView` row ("Net …") — both reading `HelixThermalSide.net_premium`, itself a
  live summed flow premium from `src/lib/largo/helix-thermal-compare.ts`.

A ticker heading into earnings (or being compared against a peer) with roughly $900K-$999K of net
flow premium — an entirely ordinary magnitude for a single name — would have rendered the
nonsensical `"$1000K"` on either card.

## Evidence (RED → GREEN)

New tests `src/features/largo/components/LargoPreEarningsPackCard.test.ts` and
`src/features/largo/components/LargoCompareCard.test.ts` render each component with
`renderToStaticMarkup` (same pattern as `HawkRecordStrip.test.ts`) and feed `net_premium: 999_700`:

```
git stash   (pre-fix, local formatPrem restored)
npx tsx --experimental-test-module-mocks --test \
  src/features/largo/components/LargoPreEarningsPackCard.test.ts \
  src/features/largo/components/LargoCompareCard.test.ts
# actual HTML contains: <p class="largo-struct-meta">Bias bullish · Net $1000K</p>
# actual HTML contains: <p class="largo-compare-meta">Net $1000K</p>
# 3 failing (one per render path + the sibling card)

git stash pop   (post-fix)
# 6/6 passing — every render path now shows "$1.0M", "1000K" never appears
```

Also ran `tsc --noEmit` on the full project (clean) after the fix.

## Blast radius

Exactly these two files, three render call sites (one in `LargoPreEarningsPackCard.tsx`, two in
`LargoCompareCard.tsx` — the HELIX/Thermal side and the peer-ticker row both called the local
`formatPrem` in that file). No other file imports or re-implements either local helper — confirmed
via `grep -rn "function formatPrem"` across `src/`, which returned only these two definitions.

## Fix rationale

Deleted both private `formatPrem` copies and replaced every call site with the already-fixed,
already-unit-tested shared `fmtPremium` from `src/lib/fmt-money.ts` (which also adds a correct
Billions tier and a sub-$10K one-decimal precision these two local copies never had) — the same
remedy applied earlier this session to `vector-play-candidates.ts`'s whale-print bullet, rather
than hand-patching a third near-identical round-then-promote guard into two more files. Nothing
else in either component changed; `fmtPremium`'s `n: number | null` signature is a strict superset
of the local helper's `n: number`; every call site already null-checks before calling it.
