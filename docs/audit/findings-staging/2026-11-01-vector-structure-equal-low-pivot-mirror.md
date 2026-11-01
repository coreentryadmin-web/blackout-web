> **kind:** FINDING

## Vector market-structure `labelPivots` mislabels an equal-price double-bottom pivot low as a bearish "LL" instead of the documented "HL" mirror — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** manual audit of `src/features/vector/lib/vector-market-structure.ts` (CTO roadmap
#2 — fractal swing labels HH/HL/LH/LL and BOS/CHOCH structure breaks, feeding the Vector chart's
structure markers), per round-281's directive to actively hunt for comparison-operator /
mirror-asymmetry bugs at an equality boundary — the same bug shape that produced PR #7221
(direction-less classification counted as directional) and #7222 (decimal-unaware parser).

**Root cause:** `labelPivots` labels each confirmed pivot vs. its same-kind predecessor. The
file's own header comment states the rule explicitly: *"higher → HH, lower → LH (equal counts as
LH — no higher high was made). Pivot LOWS mirror: HL / LL."* — i.e. for lows, lower should give
LL and anything else (higher **or equal**) should give HL, mirroring exactly how an equal high
falls on the LH side (not the HH side).

The high branch implements this correctly:
```ts
if (prevHigh != null) p.label = p.price > prevHigh ? "HH" : "LH";
```
An equal high (`price === prevHigh`) fails the `>` test and falls into the `else` → `"LH"`, i.e.
"no higher high was made." Correct.

The low branch (pre-fix) tested the WRONG direction:
```ts
if (prevLow != null) p.label = p.price > prevLow ? "HL" : "LL";
```
An equal low (`price === prevLow`) also fails the `>` test and falls into the SAME `else` branch
— but for lows that branch is labelled `"LL"`, asserting a **lower** low was made when the price
only matched the prior pivot exactly. A double-bottom at the identical support level (a real,
common market-structure pattern — e.g. two pivot lows pinned to the same round-number level) was
therefore labelled as a fresh bearish continuation (LL) instead of "no lower low was made" (HL),
inverting the mirror the file's own header documents and the standard SMC (Smart Money Concepts)
convention the file's definitions section follows.

**Blast radius:** `src/features/vector/lib/vector-structure-markers.ts` consumes `label` directly
to color each pivot marker on the Vector chart:
```ts
color: p.label === "HH" || p.label === "HL" ? UP_COLOR : p.label === "LH" || p.label === "LL" ? DOWN_COLOR : FIRST_COLOR,
```
So the mislabeled equal-low pivot was not just a wrong two-letter tag in a data structure — it
painted a genuine double-bottom (bullish: support held) in `DOWN_COLOR` (red, bearish) on the
member-facing chart, the exact kind of inverted-bias defect this file's git history already
documents fixing elsewhere (e.g. the 2026-08-05 trend-mutation-leak fix a few lines below in the
same file, and the wall-proximity "reclaimed support" inversion in
`vector-wall-proximity.ts`). `detectStructureEvents` (BOS/CHOCH) is unaffected — it keys off the
pivot's numeric `price`/`index`, not its `label`.

Checked other `labelPivots`/pivot-label consumers for the same root cause:
- `src/features/vector/lib/vector-technicals.ts` — reads pivot `price`/`index` for swing-fib
  math, not `label`. Not affected.
- `src/lib/largo/vector-analytics-core.ts` — surfaces structure events/levels to Largo's tool
  layer; does not read the HH/HL/LH/LL label field. Not affected.

**Fix rationale:** test the LOWER-is-worse direction directly
(`p.price < prevLow ? "LL" : "HL"`), the true mirror of the high branch's
`p.price > prevHigh ? "HH" : "LH"`. Strictly-lower now gives LL (unchanged from before), and
strictly-higher still gives HL (unchanged from before) — the fix changes behavior **only** at the
exact-equality boundary, flipping it from LL to HL. Left the high branch, BOS/CHOCH detection, and
every other part of the file untouched — this is a one-line comparison-direction fix at the
documented mirror boundary, not a broader rewrite.

**Evidence (RED → GREEN):** added a regression test to
`src/features/vector/lib/vector-market-structure.test.ts` using a hand-traced 11-bar path with two
separate, non-overlapping pivot-low windows (k=2) that both bottom at the identical price 100.5 —
confirmed via a live run of the real, imported `detectPivots` that both pivots are genuinely
confirmed (`{index:2,price:100.5}`, `{index:8,price:100.5}`) before asserting on their labels.

RED (pre-fix `vector-market-structure.ts`, new test only, via `git stash` isolating the source
file): `npx tsx --experimental-test-module-mocks --test vector-market-structure.test.ts` → 7 pass,
**1 fail** (new test expected `[8, "HL", 100.5]`, got `[8, "LL", 100.5]`).

GREEN (post-fix): same command → **8/8 pass**.

Also re-ran the full blast-radius test set together (`vector-market-structure.test.ts`,
`vector-structure-markers.test.ts`, `vector-technicals.test.ts`,
`src/lib/largo/vector-analytics-wiring.test.ts`): **39/39 pass**. `npx tsc --noEmit`: clean.
