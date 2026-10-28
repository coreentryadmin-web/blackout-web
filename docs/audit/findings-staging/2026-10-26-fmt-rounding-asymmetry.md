> **kind:** `FINDING`

## `fmtPct()`/`roundFloats()` ties toward +Infinity, not away-from-zero — a negative percentage sitting exactly on a display-precision tie rounded to a SMALLER magnitude than the identical positive one — FIXED

| | |
|---|---|
| **Severity** | P2 (display-correctness — a losing position's percentage silently read as smaller/less-bad than the mirror-image winner at the same magnitude; no data was mis-recorded, only mis-displayed at exact tie boundaries) |
| **Surface** | `src/lib/fmt-money.ts` — `fmtPct()`; `src/lib/round-floats.ts` — `roundFloats()`. Both are the two canonical, widely-shared rounding primitives for everything downstream of raw float math across the whole product (percentage/distance display and the JSON response-shaping boundary, respectively). |
| **Status** | FIXED |

### Root cause

Both functions rounded with the plain, unguarded pattern `Math.round(n * factor) / factor`.
JavaScript's `Math.round` ties **toward +Infinity**, not away from zero:

```
Math.round(13.5)  === 14   // positive tie rounds UP (away from zero)
Math.round(-13.5) === -13  // negative tie rounds UP TOO (toward zero — a SMALLER magnitude)
```

This is a direction-biased asymmetry, not a magnitude-biased one: for any value sitting exactly on
a display-precision tie, the POSITIVE case always rounds away from zero (bigger magnitude) while
the NEGATIVE case always rounds toward zero (smaller magnitude). The two mirror-image magnitudes
are not treated symmetrically.

**Live repro:** an Exec P&L line computed as entry `$14.80`, bid `$14.60` → raw `-1.35%` →
`fmtPct(-1.35, 1)` rendered `"-1.3%"`, while the identical `+1.35%` magnitude rendered `"+1.4%"` via
`fmtPct(+1.35, 1)`. A losing position's displayed percentage read as smaller (looked less bad) than
the mirror-image winning position at the exact same magnitude — purely a tie-breaking-direction
artifact, not a real difference in the underlying numbers.

`roundFloats()` carries the identical bug at the JSON response-shaping boundary used by ~168
source files repo-wide (every `NextResponse.json` route that wraps its payload in `roundFloats()`,
plus every library that rounds a derived field before serving it) — any negative field (P&L%,
distance%, dealer-gamma deltas, etc.) sitting on an exact tie at its own `dp` is subject to the
same smaller-magnitude bias.

### Why this went undetected

`src/lib/fmt-money.test.ts` already had a "matches `roundFloats()` byte-for-byte" regression test
covering `fmtPct(-1.05)`, but its local `roundFloatsStyle` comparison helper was a literal copy of
the SAME biased algorithm — so the test only ever asserted **internal self-consistency** (fmtPct
and the local copy agreed, because both shared the identical bug) and never compared the negative
case's magnitude against the positive case directly. A test that reproduces a bug in its own
oracle can never catch that bug.

### Evidence

RED→GREEN confirmed via a source-only revert (`git show HEAD:<file>` to restore the pre-fix
content of just `fmt-money.ts`/`round-floats.ts`, test files left untouched — `git stash` was
avoided here since this repo's worktree stash stack is shared across concurrent sessions):

- **Before the fix** (original `Math.round(n*factor)/factor`), the 3 new symmetric-pair tests
  failed exactly as predicted:
  - `fmtPct(-1.05, 1)` → `"-1.0%"` (expected `"-1.1%"`, the symmetric counterpart of
    `fmtPct(1.05,1) → "+1.1%"`)
  - `roundFloats(-1.05, 1)` → `-1` (expected `-1.1`, the symmetric counterpart of
    `roundFloats(1.05, 1) → 1.1`)
- **After the fix**, all 55 tests in both files pass (52 pre-existing + 3 new), including the
  updated "stale fixture" test below.

Every tie-value pair used in the new tests was independently verified (not assumed) to land on a
genuine floating-point `.5` tie after scaling — `console.log((1.05*10).toPrecision(20))` →
`10.500000000000000000`, confirming the multiplication rounds the double's own representation
noise (`1.05` is really stored as `1.0500000000000000444...`) exactly onto the tie boundary rather
than landing just shy of it. A decimal value that merely *looks* like a tie (e.g. the classic
`1.005` at 2dp) is NOT necessarily a real double-precision tie (`1.005` is actually
`1.00499999999999989341...`) and was deliberately excluded from the new fixtures for that reason.

### Blast radius

Both functions are intentionally shared, product-wide primitives, so this fix's correctness
propagates to every caller automatically — no other file needed to change. For completeness,
every CONSUMER CATEGORY touched (verified via repo-wide grep, non-test source only):

- **`fmtPct()` — 32 non-test call sites** across: Night Hawk 0DTE/Swings desk components
  (`SwingAnalyticsPanel.tsx`, `HawkRecordStrip.tsx`, `NighthawkAnalyticsPanel.tsx`,
  `BangerBoard.tsx`), SPX Slayer (`SpxSniperHeader.tsx`, `SpxLiveSpotPrice.tsx`,
  `SpxIosMarketStrip.tsx`), Meridian (desk + 4 panels + 3 core libs), Helix
  (`HelixRegimeRibbon.tsx`), Thermal (`GexHeatmap.tsx`), shared GEX components
  (`GexMatrixShiftBadge.tsx`, `GexShiftLeadersStrip.tsx`), Ask Largo
  (`BieStructureLadder.tsx`, `largo-live-feed.ts`), Swing play-brief narrative modules
  (`play-brief.ts`, `play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`,
  `play-brief-intel.ts`), 0DTE `exit-engine.ts`, track-record formatting
  (`components/track-record/format.ts`, `TrackRecordProductCard.tsx`), and the shared
  `lib/api.ts`/`lib/bie/platform-read-format.ts` client-facing formatters.
- **`roundFloats()` — 158 non-test call sites**, the JSON response-shaping boundary for nearly
  every `src/app/api/**/route.ts` in the product (Vector ~16 routes, SPX ~10 routes, Night Hawk
  0DTE/Legacy ~9 routes, Swing routes, Meridian, Helix, GEX heatmap/matrix-delta, admin analytics/
  health/export routes ~25, public track-record, mobile signals/ticker, platform snapshot) plus
  core data-layer libraries (`zerodte/marks-math.ts`, `zerodte/live-marks.ts`, `swing/record.ts`,
  `swing/closed-plays.ts`, `vector-*` libs, `meridian-*` libs, `largo/*` libs,
  `bie/answer-envelope.ts`, `public-gex-snapshot.ts`, `ws/stocks-spot-stream-hub.ts`).

No call site needed a code change — both functions' signatures and return types are unchanged;
only the rounding direction at an exact negative tie changed (toward-zero → away-from-zero,
matching the positive case).

**Deliberately NOT touched (noted, not fixed — kept in scope per the task):** `fmtOptionUsd()` and
`fmtPriceLevel()` (both also in `fmt-money.ts`) contain the same `Math.round(n*100)/100` pattern
inline (their own header comments document they must match `roundFloats()`'s rounding
byte-for-byte), so they likely carry the identical sign-asymmetry bug for negative dollar amounts/
price levels at an exact tie. In practice both are near-exclusively used for POSITIVE values
(premium prices, spot/wall/flip/pin levels are never negative), so the live blast radius is
believed near-zero, but this was not verified exhaustively. Left out of this fix to keep the PR to
the two functions the bug was confirmed and reported against; worth a follow-up sweep if a signed
dollar use of either function is ever found.

### Fix

Round by **magnitude**, then reapply the original sign: `Math.sign(n) * Math.round(Math.abs(n) *
factor) / factor` instead of `Math.round(n * factor) / factor`. This makes both signs tie the same
direction (away from zero) instead of the same direction in absolute terms (toward +Infinity) —
matching how humans read signed percentages/magnitudes and eliminating the asymmetry entirely.

`n === 0` / `Math.sign(0) === 0` was verified to still produce a plain `0` safely. A negative
value whose MAGNITUDE rounds to exactly 0 at the given precision (not a tie — e.g. `-0.03` at 1dp)
can produce a `-0` via `Math.sign(n) * 0` (IEEE-754 sign-of-product) — this is **pre-existing**
behavior unchanged by this fix (the OLD `Math.round(v*f)/f` already produced `-0` for any
near-zero negative, per the JS spec: `Math.round` of any value in `(-0.5, 0)` returns `-0`), and
was deliberately left as-is rather than normalized, for two reasons: (1) a genuine tie can never
produce a zero-magnitude result (`Math.round(0.5) === 1`, never `0`), so this fix's own change path
never introduces a NEW `-0`; (2) `fmtPct()` immediately stringifies via `.toFixed()`, which already
prints `-0` as `"0.0"` with no stray minus sign and no observable difference from `+0`, and
`roundFloats()`'s result is always serialized via `JSON.stringify` (`NextResponse.json`), where
`JSON.stringify(-0) === "0"` — also no observable artifact. Normalizing it anyway would have
diverged `roundFloats()`'s behavior from its own existing `legacyRoundFloats` byte-identical
regression test (`round-floats.test.ts`) for an unrelated, pre-existing near-zero case, which would
have been unnecessary scope creep on a fix that is otherwise a pure, surgical direction correction.

### Fix rationale

Considered an alternative of only fixing `fmtPct()` (the directly-reported symptom) and leaving
`roundFloats()` alone — rejected, because the task's own repro and this file's module-level
comments both state the two functions are REQUIRED to round byte-identically (several call sites,
e.g. `fmtOptionUsd`/`fmtPriceLevel`'s own headers, exist specifically to stay in sync with
`roundFloats()`'s algorithm), so fixing one without the other would have reintroduced exactly the
kind of two-different-values-for-one-fact defect this codebase has repeatedly found and fixed
(`fmtOptionUsd`/`fmtPriceLevel`'s own module comments document three prior rounds of that same
bug class). Fixing both together keeps the invariant intact.

### Tests

`src/lib/fmt-money.test.ts`: new `it("rounds a negative tie to the SAME magnitude as its positive
mirror image, not a smaller one")` (5 verified-tie pairs + the exact live-repro pin), and the
existing "matches `roundFloats()` byte-for-byte" test's local `roundFloatsStyle` helper updated
from the old biased algorithm to the fixed magnitude-then-sign one (the stale `-1.05` fixture this
task named — it previously only ever asserted self-consistency against an equally-biased local
copy).

`src/lib/round-floats.test.ts`: new `test("rounds a negative tie to the SAME magnitude as its
positive mirror image, not a smaller one")`, same 5 verified-tie pairs plus the explicit
`-1.05`/`1.05` pin. The pre-existing `legacyRoundFloats` byte-identical comparison test (asserting
`roundFloats` with no `keyDp` matches the OLD pre-override implementation) was left unchanged and
still passes — none of its fixture values land on an exact tie, so it correctly continues to prove
the `keyDp` feature itself doesn't change behavior, without being a stale assertion of the now-fixed
bug.

RED→GREEN: confirmed via a source-only revert of `fmt-money.ts`/`round-floats.ts` to their
pre-fix content (test files untouched) — 3 failures pre-fix, 0 failures post-fix, full command:
`PATH=/opt/node20/bin:$PATH npx tsx --experimental-test-module-mocks --test
src/lib/fmt-money.test.ts src/lib/round-floats.test.ts`. `npx tsc --noEmit` clean on Node 20.
