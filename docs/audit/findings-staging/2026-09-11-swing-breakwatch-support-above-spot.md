> **kind:** FINDING

## Swing "Break watch" cited a level ABOVE spot as a LONG's support — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo (`tradeManagerNarrativeSection`, `resolveBreakInvalidation`) |
| **Severity** | P2 — misleading trade-management guidance on a live position |
| **Status** | FIXED (this PR) |

### Root cause

`breakTrigger` (`src/lib/swing/play-brief-narrative.ts`) picks a LONG play's "support" level by
searching `focal` (the ranked list of dark-pool prints, GEX walls, gamma flip, etc.) for the
**nearest** `put_wall` or `dark_pool` entry:

```js
const support = focal.find((l) => l.kind === "put_wall" || l.kind === "dark_pool")?.price;
```

`focal` is sorted by **unsigned** distance from spot (`Math.abs(a.distancePct) - Math.abs(b.distancePct)`
in `collectFocalLevels`) — "nearest" does not mean "below spot". A dark-pool level can print on
EITHER side of spot (confirmed by `narrateDarkPool`'s own `level.price < spot ? "support" :
"resistance"` branch three lines away in the same file — the file already knows dark-pool prints
aren't one-sided, `breakTrigger` just didn't apply that knowledge). So whenever the nearest
matching level happened to sit above spot, `breakTrigger` still used it as the LONG's "support",
producing:

> **Watch 101.00** — major dark pool print ... treat as **resistance**. Cap upside until reclaimed.
> ...
> **Break watch** — lose **101.00** on a closing basis → structural support failed; exit or cut size.

Two bullets in the same brief calling the identical level "resistance" and then "the support you'd
lose" — a direct self-contradiction, and semantically backwards: a LONG can't "lose" a level it
hasn't even reached yet. The LONG flip fallback (`support ?? flip`) had the identical gap — a
gamma flip currently above spot was usable as the "lose X" stop too.

### Evidence

RED (`git stash push -- src/lib/swing/play-brief-narrative.ts`, fix removed, test kept), LONG play
at spot 100 with a dark-pool print at 101 (nearest, above spot) and the real put wall at 90
(further, below spot):

```
'• **Watch 101.00** — major **dark pool** print ... treat as **resistance**. Cap upside until reclaimed.\n' +
'• **Put wall 90.00** (-10.0% from spot) — dealer support / put wall. ...\n' +
'• **Break watch** — lose **101.00** on a closing basis → structural support failed; exit or cut size.'
```

GREEN after the fix: `Break watch` correctly cites **90.00** (the real, below-spot put wall), never
101.00 or the gamma flip (105, also above spot in the test). Full suite:
`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts` —
55/55 pass. `npx tsc --noEmit` clean.

### Blast radius

`resolveBreakInvalidation` (same file, same `breakTrigger` call) feeds `play-brief.ts`'s
`envelope.invalidation` field — the UI's labeled "Invalidation" callout on the brief's headline —
so this fix corrects that field too, not just the "Trade manager read" narrative bullet.

The SHORT side (`resist = focal.find(l => l.kind === "call_wall")`) had the same structural gap in
theory (no guarantee a call wall sits above spot) even though call walls are far less likely to
land on the wrong side in practice; fixed identically (`&& l.distancePct > 0`) for symmetry and
because the Largo product contract's precision principle applies regardless of how rare the
wrong-side case is in today's data.

### Fix rationale

`focal`'s `distancePct` is already signed (`(price - spot) / spot * 100`), so the fix needs no new
spot plumbing — just require the support candidate's `distancePct < 0` (below spot) and the
resistance candidate's `distancePct > 0` (above spot), and require the LONG flip fallback to also
be below spot before using it. When no level qualifies, `breakTrigger` now returns `null` and the
existing fallback in `tradeManagerNarrativeSection` (the play's own premium stop) takes over —
never fabricates a level.

No regression test previously existed for `breakTrigger`/`resolveBreakInvalidation` at all (grep
confirmed); added one alongside the fix.
