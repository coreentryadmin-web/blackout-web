## `trade-explanation.ts`'s own local `fmtPts`/`fmtR` had the same sign-bias rounding tie as `fmtPct`/`shift-math` — a negative factor at an exact rounding tie could render as a bare "0", indistinguishable from an actual zero-value factor

> **kind:** `FINDING`

### Summary
`Math.round()` always rounds a `.5` tie toward `+Infinity` (`Math.round(-0.5) === -0` but
`Math.round(0.5) === 1`). Any formatter that applies a bare `Math.round(n * scale) / scale` to a
value that can be negative, while deciding the `+`/`-` sign prefix with a separate `n >= 0`
comparison on the RAW input, silently rounds a negative reading's magnitude toward zero at the
tie boundary while the identical-magnitude positive reading rounds away from zero.

`src/lib/explain/trade-explanation.ts` — the composed, canonical "why did this trade exist"
explanation module (point-weighted factors + EV, rendered into `headline`/`lines` for the
Night Hawk command-deck's trade-explanation surface via `buildTradeExplanation`, consumed by
`src/features/nighthawk/command-deck/adapters.ts`) — defined two local formatters with exactly
this shape:

```ts
const fmtPts = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
const fmtR = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 100) / 100}R`;
```

`fmtPts` formats every point-weighted factor's contribution in both the one-line `headline`
(`"COMMIT — Flow Quality +18, Sweep Persistence +12"`) and the multi-line `lines` render;
`fmtR` formats the calibrated expected-value-in-R line (`"Expected Value +0.62R"`). Both take a
raw signed `number` directly from caller-supplied `ExplanationFactor.points` / `TradeExplanationInput.evR`
— values the module's own header says come from real scoring components (flow-quality, horizon
scorers, the Allocation Engine), so a negative, non-integer factor or EV reaching an exact `.05`/
`.005` tie is a real, reachable input shape, not a contrived one.

This is the same bug class already fixed at `fmt-money.ts`'s `fmtPct`, `round-floats.ts`,
`thermal/lib/gex-heatmap/shift-math.ts`'s `fmtShiftPercentForStrike`, and nighthawk's own
`format.ts` / `trade-excursion-graphic.ts` / `debrief.ts` — an independent, un-migrated paste of
the same formatter shape that none of those earlier fixes touched, because `trade-explanation.ts`
defines its own local `fmtPts`/`fmtR` rather than importing any of the already-fixed helpers.

### Evidence
RED repro (pre-fix), calling the module-private formatters' logic directly and via the real
`buildTradeExplanation` entry point:
```
fmtPts(0.25)   -> "+0.3"   fmtPts(-0.25)  -> "-0.2"   (should be "-0.3", same magnitude)
fmtR(0.005)    -> "+0.01R" fmtR(-0.005)   -> "0R"      (should be "-0.01R")
fmtPts(-0.05)  -> "0"                                   (should be "-0.1")
```
The `-0.05` case is sharper than mere understatement: `Math.round(-0.05 * 10) / 10` evaluates to
`-0`, and `` `${-0}` `` stringifies to the bare digit `"0"` — so a real negative factor renders
with no sign at all, visually identical to an actual zero-contribution factor in the rendered
`headline`/`lines` a trader reads to understand why a trade was taken.

Confirmed in a Node REPL and via two new regression tests in
`src/lib/explain/trade-explanation.test.ts`, both exercised through the real
`buildTradeExplanation` → `headline` path (not a reimplementation):
- `fmtPts` tie test: `+0.25` factor renders `"A +0.3"`, `-0.25` renders `"A -0.2"` pre-fix (FAILS
  — expected `"A -0.3"`), `"A -0.3"` post-fix (PASSES); `-0.05` renders the bare `"B"` with no
  signed value pre-fix (FAILS — expected `"B -0.1"`), `"B -0.1"` post-fix (PASSES).
- `fmtR` tie test: `evR=0.005` renders `"EV +0.01R"` both before and after (proving the fix only
  changes the negative case); `evR=-0.005` renders `"EV 0R"` pre-fix (FAILS — expected
  `"EV -0.01R"`), `"EV -0.01R"` post-fix (PASSES).

Post-fix: 10/10 tests in `trade-explanation.test.ts` pass (8 pre-existing tests unaffected,
2 new sign-bias tests). `npx tsc --noEmit` clean.

### Fix
`Math.sign(n) * Math.round(Math.abs(n) * scale) / scale` instead of
`Math.round(n * scale) / scale` on the raw signed value — rounds the magnitude correctly
regardless of sign (ties always round away from zero), leaves already-tie-free values (every
existing test fixture: `18`, `12`, `9`, `-14`, `10`, `0.62`) byte-identical to before, and matches
the exact fix pattern already applied at every prior instance of this bug class. The sign-prefix
comparison changed from `n >= 0` (on the raw input) to `rounded > 0` (on the rounded output,
`> 0` not `>= 0`) so an exact zero or a magnitude that rounds down to zero never prints a
misleading `"+0"` — the same convention `fmtPct`, `fmtShiftPercentForStrike`, and the already-fixed
Night Hawk `signPct`/`formatReturnPct`/`formatExcursionPct` helpers use. Extracted the shared
`roundTiesAwayFromZero(n, scale)` helper so `fmtPts`/`fmtR` can't drift apart again within this
one file.

### Blast radius
One file, two local helpers (`fmtPts`, `fmtR`), both used only inside `buildTradeExplanation`
(grep-confirmed — no other file imports or redefines them). `buildTradeExplanation` itself is
currently consumed by its own test file only; `factorsFromFlowQuality` (a different, unaffected
export from the same module) is the one piece `src/features/nighthawk/command-deck/adapters.ts`
currently imports. This means the fix has no live production render to validate against yet —
the module is shipped, fully tested, and designed as the eventual canonical trade-explanation
surface per its own header, but `buildTradeExplanation`'s headline/lines output is not yet wired
into a live UI or API response. Fixing it now, with the same evidence bar as every other finding,
means whichever surface wires it in next inherits correct tie-rounding rather than a fourth
independent place this bug class has to be re-discovered.

### Why this wasn't caught by the prior fix passes
Every prior fix in this bug class targeted either a shared canonical helper (`fmt-money.ts`'s
`fmtPct`, `round-floats.ts`) or a UI/response-envelope formatter already wired into a live render
path, so each fix's own "where else does this bug live" grep tended to follow live call sites
outward from an already-known defect. `trade-explanation.ts` is a pure, fully-unit-tested module
with no live caller of its signed-value formatters yet, so it never surfaced in a live-repro-first
sweep — it took the explicit instruction (this round's lead) to grep the bare
`Math.round(\w+ \* 10+) / 10+` SHAPE across the whole non-excluded `src/` tree, independent of
whether a call site is currently wired live, to find it.

| **Status** | FIXED — this PR. |
