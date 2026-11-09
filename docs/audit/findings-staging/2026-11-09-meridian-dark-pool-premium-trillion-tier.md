> **kind:** FINDING

## `fmtPremShort` (Meridian dark-pool premium formatter) had no trillion tier — a value past ~$1T rendered a nonsensical 4+ digit "$1500.0B" instead of promoting to "$1.50T" — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (cosmetic display defect, no data corruption — label-only) |
| **Area** | `src/lib/meridian/meridian-earnings-intel-core.ts` (`fmtPremShort`, feeds `shapeMeridianDarkPool`'s `total_premium_label`/`call_premium_label`/`put_premium_label`/`top_prints[].premium_label` on the Meridian earnings dark-pool card) |

### Root cause

`fmtPremShort` is this file's own private compact-money formatter for dark-pool print premiums.
Its own header comment documents two prior rounds fixing the exact same defect shape one tier
lower each time:

- **Round 399**: the K unit was picked off the *unrounded* value, then the chosen unit's own
  rounding could carry it past its own threshold (`999_600` → K branch → `(999600/1000).toFixed(0)`
  rounds up to `"1000"` → rendered `"$1000K"` instead of promoting to `"$1.0M"`).
- **Round 419**: the function had **no B tier at all** — every value past $1M printed `"$X.XM"`
  regardless of magnitude, so a billion-scale aggregate rendered `"$1500.0M"` instead of `"$1.5B"`.

Both fixes landed the "round-to-the-unit's-own-precision FIRST, then check whether THAT rounded
value crossed the next threshold" pattern, explicitly described as mirroring `fmtCompactMoney`
in `meridian-earnings-analytics-core.ts` "exactly". But `fmtCompactMoney` carries **four** tiers
(K/M/B/T, with an overflow guard at every seam up to and including the B→T one). Round 419 only
ever added the B tier here — nothing above it:

```ts
if (abs >= 1_000_000_000) {
  return `$${(n / 1_000_000_000).toFixed(1)}B`;   // unconditional — no overflow check
}
```

Unlike the K and M branches below it (both of which guard against rounding past their own unit's
threshold), this branch has **no** such guard at all, so there is nowhere for a value at or past
~$1T — or one that merely *rounds up* to it at the B unit's own precision (e.g.
`999_950_000_000`, which is `< 1e12` but rounds to `1000.0` at one decimal) — to promote to. It
renders the same class of nonsensical multi-digit label the two prior rounds fixed one tier down
each time: `"$1500.0B"` instead of `"$1.50T"`.

### Evidence (RED → GREEN)

Extended the existing test file (`src/lib/meridian/meridian-earnings-intel-core.test.ts`), adding
one case directly alongside the round-419 B-tier regression test, same shape:

```ts
test("shapeMeridianDarkPool: trillion-scale premium promotes to the T unit, not '$1500.0B'", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [{ strike: 450, premium: 1_500_000_000_000, side: "buy", executed_at: "2026-11-08T14:30:00" }],
    total_premium: 1_500_000_000_000,
    call_premium: 1_500_000_000_000,
    put_premium: 0,
    bias: "bullish",
    pcr: null,
    detail: "1 print(s) | $1.50T",
  });
  assert.equal(shaped.total_premium_label, "$1.50T");
  ...
  assert.notEqual(shaped.total_premium_label, "$1500.0B");
});
```

**RED** (pre-fix, `npx tsx --experimental-test-module-mocks --test` on the unmodified file):

```
not ok 12 - shapeMeridianDarkPool: trillion-scale premium promotes to the T unit, not '$1500.0B'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + '$1500.0B'
    - '$1.50T'
```

**GREEN** after the fix below: full file 34/34 pass; the whole `src/lib/meridian/*.test.ts`
directory (23 suites) 537/537 pass; `npx tsc --noEmit` clean.

### Blast radius

`fmtPremShort` is module-private (not exported) with exactly one caller, `shapeMeridianDarkPool`
in the same file, which feeds every premium label on the Meridian earnings dark-pool card
(`total_premium_label`, `call_premium_label`, `put_premium_label`, and each `top_prints[]` row's
`premium_label`). No other formatter in the repo shares this function (checked: the sibling
K→M/K→M→B money-formatting pattern across the rest of the codebase — `helix-contract-notional-
format.ts`, `helix-flow-format.ts`, `thermal-compact-matrix.ts`, `gex-heatmap-money-format.ts`,
`fmt-money.ts`'s `fmtPremium`, and `meridian-earnings-analytics-core.ts`'s `fmtCompactMoney`
itself — was already fully swept and confirmed clean/fixed earlier this session; this file's own
`fmtPremShort` is a separate, hand-maintained copy that only mirrors the pattern rather than
importing it, which is exactly how it fell one tier behind its sibling).

### Fix rationale

Added the same round-first-then-promote overflow guard the B tier already uses, one tier up, so
the B branch checks whether its own rounded value crossed into T before returning:

```ts
if (abs >= 1_000_000_000) {
  const b = Math.round((abs / 1_000_000_000) * 10) / 10;
  if (b >= 1000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
  return `$${(n / 1_000_000_000).toFixed(1)}B`;
}
```

`toFixed(2)` for the T tier matches `fmtCompactMoney`'s own T-tier precision exactly, keeping the
two siblings' output format consistent at the one tier they both now cover. No tier above T was
added, matching `fmtCompactMoney` (which also stops at T) and every other sibling formatter in
the repo — none of them guard past their own top tier either, so this keeps the fix scoped to
closing the one gap found rather than speculatively adding a new unit. The K and M branches, the
B tier's own `.toFixed(1)` precision, and every other formatter in the repo are unchanged.
