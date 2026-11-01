> **kind:** FINDING

## GexHeatmap `isMonthlyExpiry` never holiday-rolled the third Friday — mislabels the real listed monthly OpEx expiry on the two months a year it lands on a market holiday — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** round-276 discovery-lane audit sweep of `src/features/thermal/components/GexHeatmap.tsx`
(`TickerSwitcher`/`MatrixFreshness`/`ExpiryScopeBar` + their supporting pure helpers), per the
standing issue-handling policy.

**Root cause:** `isMonthlyExpiry(ymd)` classifies an expiry column on the GEX matrix axis as a
"standard monthly" OpEx date (drives the gold far-dated tint on matrix columns/chips, the
`monthlyExpiries`/`nearExpiries` split, and the "Near"/"Monthly" horizon-preset scoping) via:

```ts
function isMonthlyExpiry(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return false;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const dow = first.getUTCDay();
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  return d === firstFriday + 14; // third Friday
}
```

This is the RAW third-Friday calculation with **no holiday adjustment**. Equity/index options can
never expire on a day the market is closed — when the third Friday of a month is a market
holiday, the listed monthly contract's expiration moves to the preceding trading day, and that
rolled-back date is what Polygon actually serves as the expiry on the matrix's axis. The
server-side sibling that already had to solve this exact problem,
`monthlyExpiryYmd`/`thirdFridayYmd` (`src/features/meridian/lib/meridian-timeline.ts`, fixed
2026-08-21 after the same defect silently dropped a real options-expiration date from Meridian's
prior-OpEx history), documents the shared holiday set
(`isTradingDayEt`, `src/features/nighthawk/lib/session.ts`) and the exact two months this bites:
**2026-06-19 and 2027-06-18, both Juneteenth** (swept 2024-2028). `GexHeatmap.tsx`'s own
`isMonthlyExpiry` never inherited that fix — it is a separate, independent reimplementation of the
raw third-Friday math with no holiday awareness at all.

**Live evidence:** the real listed June-2026 monthly contract settles **2026-06-18** (the
Thursday before Juneteenth), confirmed via the shared `isTradingDayEt` holiday calendar
(`isTradingDayEt("2026-06-19") === false`). The pre-fix function:

```
OLD isMonthlyExpiry("2026-06-18") [the REAL listed expiry] = false  (should be true)
OLD isMonthlyExpiry("2027-06-17") [the REAL listed expiry] = false  (should be true)
```

(2027 is a double-roll case: the raw third Friday for June 2027 is itself 2027-06-18 — the
*observed* Juneteenth holiday, since the actual June 19 falls on a Saturday — so the real listed
contract rolls back one trading day further, to 2027-06-17.)

**Blast radius — all within `GexHeatmap.tsx`, all driven by the one misclassification:**
- The matrix column for that expiry lost its gold "far-dated monthly" tint (`chip(e, …,
  isMonthlyExpiry(e))` at the per-expiry chip, and the matrix-column badge at line ~3943) —
  rendered identically to an ordinary near-term weekly.
- `monthlyExpiries = expiries.filter(isMonthlyExpiry)` under-counted by one on any ticker whose
  far-dated axis reaches that month — which can in turn flip `hasMonthly`/`showHorizon` to false
  (hiding the Near/Monthly toggle entirely) if it was the ticker's only far-dated column that far
  out.
- `nearExpiries = expiries.filter(e => !isMonthlyExpiry(e))` wrongly ABSORBED the real monthly
  OpEx column into the "near-term dailies/weeklies only" set — so selecting the "Near" horizon
  preset re-scoped the Key Levels row (flip/walls/net-GEX/max-pain) to include the dominant
  monthly-OpEx expiry the filter exists specifically to exclude, diluting (or outright dominating)
  the near-term read with the far-dated book on exactly the two real calendar dates this fires on.

**Fix:** reimplemented the holiday-roll inline as `monthlyExpiryYmdClient`/`thirdFridayYmdClient`
(new, client-safe helpers in `GexHeatmap.tsx`), importing the SAME shared `isTradingDayEt`
(`@/features/nighthawk/lib/session`) the server-side `monthlyExpiryYmd` already uses — not a
second, independent holiday table. `isMonthlyExpiry(ymd)` now compares `ymd` against
`monthlyExpiryYmdClient(year, month)` instead of the raw third-Friday arithmetic.

**Fix rationale:** could not import `meridian-timeline.ts`'s `monthlyExpiryYmd` directly —
that module transitively imports `server-only` (via `meridian-benzinga-earnings-core.ts` →
`uw-earnings.ts`, per that file's own documented reason for NOT living there), and
`GexHeatmap.tsx` is a `"use client"` component. `isTradingDayEt` itself carries no such
dependency (confirmed: no `server-only` import, and `meridian-timeline.ts`'s own comment states
three client components already import it), so it is safe to import directly and reuse as the one
shared source of truth, while the pure third-Friday/roll-back arithmetic is duplicated locally
(same pattern this file already uses elsewhere for client-safe reimplementations of server
helpers). Deliberately left unchanged: every OTHER caller of the old raw-third-Friday math — there
are none; `isMonthlyExpiry` was the only production use of that formula in this file.

**Evidence (RED → GREEN):** added
`src/features/thermal/components/GexHeatmap-monthly-expiry-holiday.test.ts`, which extracts the
real `thirdFridayYmdClient`/`monthlyExpiryYmdClient`/`isMonthlyExpiry` function bodies verbatim
from the component source (via `new Function`, the same extraction pattern this file's sibling
tests already use for `MatrixFreshness`/`darkPoolByRow`) and executes them against the REAL
imported `isTradingDayEt`. RED (pre-fix, functions absent): the extraction itself fails with
`function not found: function thirdFridayYmdClient(` — proving the test genuinely needs the fix to
even run; the pre-fix function additionally independently verified wrong by direct call
(`isMonthlyExpiryOld("2026-06-18") === false`, `isMonthlyExpiryOld("2027-06-17") === false`, both
should be `true`). GREEN (fix applied): 4/4 new tests pass — holiday-roll for 2026-06-19→06-18,
the double-roll for 2027 (06-18 observed holiday → 06-17), an ordinary non-holiday third Friday
unchanged (2026-01-16), and malformed-input tolerance. Full `GexHeatmap*.test.ts` suite: 17/17
pass (no regression in the sibling `MatrixFreshness`/ticker-switch/dark-pool/header tests). Full
`src/features/thermal/**/*.test.ts`: 90/90 pass. `npx tsc --noEmit`: clean.
