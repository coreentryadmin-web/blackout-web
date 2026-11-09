## Meridian SPX earnings card's just-fixed `topGexWalls` could still invent a call wall on a negative-gamma day — the new pick never checked `net_gex`'s SIGN, only its magnitude among geometrically-"resistance" rows

> **kind:** `FINDING`

### Summary
PR #7684 (merged earlier this round) fixed `meridian-cross-product-for-earnings-core.ts`'s local
`topGexWalls` so it picks the call/put wall by `net_gex` DOMINANCE instead of by array position —
a real fix for a real bug. But the fix's own comment claims parity it does not actually have:

> "call wall = the resistance-kind strike with the largest **POSITIVE** net_gex; put wall = the
> support-kind strike with the largest-magnitude **NEGATIVE** net_gex"

The code that shipped never enforced the word "POSITIVE"/"NEGATIVE" — it only compared `net_gex`
magnitude *among rows already classified `kind === "resistance"` (or `"support"`)*:

```ts
if (row.kind === "resistance" && (call == null || netGex > call.netGex)) {
  call = { strike, netGex };
}
if (row.kind === "support" && (put == null || netGex < put.netGex)) {
  put = { strike, netGex };
}
```

`kind` on a `GexWall` (`gamma-desk.ts`) is purely GEOMETRIC — `strike > spot ? "resistance" :
"support"` — **not** a `net_gex` sign check. That same file's own secondary proximity-fill pass
adds a "resistance"/"support" row for *every* strike above/below spot, regardless of that strike's
own `net_gex` sign ("walk OUT from spot on each side and take the nearest real strikes"). So on a
day where the whole visible chain is net-gamma negative — the exact scenario `gamma-desk.ts`'s own
header names explicitly ("on a negative-gamma day ... all puts") — every "resistance"-kind row in
the ladder can carry a *negative* `net_gex`, and the new pick logic would still report the
LEAST-negative one as the "call wall": a strike that is actually dealer-SHORT gamma there, not a
real resistance/call wall at all.

`gamma-desk.ts`'s own documented contract is explicit this must never happen ("**GROUNDED**: every
wall is a REAL strike from the chain. If the chain genuinely has no positive-net_gex strike
anywhere, **NO call wall is invented** — the ladder is honestly put-only"), and the sibling
wall-picker this very fix's comment cites as the pattern to match
(`meridian-event-expiry-core.ts`'s `scopeStructureToExpiry`) enforces exactly this with its own
explicit `v > 0` / `v < 0` guards:

```ts
if (v > 0 && (!constrained || strike > spot!) && (best == null || v > best.v)) { best = ... }
if (v < 0 && (!constrained || strike < spot!) && (worst == null || v < worst.v)) { worst = ... }
```

The function this PR fixes was missing exactly that sign floor — the one piece of the pattern it
claims to mirror that actually prevents inventing a wall.

This is precisely the trap this round's handoff instruction named: a comment claiming parity with
an already-fixed/already-correct reference, verified against the actual code rather than trusted —
in this case the comment was written in the SAME PR as the code, about the SAME function, and
still didn't match.

### Evidence
RED (pre-fix, reproduced with the shipped #7684 logic via `git stash` isolating only the source
fix in this PR — `shapeMeridianSpxDeskRead` through the real, unmodified call path, not a
reimplementation):

```
gex_walls = [
  { strike: 6550, net_gex: -0.4, kind: "resistance" },  // above spot, but net-gamma NEGATIVE
  { strike: 6500, net_gex: -3,   kind: "resistance" },  // above spot, net-gamma NEGATIVE
  { strike: 6400, net_gex: -8,   kind: "support"    },
  { strike: 6350, net_gex: -1,   kind: "support"    },
]
=> call_wall: 6550   (WRONG — no strike anywhere in this chain has positive net_gex)
=> put_wall:  6400   (correct)
```

GREEN (post-fix): `call_wall: null`, `put_wall: 6400` — honestly reports no call wall exists,
matching `gamma-desk.ts`'s own "no call wall invented" contract.

New regression test: `shapeMeridianSpxDeskRead: NO call wall is invented on a deep negative-gamma
day where every resistance-kind row is net-gamma NEGATIVE`
(`meridian-cross-product-for-earnings-core.test.ts`). Verified RED pre-fix / GREEN post-fix via
`git stash` on the source file alone. Full file suite: 6/6 pass. Full `src/lib/meridian/*.test.ts`:
540/540 pass. `npx tsc --noEmit` clean.

### Fix
Add `netGex > 0` to the call-side condition and `netGex < 0` to the put-side condition, so a row
is only eligible to become the reported wall when its `net_gex` sign actually matches what "call
wall" / "put wall" means (dealer long/short gamma), not merely when it happens to be the strongest
among rows that are geometrically on the right side of spot. A side with no sign-correct row
anywhere in the ladder now returns `null` for that side — already a handled, rendered state
downstream (`MeridianEarningsPositioningPanel.tsx`/`MeridianEarningsReportPanel.tsx`/
`MeridianEarningsIntelPanel.tsx` all null-check `call_wall`/`put_wall` before rendering the "Walls"
line), so no new UI branch was needed.

Deliberately left unchanged: the dominance comparison itself (`netGex > call.netGex` /
`netGex < put.netGex`), the function's handling of malformed rows (`strike`/`net_gex` non-finite),
and every other call site in the file — this is a one-line-per-side guard added to an already
correct comparison, not a rewrite.

### Blast radius
One function (`topGexWalls` in `meridian-cross-product-for-earnings-core.ts`), one call site
(`shapeMeridianSpxDeskRead`), feeding the Meridian SPX earnings card's "Walls {put} – {call}" line
across the three panels named above. Checked the other real consumers of `gamma-desk.ts`'s shared
`topGexWalls` ladder for the same "pick by kind, not by sign" gap — `nighthawk/lib/positioning.ts`
derives its wall label from `net_gex` SIGN explicitly (`isPut = w.net_gex < 0`), not from `kind`,
so it does not have this defect; `spx-desk.ts`'s call sites return the ladder itself without a
local re-derivation, so this defect was local to the one function this PR touches.

### Why this wasn't caught by the fix that introduced it
PR #7684 was itself a bug fix landing the same round it was found, reviewed and tested against the
single-wall-per-side and multi-wall-per-side-but-same-sign cases (both real, both fixed correctly).
Neither its new test nor the pre-existing one constructs a chain where a geometrically-resistance
row is also net-gamma negative — the scenario only shows up on a genuinely one-sided (deep
negative-gamma) day, which is a real but less common market regime than the "normal" two-sided
ladder every existing fixture modeled. The comment asserting "largest POSITIVE net_gex" was never
checked against the code it sits directly above in the same diff.

| **Status** | FIXED — this PR. |
