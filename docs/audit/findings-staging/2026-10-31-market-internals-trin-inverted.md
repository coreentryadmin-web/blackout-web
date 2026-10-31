> **kind:** FINDING

## `estimateTrinFromBreadth` inverted the TRIN proxy's bullish/bearish polarity — FIXED

**Status:** FIXED (PR, this branch) — regression test added, RED→GREEN proven via `git stash`.

### Root cause

`src/lib/market-internals.ts`'s `estimateTrinFromBreadth` is the breadth-derived TRIN
*proxy* substituted whenever Polygon doesn't print a real `I:TRIN` tick (documented at the
top of the file: "Breadth-based estimates when Polygon does not return I:TICK / I:TRIN /
I:ADD"). TRIN has a fixed, published polarity that is used consistently everywhere else in
this codebase:

- `src/features/largo/answer/signal-rows.ts` (comment on its own `trin` entry): "INVERTED on
  purpose: TRIN below 1.0 means volume is concentrated in advancing issues" → **low TRIN =
  bullish**.
- `src/features/spx/lib/spx-signals.ts`: `desk.trin < 0.85` scores **+6 bullish** ("broad
  buying"), `desk.trin > 1.15` scores **-6 bearish** ("broad selling").
- `src/features/spx/components/SpxSniperHeader.tsx`: "TRIN — ratio of advancing to declining
  volume; below 1 often reads bullish breadth."

`estimateTrinFromBreadth`'s own two edge cases correctly encode this same direction:
all-advancing (`dec === 0`) returns `0.65` (low/bullish), all-declining (`adv === 0`) returns
`1.45` (high/bearish). But the **general case**, which runs whenever both `adv > 0` and
`dec > 0` (i.e. almost every real reading — all-or-nothing breadth is the rare exception),
computed:

```ts
const ratio = adv / dec;
return Math.round(Math.min(2, Math.max(0.5, ratio)) * 100) / 100;
```

This is the inverse mapping. When breadth is heavily bullish (`adv >> dec`), `ratio` is large
and clamps to the **bearish ceiling** (`2.0`) — directly contradicting the `dec === 0` anchor
one line above it, which assigns the *same* heavily-bullish breadth a **bullish** `0.65`.
Concretely: 9 advancing sectors vs. 1 declining sector (overwhelmingly bullish, one step away
from the `dec===0` edge) produced `trin = 2` (read as maximally bearish by every downstream
consumer's `trin > 1.15` check), while the *more* extreme all-advancing case one step away
produced `trin = 0.65` (bullish) — a hard discontinuity that flips sign exactly where real
breadth data lives.

### Evidence

Added `src/lib/market-internals.test.ts`. Before the fix (proven via `git stash` on
`market-internals.ts` alone, test file kept):

- 9 advancing / 1 declining (bullish breadth) → `trin = 2` (bearish ceiling) — **FAIL**,
  expected `< 1`.
- 1 advancing / 9 declining (bearish breadth) → `trin = 0.5` (bullish floor) — **FAIL**,
  expected `> 1`.
- Monotonicity check (all-advancing < mostly-advancing < mostly-declining < all-declining)
  — **FAIL**: all-advancing (`0.65`) is numerically *less* than mostly-declining (`0.5`) is
  false in the wrong direction once the sign-flip is accounted for; the ordering across all
  four bins was reversed from what every downstream consumer assumes.

After the fix (`ratio = dec / adv`), all three tests pass: bullish breadth reads `< 1`,
bearish breadth reads `> 1`, and the four-bin ordering (all-advancing → mostly-advancing →
mostly-declining → all-declining) is monotonically increasing, consistent with the
`dec===0`/`adv===0` anchors.

### Blast radius

`estimateTrinFromBreadth` is called only through `estimateInternalsFromBreadth` /
`resolveMarketInternals` in the same file — no duplicated copy of the ratio logic exists
elsewhere, so this one fix covers every caller:

- `src/features/spx/lib/spx-desk.ts` (`resolveMarketInternals`, both commit paths) — feeds
  the SPX desk's `trin` field, which `spx-signals.ts` scores (±6 weight) and
  `SpxSniperHeader.tsx` displays with an "est." badge whenever Polygon's real `I:TRIN` print
  is unavailable (off-hours / provider gap) and the breadth proxy stands in. **Out of scope
  for this PR** (`src/features/spx/` is an owned lane) — this fix only touches the shared
  proxy function itself; no owned-lane file was edited.
- `src/lib/nighthawk/cortex/fetch.ts` (`estimateInternalsFromBreadth`) — feeds Night Hawk's
  Cortex breadth read the same way.

Both consumers only ever see the *corrected* number after this fix lands; neither file needed
changing because neither duplicates the ratio math.

### Fix rationale

The minimal, root-cause fix is swapping the ratio's numerator and denominator
(`dec / adv` instead of `adv / dec`) so the general case agrees with the two edge cases
already in the function, which are themselves consistent with every other TRIN consumer in
the codebase. Deliberately left unchanged:
- The edge-case return values (`0.65` / `1.45`) and the clamp bounds (`[0.5, 2]`) — those are
  calibrated magnitudes, not part of the sign-inversion bug, and changing them would be an
  unrelated, unevidenced magnitude tweak.
- `estimateTickFromBreadth` and `estimateAddFromBreadth` — independently checked and already
  correctly signed (positive net advancers → positive TICK/ADD, matching real index
  semantics); only the TRIN function had the inverted ratio.
- No owned-lane file (`src/features/spx/`, `src/lib/nighthawk/` cortex consumers, etc.) was
  touched — the fix is scoped to the one shared, generic proxy function.

### Files changed
- `src/lib/market-internals.ts` — swap `adv / dec` → `dec / adv` in `estimateTrinFromBreadth`,
  with an explanatory code comment.
- `src/lib/market-internals.test.ts` — new regression test file (previously had zero test
  coverage).
