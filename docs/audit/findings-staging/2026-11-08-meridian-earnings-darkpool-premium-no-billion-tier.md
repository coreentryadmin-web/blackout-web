> **kind:** FINDING

## Meridian earnings dark-pool premium formatter had no billion tier at all — FIXED

| | |
|---|---|
| **Area** | Meridian desk — earnings dark-pool card (`shapeMeridianDarkPool`) |
| **Status** | FIXED |
| **File** | `src/lib/meridian/meridian-earnings-intel-core.ts` |
| **Function** | `fmtPremShort` |

### Root cause

`fmtPremShort` — the sole formatter behind `shapeMeridianDarkPool`'s `total_premium_label`,
`call_premium_label`, `put_premium_label`, and every `top_prints[].premium_label` on the Meridian
earnings panel's dark-pool card — had no `B` (billion) tier at all:

```ts
function fmtPremShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;   // <- every value past $1M
  if (abs >= 1_000) { ... }                                         //    goes through here
  return `$${n.toFixed(0)}`;
}
```

Any value at or past $1B printed as `$X.XM` with no digit cap — e.g. `1_500_000_000` rendered
`"$1500.0M"` instead of the correct `"$1.5B"`. This is distinct from, and not covered by, the
K→M fix already present in the same function (the comment block still in the file, "BUG FIX
(round 399)") — that fix closed the lower K→M seam only; it never added a B tier, so a value that
rounded up past 1000 at the M unit had nowhere to promote to either.

Dark-pool aggregate session premium for a heavily-traded mega-cap around earnings routinely runs
into the hundreds of millions to low billions (NVDA/AAPL/TSLA-class names), so this is a real,
reachable member-facing display defect, not a theoretical edge case.

### Evidence (RED → GREEN)

New regression test (`src/lib/meridian/meridian-earnings-intel-core.test.ts`):

```ts
test("shapeMeridianDarkPool: billion-scale premium promotes to the B unit, not '$1500.0M'", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [{ strike: 450, premium: 1_500_000_000, side: "buy", executed_at: "2026-11-08T14:30:00" }],
    total_premium: 1_500_000_000,
    call_premium: 1_500_000_000,
    put_premium: 0,
    bias: "bullish",
    pcr: null,
    detail: "1 print(s) | $1.50B",
  });
  assert.equal(shaped.total_premium_label, "$1.5B");
  assert.equal(shaped.call_premium_label, "$1.5B");
  assert.equal(shaped.top_prints[0].premium_label, "$1.5B");
  assert.notEqual(shaped.total_premium_label, "$1500.0M");
});
```

Ran with the source fix `git stash`ed (test change kept): **1 failure** — `total_premium_label`
was `"$1500.0M"`, confirming the exact described defect. Restored the fix: full suite for this
file **33/33 pass**.

### Blast radius

Single producer, four consumer fields on one payload shape: `shapeMeridianDarkPool`'s
`total_premium_label`, `call_premium_label`, `put_premium_label`, and
`top_prints[].premium_label` — all four go through the same `fmtPremShort`, so the regression
test asserts all four in one snapshot (as the existing round-399 K→M regression test already does
for its own boundary). No other file defines or calls this function; it is local to
`meridian-earnings-intel-core.ts`.

### Fix rationale

Added a `B` tier using the exact same round-first-then-promote guard already shipped this session
for the identical bug class elsewhere in the repo — `fmt-money.ts`'s `fmtPremium`, and this file's
own sibling `fmtCompactMoney` in `meridian-earnings-analytics-core.ts` (whose header explicitly
lists the other fixed call sites and whose B-tier logic this fix mirrors exactly): round the
quotient to the unit's own display precision (1dp) FIRST, then check whether that rounded value
crossed the next threshold, and promote. Precision at each tier (B: 1dp, M: 1dp, K: 0dp) is
unchanged from the original for every value that was never near a boundary — only the previously
missing B tier and its promotion path are new. No tier beyond B was added, matching the scope of
every sibling formatter already fixed.
