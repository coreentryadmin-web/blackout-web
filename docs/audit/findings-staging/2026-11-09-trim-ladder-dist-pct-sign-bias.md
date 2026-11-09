## PlayTerminal's TrimScaleLadder distance-to-target/stop `pct` leg had the same sign-bias rounding tie as this file's own `signPct` and the day's wider fix wave — an independent, un-migrated inline closure

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity` (`Math.round(-12.5) === -12`,
not `-13`), so a plain `Math.round(pct)` applied to a SIGNED percentage under-reports a loss's
magnitude exactly at the tie, while the identical-magnitude gain (`Math.round(12.5) === 13`)
rounds correctly away from zero. `PlayTerminal.tsx`'s `signPct` helper (used for the Peak/Trough
chips) already carries this exact fix and its own doc comment names four prior independent fixes
of this bug class elsewhere in the repo — but a second, separate inline closure in the SAME file,
`TrimScaleLadder`'s `distTo`, pasted the un-fixed shape and was missed by every earlier pass
because it isn't a named/exported `*Pct`/`signPct`-style formatter that a formatter-shaped grep
would surface; it was an anonymous local closure building a combined "$ / % away" string for the
live trim-scale runner's target/stop rails.

```ts
const distTo = (level: number | null): string => {
  if (level == null || mark == null) return "";
  const dollars = level - mark;
  const pct = mark > 0 ? (level / mark - 1) * 100 : null;
  return ` · ${dollars >= 0 ? "+" : ""}${dollars.toFixed(2)}${pct != null ? ` / ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` : ""} away`;
};
```

This renders on every WATCH/OPEN `trim_scale`-policy Night Hawk 0DTE play (`isTrimScale && !premium
&& !isCandidate`, `TrimScaleLadder`'s runner row) — the live "tgt / stop" distance-to-level chip
members see while managing a position, not a dead code path.

### Evidence
Pre-fix (reproduced through the real exported function, not a reimplementation — see RED/GREEN
below). Test fixtures deliberately use `mark=8` (a power of 2) so `level/mark` divides EXACTLY in
IEEE-754 binary floating point and lands on a true `.5` tie — a decimal-looking tie such as
mark=100/level=102.5 is actually `~2.499999999999991` once divided, which would mask this exact
bug (both the buggy and fixed formula round that to the same integer):

```
trimLadderDistanceLabel(7, 8)   // dollars=-1.00, pct=-12.5% → " · -1.00 / -12% away"  (pre-fix, WRONG)
trimLadderDistanceLabel(9, 8)   // dollars=+1.00, pct=+12.5% → " · +1.00 / +13% away"  (correct both ways)
trimLadderDistanceLabel(5, 8)   // dollars=-3.00, pct=-37.5% → " · -3.00 / -37% away"  (pre-fix, WRONG)
trimLadderDistanceLabel(11, 8)  // dollars=+3.00, pct=+37.5% → " · +3.00 / +38% away"  (correct both ways)
```

`Math.round(-12.5) === -12` and `Math.round(-37.5) === -37` (ties toward `+Infinity`), so a stop
sitting exactly 12.5%/37.5% below the live mark under-reports its distance by a full percentage
point relative to how an equidistant target above the mark reports — the loss-side chip reads
closer than it actually is.

RED → GREEN: extracted the closure to a pure, exported `trimLadderDistanceLabel(level, mark)` in
`PlayTerminal.tsx` (was an inline closure over `mark`, now unit-testable directly, matching the
`signPct` precedent in the same file) and added
`src/features/nighthawk/command-deck/play-terminal-trim-ladder-dist.test.ts` (4 tests). Confirmed
RED by temporarily restoring the bare-`Math.round` formula inside the new function (git-stash
style isolation) — 2/4 new tests failed with exactly the `-12%`/`-37%` asymmetry shown above;
restoring the fix made all 4 pass. Full relevant suite after fix:
`play-terminal-signpct.test.ts` + `play-terminal-trim-ladder-dist.test.ts` +
`PlayTerminal.ssr.test.ts` + `play-terminal-etclock.test.ts` → 44/44 pass. `npx tsc --noEmit` clean.

### Fix
`Math.sign(pct) * Math.round(Math.abs(pct))` in place of `Math.round(pct)` — rounds the magnitude
correctly regardless of sign (a tie always rounds away from zero), same convention already shipped
today across `fmt-money.ts`, `round-floats.ts`, `shift-math.ts`, `thermal-discord-extras.ts`, and
this very file's `signPct`. The sign prefix changed from `pct >= 0 ? "+" : ""` to
`roundedPct > 0 ? "+" : ""` (checked on the ROUNDED value, matching `signPct`'s own `rounded > 0`
check) so an exact-zero or round-to-zero result renders a bare `"0%"` rather than risking a
stray `"+0%"`/`"-0%"` from `-0`.

Deliberately left untouched: the `dollars` leg (`dollars.toFixed(2)`, not `Math.round`, which does
not share this tie-rounding shape); every other `Math.round` call in `PlayTerminal.tsx`
(`Math.round(t.trigger_pct)` at the ladder-rung label — confirmed non-negative, trigger
percentages are always positive thresholds by construction) is unaffected.

### Blast radius
One file, one previously-un-migrated inline closure. `distTo` had exactly one call site
(`TrimScaleLadder`'s runner target/stop rows); no other component reimplements this specific
"$ delta + % delta, both signed, combined into one 'away' string" shape — checked by grep for
`Math.round` near `away`/`dist` across `src/features/nighthawk/**` outside this one site.

### Why this wasn't caught by prior fix passes today
Every earlier pass in this bug class found its instance by grepping for a named/exported
formatter (`fmtPct`, `signPct`, `round2`) whose name signals "this prints a signed number". This
was an anonymous inline arrow function (`const distTo = (level) => ...`) assigned to a local
`const` inside a component body, never exported, and its string literal was interleaved with a
second, unrelated (and correctly-formatted) `dollars.toFixed(2)` leg — a formatter-name grep over
exported symbols does not surface it, and a human skim reads "two numbers glued into one template
string" rather than "a signed-percentage formatter". It took reading `PlayTerminal.tsx` end to
end, past its own already-fixed `signPct`, to notice the second, differently-shaped paste of the
same bug lower in the file.

| **Status** | FIXED — this PR. |
