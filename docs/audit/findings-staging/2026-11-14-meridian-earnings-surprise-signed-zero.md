> **kind:** FINDING

## Meridian earnings `fmtSurprisePct` rendered a self-contradictory signed zero ("-0.0%"/"+0.0%") — FIXED

**Where:** `src/lib/meridian/meridian-earnings-analytics-core.ts`'s exported `fmtSurprisePct()` —
the one formatter every EPS/revenue surprise percentage on the Meridian earnings ANALYTICS surface
renders through: the `DeltaPill`/`Delta` component (headline EPS/rev surprise pills), the Calendar
Grid's per-day "avg surprise" tooltip, the Surprise Scatter's per-point tooltip and axis-bound
label, and the Beat/Miss Streak timeline's per-entry tooltip — all in
`src/features/meridian/components/MeridianEarningsAnalytics.tsx`.

**Root cause:** the formatter read its `+`/`-` sign off the RAW, unrounded value, then handed that
same raw value straight to `toFixed(digits)`:

```ts
export function fmtSurprisePct(v, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}
```

Native `toFixed` preserves the ORIGINAL sign of a value even when its rounded magnitude is exactly
zero (`(-0.001).toFixed(1) === "-0.0"`, confirmed in this sandbox). So any tiny nonzero surprise
that rounds to 0 at the display precision — entirely plausible: a few thousand dollars of revenue
drift against a mega-cap estimate (`-0.0001` as a fraction = a 0.01% revenue miss) is a realistic
real-world surprise magnitude, not a contrived edge case — rendered as the literal string "-0.0%"
(for a negative raw value) or "+0.0%" (for a positive one). A signed zero is self-contradictory on
its face: the magnitude displayed is "0.0" (flat/in-line) while the sign asserts a direction the
number itself does not support — the exact "label asserts something the adjacent number
contradicts" bug class this session has already found and fixed once in
`group-greek-flow-summary.ts` (PR #7923).

This is also the SAME underlying bug class, with the SAME fix, already applied twice elsewhere in
this repo and explicitly documented as such: `fmtPct` in `src/lib/fmt-money.ts` (fixed 2026-10-26,
"Sign is read off the ROUNDED value, not the raw one... a raw value that rounds to exactly 0 at the
requested precision... must read '0.0%', never the misleading '+0.0%' a raw-value sign check would
produce") and `fmtShiftPercentForStrike` in `src/features/thermal/lib/gex-heatmap/shift-math.ts`
("Sign is read off the ROUNDED value, not the raw one, so a magnitude that rounds to exactly 0...
reads '0%', never a misleading signed '−0%'"). `fmtSurprisePct` is a third, independent formatter in
the same codebase doing the identical percent-formatting job and was missed by both earlier passes.

**Evidence (RED → GREEN, isolated via `git checkout` of the source file with the new test
assertions left in place):**
- RED: `fmtSurprisePct(-0.0001)` → `"-0.0%"` (expected `"0.0%"`); `fmtSurprisePct(0.00001)` →
  `"+0.0%"` (expected `"0.0%"`). Confirmed by running
  `npx tsx --experimental-test-module-mocks --test meridian-earnings-analytics-core.test.ts`
  against the unmodified source with the new assertions added: 1 failing (19 pass / 1 fail).
- GREEN (post-fix): same test file, fixed source: 20/20 passing.
- `npx tsc --noEmit` clean on the whole project (Node 20).
- Sibling dependent suite `meridian-earnings-intel-core.test.ts` (which also exercises this
  analytics core) still 38/38 passing — confirms the fix did not disturb anything downstream.

**Fix:** mirrors `fmtPct`'s own fix exactly — round the MAGNITUDE first
(`Math.round(Math.abs(pct) * factor)`), then reapply the ORIGINAL sign via `Math.sign(pct)`. A
value whose magnitude rounds to 0 now produces `+0`/`-0`, and `(±0).toFixed(digits)` renders a bare
`"0.0"` with no stray minus (verified live, not assumed: `(-0).toFixed(1) === "0.0"`); the
`sign = rounded > 0 ? "+" : ""` check is also `false` for both `+0` and `-0`, so no prefix is added
either. Real nonzero surprises are unaffected (`fmtSurprisePct(0.0447)` still `"+4.5%"`,
`fmtSurprisePct(-0.12)` still `"-12.0%"`, both pinned by existing tests that still pass).

**Blast radius:** `fmtSurprisePct` is called from five sites in
`MeridianEarningsAnalytics.tsx` (the `Delta` component used by the headline pills, the calendar-cell
tooltip, the scatter-point tooltip, the scatter axis-bound label, and the beat/miss-streak entry
tooltip) — all fixed together by fixing the one shared formatter. A second, differently-scoped
`fmtSurprisePct` exists locally in `MeridianEarningsTabs.tsx`, but it formats an ALREADY-display-percent
field (`MeridianEarningsCalendarRow`, scaled via `benzingaSurpriseToDisplayPct` in
`meridian-benzinga-earnings-core.ts`) rather than the fraction convention this core file's rows use —
a separate function on a separate data shape, left untouched here as out of scope for this fix (it
has its own, lower-severity version of a similar edge case, but changing it is a separate PR against
a different data path). No other call site of the fixed `fmtSurprisePct` exists in the repo
(confirmed via grep).

| **Status** | FIXED |
