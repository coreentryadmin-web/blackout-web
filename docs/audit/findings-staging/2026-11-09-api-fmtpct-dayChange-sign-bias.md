## `src/lib/api.ts`'s `fmtPct` had the same sign-bias rounding tie as fmt-money.ts's fmtPct/vector-technicals.ts/debrief.ts — a negative day-change tie could flip to a misleading `+` sign

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity` (`Math.round(-0.5) === -0`,
not `-1`). Any formatter that rounds a RAW signed value with a plain `Math.round(n * scale) /
scale` and then decides the `+`/`-` prefix with a SEPARATE, non-strict (`>= 0`) comparison on that
same raw/rounded value is exposed to this tie at the exact boundary where it matters most — where
the displayed magnitude is zero or near it.

`src/lib/api.ts`'s `fmtPct` (feeds the SPX desk's day-change display —
`SpxSniperHeader.tsx`/`SpxLiveSpotPrice.tsx`/`SpxIosMetricGroups.tsx`/`SpxIosMarketStrip.tsx` —
and is also imported by `HelixRegimeRibbon.tsx` and `GexHeatmap.tsx`) had exactly this shape:

```ts
const rounded = Math.round(n * 100) / 100;
const sign = rounded >= 0 ? "+" : "";
return `${sign}${rounded.toFixed(2)}%`;
```

This is an independent, un-migrated duplicate of the same bug class already fixed at
`fmt-money.ts`'s own `fmtPct`, Night Hawk's `debrief.ts`/`signPct`/`formatExcursionPct`, and
`vector-technicals.ts`'s `round2` — a formatter shape that keeps resurfacing because each one
defines its own local rounding instead of importing an already-fixed shared helper. This
particular file's own header comment even cites "fmt-money.ts's fmtPct" as the reference it was
supposedly already matching — it wasn't; it used `Math.round(n * 100) / 100` (not sign-aware) and
`>= 0` (not the strict `> 0` the reference uses), the two changes that reintroduce the tie bug.

### Evidence
Pre-fix, reproduced live with `fmtPct` imported from the real module (not reimplemented):

```
fmtPct(-0.005)  → "+0.00%"   (expected "-0.01%" — a genuinely NEGATIVE reading displayed with a
                               bullish "+" sign, the wrong direction entirely)
fmtPct(-0.015)  → "-0.01%"   (expected "-0.02%" — magnitude understated by one cent; the mirror
                               +0.015 already rounded away from zero to "+0.02%")
fmtPct(0)       → "+0.00%"   (should be "0.00%" — no sign on an exact-zero reading)
```

`Math.round(-0.005 * 100) / 100` evaluates to `Math.round(-0.5) / 100 = -0 / 100 = -0`, and
`-0 >= 0` is `true` in JavaScript — so the old `sign` check actively flips a real negative
day-change reading to a plus sign, which is worse than the "dropped sign" shape some of this bug
class's earlier instances had: here the member sees the OPPOSITE of what actually happened. The
`-0.015` case shows the same tie rounding toward zero on the negative side while its positive
mirror rounds away from it, understating the magnitude.

RED → GREEN: three new tests added to `src/lib/fmt-premium.test.ts` (which already imports
`fmtPct` from `./api` for its NaN/Infinity-guard and float-boundary coverage) fail pre-fix exactly
as shown above (verified with `git stash` isolating only the source fix), pass post-fix. Full
file: 13/13 pass (10 pre-existing + 3 new). `npx tsc --noEmit` clean.

### Fix
`(Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100` instead of `Math.round(n * 100) / 100` —
rounds the magnitude correctly regardless of sign (ties always round away from zero), and the
`+`/`-` prefix now reads from the ROUNDED output with a strict `rounded > 0` (not `rounded >= 0`),
exactly matching `fmt-money.ts`'s own `fmtPct`. `rounded` can be `-0` or `0` for a magnitude that
disappears at 2dp; `(-0).toFixed(2)` is `"0.00"` with no stray minus, and `rounded > 0` is `false`
for both `-0` and `0`, so the sign branch can't produce a misleading prefix either way. Every
existing non-tie call (`0.16` → `"+0.16%"`, `-4.22` → `"-4.22%"`, the `6.175` float-boundary case
→ `"+6.18%"`) is byte-identical to before.

### Blast radius
One function, one file. Four live UI call sites import this exact `fmtPct` from `@/lib/api`
(confirmed by grep, distinguishing it from the separate, already-correct `fmtPct` exported by
`fmt-money.ts`): `SpxSniperHeader.tsx`, `SpxLiveSpotPrice.tsx`, `SpxIosMetricGroups.tsx` and
`SpxIosMarketStrip.tsx` (all SPX desk day-change displays — UI/formatting, not SPX trading-decision
logic), plus `HelixRegimeRibbon.tsx` and `GexHeatmap.tsx` (Thermal). All six are real, currently
rendering member-facing consumers, not dead code. `pctClass`/`dayChangeTextClass` (the tone-class
siblings next to this formatter in the same file) are unaffected — both already compare the RAW
`n` directly with `>= 0` and have no rounding step to tie on.

### Why this wasn't caught by prior fix passes
Every prior fix in this bug class was found by walking the call sites of a generic
`Math.round(n * scale) / scale`-shaped helper definition individually, rather than trusting a name
grep for an obviously-signed formatter (`signPct`/`fmtShiftPct`). `src/lib/api.ts`'s `fmtPct` reads
as an already-correct, previously-audited formatter at a glance — its own comment explicitly claims
parity with the reference `fmt-money.ts` implementation ("Same bug class already fixed in
fmt-money.ts's fmtPct") — so a pass that trusted that comment, or that only re-checked files named
in prior fix commits, would skip it. It took re-deriving the tie behavior from the actual source
(`Math.round` vs `Math.sign * Math.round(Math.abs(...))`, `>= 0` vs `> 0`) rather than the
comment's claim, to find that this particular "already fixed" duplicate wasn't.

| **Status** | FIXED — this PR. |
