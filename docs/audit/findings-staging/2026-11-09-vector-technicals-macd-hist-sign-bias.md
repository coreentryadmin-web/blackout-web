## Vector desk TECHNICALS panel's MACD histogram `round2` had the same sign-bias rounding tie as fmtPct/debrief.ts/trade-explanation.ts — a negative-tie hist value silently lost its sign

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity`
(`Math.round(-0.5) === -0`, not `-1`). Any formatter that applies `Math.round(n * scale) / scale`
to a RAW signed value, then decides the `+`/`-` prefix with a SEPARATE comparison on that same raw
value, silently rounds a negative reading's MAGNITUDE toward zero at the exact tie while the
same-magnitude positive reading rounds away from it — and at the sharpest tie, drops the sign
entirely because `${-0}` stringifies to the bare digit `"0"`.

`src/features/vector/lib/vector-technicals.ts` — the module that computes the Vector desk's
always-on "TECHNICALS" readout rail (`summarizeTechnicals`/`technicalsCalloutLines`, live-wired
into `VectorChart.tsx`/`VectorTechnicalsPanel.tsx`) — has exactly this shape:

```ts
const round2 = (n: number) => Math.round(n * 100) / 100;
...
const hist = s.macdHist != null ? ` · hist ${s.macdHist >= 0 ? "+" : ""}${round2(s.macdHist)}` : "";
```

`round2` rounds the raw `s.macdHist` to two decimals; the `+`/`""` prefix is decided separately
from the same raw `s.macdHist`. The MACD histogram is a real, continuous, small-magnitude signed
value (the price-unit gap between the MACD line and its signal line), so landing on an exact
`.005`-at-2dp tie is a reachable real input, not a contrived one.

This is the same bug class already fixed at `fmt-money.ts`'s `fmtPct`, Night Hawk's
`debrief.ts`/`trade-excursion-graphic.ts`/`PlayTerminal.tsx`'s `signPct`, and
`trade-explanation.ts`'s `fmtPts`/`fmtR` (#7695) — an independent, un-migrated paste of the same
formatter shape none of those earlier fixes reached, because this module defines its own local
`round2` instead of importing any already-fixed helper.

### Evidence
Pre-fix (reproduced by the new regression tests, run through the real `technicalsCalloutLines`
path, not a reimplementation):

```
macdHist = -0.005  → "MACD bearish — line below signal · hist 0"      (expected "hist -0.01")
macdHist = -0.015  → "MACD bearish — line below signal · hist -0.01"  (expected "hist -0.02")
macdHist = +0.015  → "MACD bullish — line above signal · hist +0.02"  (correct — positive ties
                                                                        already round away from
                                                                        zero under plain Math.round)
```

`-0.005` is the sharpest case: `Math.round(-0.005 * 100) / 100` evaluates to `Math.round(-0.5) /
100 = -0 / 100 = -0`, and the template literal `` `${-0}` `` renders the bare digit `"0"` — a real
negative histogram reading displays with **no sign at all**, visually identical to a genuinely flat
MACD. `-0.015` understates the magnitude by one cent (`-0.01` instead of `-0.02`) rather than
dropping the sign, the same one-off-at-the-boundary shape as every prior instance of this bug.

RED → GREEN: two new tests in `vector-technicals.test.ts` fail pre-fix exactly as shown above
(verified with `git stash` isolating only the source fix), pass post-fix. Full module suite:
14/14 pass (12 pre-existing + 2 new). `npx tsc --noEmit` clean.

### Fix
`(Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100` instead of `Math.round(n * 100) / 100` —
rounds the magnitude correctly regardless of sign (ties always round away from zero), and leaves
every other, already-tie-free call site (`vwap`, `ema9`/`ema21`/`ema50`, `goldenPocket.low/high`,
`structure.level` — all non-negative prices in practice) byte-identical to before, since
`Math.sign` of a non-negative number is `1` (or `0` at exactly zero, which multiplies through
harmlessly). The MACD histogram's own sign prefix now reads from the ROUNDED output
(`roundedHist > 0`), not the raw input — the exact convention `fmtPct` and the Night Hawk
`signPct`/`formatExcursionPct` fixes already use, so a magnitude that rounds down to exactly zero
never prints a misleading `"+0"`.

Deliberately left every other field in the module untouched — `summarizeTechnicals`'s own
indicator math (`vwapSeries`/`emaSeries`/`rsiSeries`/`macdSeries`), `classifyEmaStack`,
`classifyRsiZone`, and the RSI/EMA/VWAP/structure/golden-pocket callout lines are all correct
already (non-negative inputs, or RSI's own `Math.round(s.rsi)` which is unsigned by construction)
— this PR is scoped to the one rounding-tie formatter bug.

### Blast radius
One file, one shared local helper (`round2`) and its one signed call site (`macdHist` inside the
MACD callout line). `round2` is also used for `vwap`/`ema9`/`ema21`/`ema50`/`goldenPocket.low`/
`goldenPocket.high`/`structure.level`, all non-negative in practice — confirmed byte-identical
output for those (sign-aware rounding of a non-negative input is the same as plain rounding).
`technicalsCalloutLines`/`summarizeTechnicals` are live-wired into `VectorChart.tsx` and
`VectorTechnicalsPanel.tsx` (grep-confirmed), so this is a real, currently-rendering member-facing
line on the Vector desk's always-on TECHNICALS rail, not dead code.

### Why this wasn't caught by prior fix passes
Every prior fix in this bug class followed a grep for the bare
`Math.round(\w+ \* 10+) / 10+` shape, but `vector-technicals.ts`'s `round2` is a short arrow
function (`const round2 = (n: number) => Math.round(n * 100) / 100;`) whose single signed call
site is three lines away from its own definition and nested inside a template literal alongside
an unrelated `rel` variable — easy to skip when scanning call sites for an obviously-signed
formatter name (`signPct`/`fmtPct`/`fmtShiftPct`), since `round2` reads as a generic price
rounder at its three other (unsigned) call sites. It took checking every `Math.round(n * scale) /
scale` definition's call sites individually, including price-rounding helpers that look signed-
safe at a glance, to find the one place (`macdHist`) where the input can actually be negative.

| **Status** | FIXED — this PR. |
