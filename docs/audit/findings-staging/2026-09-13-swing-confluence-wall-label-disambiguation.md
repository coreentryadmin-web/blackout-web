> **kind:** FINDING

## Ask Largo swing play-brief's "confluence" level could cite a different call/put wall than the primary displayed one, under the identical name — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`play-brief.ts`'s primary "call wall"/"put wall" level is `vec.gexWalls.callWalls[0]`/`putWalls[0]`
— explicitly the TOP-ranked wall. But the confluence engine feeding `vec.confluenceZones`
(`vector-full-state.ts`) loops over **every** entry in `gexWalls.callWalls`/`putWalls`, not just
`[0]`:

```ts
for (const w of gexWalls?.callWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "call-wall" });
for (const w of gexWalls?.putWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "put-wall" });
```

So whenever a LOWER-ranked wall candidate happens to cluster with max-pain/gamma-flip/golden-pocket
(`vector-confluence.ts`'s tight 0.15%-of-spot tolerance), the resulting zone is labeled with the
same `call-wall`/`put-wall` kind name as the primary, higher-ranked wall shown elsewhere in the
same brief — but can carry a materially different price. Both numbers are honestly sourced and
individually correct; nothing told the reader they were not the same strike.

### Live repro (confirmed a 3-instance pattern before shipping, raised on #4076)

| Ticker | Bucket | Primary wall | Confluence wall | Side |
|---|---|---|---|---|
| NRG (2026-09-12) | OPEN | call wall 145 | confluence 125 | call |
| MU (2026-09-13) | WATCH | call wall 1000 | confluence 1010.25 | call |
| SKHY (2026-09-13) | WATCH | put wall 155 | confluence 165 | put |

NRG's brief read "call wall: 145" in Key Levels, then a few lines later "confluence
(call-wall+max-pain): 125" in Trade manager read — the natural reading is "the call wall and
max-pain agree at 125," directly contradicting the call wall value stated one section earlier.

### Fix

Added `confluenceZoneLabel(z, {callWall, putWall})` in `play-brief.ts`: for each kind in the zone,
if a primary wall of that kind is known and the zone's own level for that kind differs from it by
more than a cent, the kind name is qualified with its actual price (`call-wall@125`); otherwise the
label is unchanged. The dollar level itself (`z.center`, the zone's weighted-average price) is
untouched either way — only the label text changes.

### Blast radius

Single function, single call site (`levelsFromContext` in `play-brief.ts`). Does **not** touch
`confluenceZones()`'s scoring/clustering (`vector-confluence.ts`) or what feeds it
(`vector-full-state.ts`) — Vector's own desk UI and Thermal render this data through separate call
sites over the same shared engine and are unaffected by this fix.

### Fix rationale

Considered instead changing the confluence engine itself to only ever consider the top-ranked wall
per side (raised as option (b) on #4076) — rejected for this PR because it's a shared, cross-desk
primitive change with a real behavioral tradeoff (it would suppress genuine lower-ranked confluence
a trader might want to see), and deserves its own decision rather than riding along with a labeling
fix. The chosen fix is the narrowest one that resolves the actual member-facing contradiction:
disclose when the two numbers genuinely differ, change nothing when they agree.

### Evidence of testing

- Two new tests in `play-brief.test.ts`: one reproduces the NRG-shaped case (`call wall 145,
  confluence zone's own call-wall level 125`) and asserts the label becomes
  `confluence (call-wall@125+max-pain)`; a sibling test confirms a zone whose call wall MATCHES the
  primary renders the original, unqualified label.
- RED confirmed pre-fix (isolated pattern-match run): the new disambiguation test failed with the
  actual pre-fix label `"confluence (call-wall+max-pain)"`.
- GREEN post-fix: both new tests pass; full `play-brief.test.ts` file 53/53.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, confirmed as
a real cross-session, cross-ticker pattern (not a single anecdote) before shipping — raised on
#4076 across three cycles (comments 5649059880, 5649697371, 5649766952) with no reply, then
recognized that the presentational half of the fix is scoped entirely to this file and does not
touch the shared engine the escalation was actually worried about.
