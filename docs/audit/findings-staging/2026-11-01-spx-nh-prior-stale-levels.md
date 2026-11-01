> **kind:** FINDING

## SPX Slayer: Night Hawk morning-prior bonus reclassifies direction/grade but never recomputes `confluence.levels` (entry/stop/target/invalidation) — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** production correctness audit of `src/features/spx/lib/spx-signals.ts` /
`spx-play-engine.ts`, following up on the Night Hawk morning-prior reclassification history
documented in `reclassifyConfluenceScore`'s own header (fixed 2026-09-22 for
grade/direction/agreeing/conflicts/weighted_conflicts, fixed again 2026-10-18 for `rawScore`). The
header's own instruction — "reassign every field it returns — never just `score` alone" — had a
second gap left unfixed.

**Root cause:** `spx-play-engine.ts` (~line 1965, inside the `getNhConfluenceBonus()` block)
applies the Night Hawk "morning prior" bonus (bounded ±3, `getNhConfluenceBonus`'s own contract)
by pushing a factor onto `confluence.factors` and calling `reclassifyConfluenceScore(desk,
confluence.score + nhBonus.bonus, confluence.factors)`, then reassigning every field the function
returned back onto `confluence`. But `reclassifyConfluenceScore`'s return type
(`Pick<SpxConfluence, ...>`) omitted `levels` — so `confluence.levels` (`entry`/`stop`/`target`/
`invalidation`) stayed frozen at whatever `buildLevels(desk, price, bias, action)` produced
**inside the original `computeSpxConfluence()` call, from the PRE-bonus `bias`/`action`.**

`buildLevels`'s stop/target geometry is keyed directly off `action`/`bias` (`spx-signals.ts`
~line 271-313: `BUY_CALL`/`HOLD+bullish` → long-side stop/target, `BUY_PUT`/`HOLD+bearish` →
short-side stop/target, anything else → `stop`/`target` stay `null`). The bonus is specifically
designed to cross reachable boundaries — the `|10|` WAIT/HOLD boundary and the `22` BUY_CALL/
BUY_PUT boundary are both within ±3 of a real score. When it does, `action`/`bias`/`direction`
correctly flip (that part was already fixed in 2026-09-22/2026-10-18), but `levels` does not
follow — so a member could see `direction: "long"` (or a fresh `BUY_CALL` action) paired with a
`target`/`stop`/`invalidation` that was computed for the OLD, no-longer-true action (frequently
`null`/`null`/"No clean level — reduce size or wait" if the pre-bonus action was `WAIT`).

**Evidence (RED → GREEN):** added a regression test to `src/features/spx/lib/spx-signals.test.ts`
("a bonus that flips action also recomputes levels.target, not the stale pre-bonus value"),
reusing the exact fixture (`reclassifyDesk()`, price 7400, vix 16) and the exact bonus (+3, score
8→11) the existing "flips direction from null to non-null" test above it already exercises for
the same boundary. RED (confirmed via `git stash` on `spx-signals.ts` alone, pre-fix): the test
throws `TypeError: Cannot read properties of undefined (reading 'target')`, because
`reclassifyConfluenceScore`'s return value had no `levels` key at all. GREEN (post-fix):
`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-signals.test.ts` →
17/17 pass (including the new test and the untouched golden-fixture byte-for-byte test).

**Fix:** widened `reclassifyConfluenceScore`'s `Pick<...>` return type to include `levels`, and
inside the function, re-ran the SAME `buildLevels(desk, desk.price, bias, action)` call
`computeSpxConfluence` uses, against the freshly reclassified `bias`/`action` — never the stale
pair the original `SpxConfluence` was built from. At the call site in `spx-play-engine.ts`, added
`confluence.levels = reclass.levels;` alongside the 9 fields already reassigned there, same
pattern as the 2026-10-18 `rawScore` fix. No alternative considered: `levels` is exactly as
derived from `bias`/`action` as `direction`/`agreeing` are, so the same reclassify-and-reassign
discipline applies with no special-casing.

**Blast radius:** `reclassifyConfluenceScore` has exactly one call site (`spx-play-engine.ts`
~line 1965, inside the Night Hawk bonus block) — fixed there. `confluence.levels` itself has many
downstream readers in `spx-play-engine.ts` (stop/target/invalidation feed `evaluatePlayGates`,
`evaluateOpenPlay`/`evaluateFlatPlay`'s returned play payloads, and the closed-play snapshot), all
of which now receive the freshly-recomputed levels whenever the bonus actually fires. Full
blast-radius sweep run: `npx tsx --experimental-test-module-mocks --test` across every
`*.test.ts` under `src/features/spx/` (977/977 pass) plus `npx tsc --noEmit` (clean). Nothing
else needed touching — the fix is additive (a new field on an existing `Pick<...>` type plus one
new reassignment line) and does not change any existing field's value or any gating decision.
