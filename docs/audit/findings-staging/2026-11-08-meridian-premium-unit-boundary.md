> **kind:** FINDING

# Meridian dark-pool/net-premium formatter rounds a near-$1M value past its own K→M boundary and never promotes — "$1000K" instead of "$1.0M"

| | |
|---|---|
| **Area** | Meridian earnings intel — `src/lib/meridian/meridian-earnings-intel-core.ts` (`fmtPremShort`, feeds `shapeMeridianDarkPool`) and its duplicated twin `src/lib/meridian/meridian-earnings-intel.ts` (`fmtPrem`) |
| **Severity** | P3 — cosmetic/display defect on member-facing premium labels (dark-pool prints, net flow premium, net GEX), not a wrong underlying value, but reads as broken/un-formatted on exactly the premium sizes ($900K–$1M) the earnings-intel panel highlights most |
| **Status** | FIXED |

## Root cause

Both `fmtPremShort` (meridian-earnings-intel-core.ts) and its duplicated twin `fmtPrem`
(meridian-earnings-intel.ts) pick the display UNIT (raw / K / M) off the **unrounded** input
value, then round *inside* the chosen unit — so a value that rounds UP past its own unit's own
threshold never promotes to the next unit:

```ts
function fmtPremShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;   // <-- unit picked BEFORE rounding
  return `$${n.toFixed(0)}`;
}
```

For `n = 999_600`: `abs >= 1_000_000` is false (999,600 < 1,000,000), so it takes the K branch.
`(999_600 / 1_000).toFixed(0)` = `"1000"` (999.6 rounds up to 1000) — so the function returns the
literal string **`"$1000K"`** instead of promoting to the M unit it had actually rounded into
(`"$1.0M"`). This is the exact "unit chosen before rounding, so a value near a unit boundary can
round up past its own threshold and never promote" pattern already fixed at 7 other call sites
this session (most recently `vector-pick-evidence.ts`, PR #7556) and already guarded against in
`src/lib/fmt-money.ts`'s `fmtPremium` (see its own in-code comment: *"A value that ROUNDS to 1000
of this unit belongs in the next unit up, not an overflowed four-digit label"*) — these two
Meridian functions were two instances that pattern-grep had not yet reached.

Any dark-pool print, aggregate dark-pool premium (total/call/put), net flow premium, or net GEX
value landing in the real, common `[999,500, 1,000,000)` window renders this way. $900K–$1M is an
ordinary size for a single-name dark-pool block print or a net options-flow premium figure, not an
edge case that needs an unusual input.

## Evidence (RED → GREEN)

New test in `src/lib/meridian/meridian-earnings-intel-core.test.ts`:

```ts
test("shapeMeridianDarkPool: premium that rounds up to 1000K promotes to the M unit, not '$1000K'", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [{ strike: 100, premium: 999_600, side: "buy", executed_at: "2026-11-08T14:30:00" }],
    total_premium: 999_600,
    call_premium: 999_600,
    put_premium: 0,
    bias: "bullish",
    pcr: null,
    detail: "1 print(s) | $999.60K",
  });
  assert.equal(shaped.total_premium_label, "$1.0M");
  assert.equal(shaped.call_premium_label, "$1.0M");
  assert.equal(shaped.top_prints[0].premium_label, "$1.0M");
  assert.notEqual(shaped.total_premium_label, "$1000K");
});
```

```
# pre-fix (git show origin/main:... restored over the fix for this one run)
$ npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-earnings-intel-core.test.ts
# tests 32
# pass 31
# fail 1   <-- the new test, total_premium_label was "$1000K"

# post-fix (fix restored)
$ npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-earnings-intel-core.test.ts
# tests 32
# pass 32
# fail 0
```

`npx tsc --noEmit` clean post-fix.

## Blast radius

Two call sites share this exact root cause — a literally duplicated private formatter, not a
shared import:

1. `meridian-earnings-intel-core.ts`'s `fmtPremShort` — feeds every `premium_label` on
   `shapeMeridianDarkPool`'s output (`total_premium_label`, `call_premium_label`,
   `put_premium_label`, and each `top_prints[i].premium_label`), consumed by the Meridian earnings
   dark-pool card.
2. `meridian-earnings-intel.ts`'s `fmtPrem` — byte-for-byte the same defective branch, feeding
   `premium_label` on flow rows/aggregates and `net_label`/the net-premium and net-GEX labels in
   `loadMeridianEarningsIntel`'s output (lines 194, 205, 347, 383, 387 pre-fix).

Both are fixed identically in this PR. `meridian-earnings-intel.ts` carries `import "server-only"`
and cannot be exercised by the plain node test runner (CLAUDE.md environment lesson #2/#3); its
fix is proven correct by being byte-identical logic to the testable twin above, with an in-code
comment pointing at the regression test that covers it.

**Explicitly out of scope** (same superficial shape, different, independently-owned files —
deliberately not touched to keep this PR single-issue): `GexHeatmap.tsx`, `thermal-compact-matrix.ts`
and `thermal-discord-card.ts` (already carry the overflow guard), `MeridianEventDetailPanel.tsx`,
`MeridianEarningsEstimatesPanel.tsx`/`MeridianEarningsTabs.tsx`, `VectorCrosshairLegend.tsx`,
`ZeroDteBoard.tsx` (nighthawk-core, excluded territory), and the Largo/SPX card formatters (excluded
territory). Worth a future round's grep pass if the K→M pattern audit continues.

## Fix rationale

Mirror the existing, already-shipped guard from `fmt-money.ts`'s `fmtPremium`: inside the K branch,
check whether the *rounded* K value has reached 1000 and, if so, render from the M unit instead of
returning the overflowed K string. This is the minimal, already-precedented fix — no new formatting
convention introduced, no change to the M-and-above behavior (no B tier existed before and none is
added now, consistent with these two functions' existing scope), and no change to any caller's
shape (both functions keep returning a plain `string`).
