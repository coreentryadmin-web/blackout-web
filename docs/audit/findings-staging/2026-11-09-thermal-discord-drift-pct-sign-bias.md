## Thermal's Discord GEX card per-strike drift column had the same sign-bias rounding tie as fmtPct/debrief.ts/vector-technicals.ts — a ~0.5%+ melt could render as "0%"

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity` (`Math.round(-0.5) === -0`,
not `-1`). Any formatter that interpolates that rounded value straight into a template literal,
with the `+`/`-` prefix decided separately from a non-strict (`>= 0`) comparison on the RAW value,
is exposed at exactly the boundary where it matters most: `` `${-0}` `` stringifies to the bare
digit `"0"`, so the sign disappears entirely rather than the magnitude merely rounding the wrong
way.

`src/lib/thermal-discord-card.ts`'s `buildThermalDiscordCardSvg` — the function that renders the
Thermal desk's live GEX heatmap Discord card (posted by the `thermal-discord` cron,
`src/app/api/cron/thermal-discord/route.ts`) — had exactly this shape in its per-strike "drift"
column (how much a strike's gamma concentration built or melted vs the prior snapshot):

```ts
const driftColor = driftPct >= 0 ? "#a3e635" : "#ff2d55";
const driftText = `${driftPct >= 0 ? "+" : ""}${Math.round(driftPct)}%`;
```

`driftPct` comes from `discordDriftPct(currentValue, delta) = (delta / Math.abs(baseline)) * 100`
— a real, continuous signed percentage (no discrete step that would make an exact `.5` unreachable)
— so landing on a `-0.5`-at-whole-percent tie is a genuine live possibility, not a contrived edge
case.

This is the same bug class already fixed at `fmt-money.ts`'s `fmtPct`, Night Hawk's `debrief.ts`,
`src/lib/api.ts`'s `fmtPct`, and `vector-technicals.ts`'s `round2` — an independent, un-migrated
duplicate of the shape, in a file that already contains its OWN correctly-written sibling,
`fmtChangePct` (two dozen lines above the bug, used for the card's header change%), which is
sign-safe only because it delegates its own rounding to `toFixed` instead of a bare `Math.round`.
The per-strike drift column never reused `fmtChangePct` — it pasted a second, differently-shaped
(and broken) formatter instead.

### Evidence
Pre-fix, reproduced with the exact literal expression from the source (not a reimplementation):

```
driftPct = -0.5
  driftColor = "#ff2d55" (red — correct, unaffected: this branch reads the raw value)
  driftText  = `${-0.5 >= 0 ? "+" : ""}${Math.round(-0.5)}%` = "" + "-0" + "%"
             -> template-literal-stringifies to "0%"   (WRONG — expected "-1%")
```

`Math.round(-0.5 * 1) === -0` (no separate scale factor here; `discordDriftPct` already returns a
whole-ish percent), and `` `${-0}` `` is `"0"` per the JS `ToString` spec — so a strike whose gamma
concentration genuinely melted by ~0.5% or more (anything in `[-1.5, -0.5]` that ties exactly at
the half-point) renders RED-colored text reading `"0%"`, i.e. the color says "this strike is
melting" while the adjacent number says "no change at all" — a directly contradictory, misleading
pair on a live-posted trading-desk card. The mirror `+0.5` case already rounded away from zero
correctly under plain `Math.round` (`Math.round(0.5) === 1`), which is exactly the asymmetry this
bug class always produces.

RED → GREEN: a new test added to `src/lib/thermal-discord-card.test.ts` exercises the new
`fmtDriftPct` helper directly (not a reimplementation) and fails before the fix exactly as shown
above — confirmed by temporarily isolating the source fix (`git stash` on `thermal-discord-card.ts`
alone, which removes `fmtDriftPct` and makes the import unresolved — the sharpest possible RED,
since the test calls the function by name) and restoring it. Post-fix: full file suite 16/16 pass
(15 pre-existing + 1 new, multi-assertion). `npx tsc --noEmit` clean.

### Fix
Extracted the duplicate inline logic into a new exported `fmtDriftPct(n)` helper that rounds the
**magnitude** (`Math.round(Math.abs(n))`), reapplies the sign via `Math.sign(n)` (ties always round
away from zero regardless of sign), and decides the `+`/`-` prefix from the ROUNDED result with a
strict `rounded > 0` — exactly the same fix shape already applied at `fmt-money.ts`'s `fmtPct` and
`vector-technicals.ts`'s `round2`. `rounded` can be `-0` or `0` for a magnitude that disappears at
whole-percent precision (e.g. `-0.3` → `0`); `rounded > 0` is `false` for both, so the sign branch
can never print a misleading `"+"`/`"-"` either way, and the interpolated `${rounded}` for a
genuine `0` reads `"0%"` with no stray minus. The `color` branch is left reading the RAW `n` (as
before) — it was never part of the bug, since boolean color selection has no rounding step to tie
on. Every existing non-tie call is byte-identical to before (`-12.4` → `"-12%"`, `7.8` → `"+8%"`).

An alternative would have been to make the drift column reuse the file's own `fmtChangePct` (which
is already tie-safe) — not done, because `fmtChangePct` is hardcoded to 2 decimal places for the
card's header change% and the per-strike drift column has always displayed whole percents; forcing
2dp onto a dense 8-strike-tall column would be a visible formatting regression, not a fix. A
parallel, differently-precisioned helper that shares the same tie-safety convention is the smaller,
correct change.

### Blast radius
One function (`buildThermalDiscordCardSvg`), one call site, one new exported helper
(`fmtDriftPct`). The only consumer of this exact code path is the live `thermal-discord` cron
(confirmed by grep: `buildThermalDiscordCardSvg` is called from
`src/app/api/cron/thermal-discord/route.ts` and nowhere else in `src/app`), so this is a real,
currently-posting production surface, not dead code. `fmtChangePct` (the header change% formatter
immediately above the fix) and `discordDriftPct` (the pure percent derivation feeding this column)
are both unaffected — neither had a rounding-tie exposure of its own.

### Why this wasn't caught by prior fix passes
Every prior instance in this bug class was found by walking the call sites of a generically-named
`round2`/`fmtPct`-shaped helper. This file's bug has neither name: the broken logic was inlined
directly at its one call site inside a large (~280-line) SVG-building function, with no helper
function wrapping it at all, and the file's nearby, genuinely-safe `fmtChangePct` reads at a
glance like the file's "one formatter" — there was nothing to grep for that would surface a second,
un-named, inline duplicate a few hundred lines further down in the same function.

| **Status** | FIXED — this PR. |
