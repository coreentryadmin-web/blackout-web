> **kind:** FINDING

## Vector contract picks: `magnet-mean` candidate direction was inverted — recommended the losing side of its own reversion thesis — FIXED

| | |
|---|---|
| **Area** | `src/features/vector/lib/vector-play-candidates.ts` — `specsForContext`, the `play.bias === "range"` branch |
| **Status** | FIXED |
| **Severity** | P2 — a member-visible, directionally wrong contract recommendation on the Vector Suggested-Play contract-pick panel |

### Root cause

For a `range`-bias play, `specsForContext` builds three candidate specs: `fade-dip` (long/call at
the put wall — a standing "buy the bounce off support" order), `fade-rip` (short/put at the call
wall — "sell the rejection off resistance"), and an additional `magnet-mean` spec whenever the
range's computed mean-reversion reference (`rangeMeanReference(magnet, maxPain, putWall,
callWall)`) sits within 2.5% of spot:

```ts
const dir = meanRef.price <= spot ? "long" : "short";
specs.push({ direction: dir, targetStrike: meanRef.price, role: "magnet-mean" });
```

Unlike `fade-dip`/`fade-rip` — whose direction is a standing geometric fact independent of spot
(a support level always bounces up = long; a resistance level always bounces down = short) —
`magnet-mean` is explicitly conditioned on `sign(meanRef.price − spot)`, so it can only be read as
a mean-reversion bet: the thesis is that price moves **toward** the magnet/max-pain mean. If the
mean sits ABOVE spot, price must RISE to reach it (bullish, buy calls). If the mean sits BELOW
spot, price must FALL (bearish, buy puts). The comparison above has this backwards: `meanRef.price
<= spot` (mean at/below spot, i.e. price needs to FALL) produced `"long"` (buy calls — a bet that
price RISES, the opposite of what reversion to a below-spot mean requires), and `meanRef.price >
spot` (price needs to RISE) produced `"short"` (buy puts — a bet that price FALLS). Every
`magnet-mean` recommendation was on the losing side of the very reversion thesis its own evidence
line ("Strike at range mean-revert anchor (magnet / max pain)") describes.

`direction` here directly selects the option type downstream (`pickContractNearTarget`: `side =
direction === "long" ? "call" : "put"`), so this is not a cosmetic label — it decides which real
contract (call or put) is surfaced to the member for this role.

### Evidence

New regression test in `vector-play-candidates.test.ts` (`range bias: magnet-mean candidate bets
on price moving TOWARD the mean, not away from it`), two scenarios:

- spot 500, put wall 480, call wall 520, magnet 501 (mean 1pt ABOVE spot, inside the rails) →
  before the fix, the `magnet-mean` pick's `side` was `"put"`; after the fix it is `"call"`
  (correct — price must rise to reach the mean).
- spot 500, put wall 480, call wall 520, magnet 499 (mean 1pt BELOW spot) → before the fix the
  pick's `side` was `"call"`; after the fix it is `"put"` (correct — price must fall).

Confirmed RED→GREEN by stashing only the source-file fix and re-running: 1 failure
(`side` expected `"call"`, got `"put"`) on the pre-fix code, 0 failures after restoring it.

### Blast radius

Single branch, single spec (`magnet-mean`), `play.bias === "range"` only. `fade-dip`/`fade-rip`
(the other two range specs) are unaffected — their direction is a standing geometric fact about
the rail they target, not conditioned on spot vs. a mean, so the bug shape does not apply to them.
No other caller of `rangeMeanReference` is touched (`vector-play-engine.ts`'s own use of it, for
the Suggested Play's headline/target text, is a separate call site with its own, already-correct
logic — unmodified here).

### Fix rationale

Flipped the comparison to `meanRef.price >= spot ? "long" : "short"` so the direction matches the
reversion thesis the role is named for. Left the 2.5%-proximity gate, the `rangeMeanReference`
helper, and every other spec/role untouched — this is a one-line sign fix with an in-code comment
explaining why `magnet-mean`'s direction is conditioned on spot while its sibling rail specs are
not, so a future reader does not "fix" this back the other way by analogy with `fade-dip`/`fade-rip`.

### Verification

`npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-play-candidates.test.ts`:
20/20 pass (was 19/20 before the fix, confirmed via `git stash` on just the source file). Full
`src/features/vector/lib/*.test.ts` sweep: 1352/1352 pass, 0 fail. `tsc --noEmit` clean.
