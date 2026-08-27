> **kind:** `FINDING`

## Vector play engine audit — 2 correctness bugs found and fixed, 3 gaps flagged for follow-up

| **Status** | FIXED (2 of 5 findings; see below for the other 3, left open) |
|---|---|

Member request: "can you also try to fully validate the entire play engine that cursor wrote... find
any bugs, gaps... check everything." Full audit covered `vector-play-engine.ts`,
`vector-play-engine.test.ts`, `vector-play-platform.ts`, `vector-regime.ts`, `vector-confluence.ts`,
`vector-play-candidates.ts`, `vector-wall-proximity.ts`, `vector-gamma-magnet.ts`,
`vector-wall-integrity.ts`, and the two production callers (`VectorChart.tsx`,
`src/lib/bie/vector-full-state.ts`). Every finding below was reproduced against the actual exported
functions, not inferred from reading alone.

### FIXED — Bug 1: inverted directional wording when spot breaks *above* a call wall
**File:** `src/features/vector/lib/vector-wall-proximity.ts` (`deriveWallProximity`)

`above = signed >= 0` means the call-wall strike is at/above spot (approaching from below). When
spot has broken **through and above** the wall, `above` is `false`, and the code emitted "**Back
under** the X call wall ... **lost magnet**, watch for fade" — describing spot as under a wall it
was actually 5+ points above. Reproduced live: `spot=7605, callWall=7600` → the old code printed
"Back under the 7,600 call wall (0.07% away) — lost magnet, watch for fade."

This is the exact same bug class the file's own comment (still in place, a few lines below)
documents having found and fixed on the **put-wall** side ("the prior 'reclaimed support, dip-buy
zone' wording ... inverting the directional bias") — the call-wall mirror was apparently never
patched. There was no test at all for this branch, so it went undetected. This string is pushed
verbatim into the member-facing "watch this now" `starred` list via `vector-play-engine.ts`.

**Fix:** mirrors the put-wall fix already in the file — `!above` (spot broke through) now reads
"Cleared the X call wall (Y% below spot) — resistance gave way; dealers stop capping, watch for
continuation higher," analogous to the put-wall's "support gave way" bearish-continuation wording.
Added a regression test (`vector-wall-proximity.test.ts`) mirroring the existing put-wall regression
test, asserting the callout never contains "back under" or "lost magnet" when spot has broken above.

### FIXED — Bug 2: confluence conviction credit keyed off the globally-strongest zone, not the zone at the traded level
**File:** `src/features/vector/lib/vector-play-engine.ts` (`computeConviction`)

`const top = zones[0] ?? null;` — always the single highest-scored confluence zone **anywhere on
the board**, never the zone nearest `refLevel` (the level this specific play actually trades). If a
stronger, unrelated zone exists elsewhere, the real confluence sitting at the traded level was
invisible to this check and only a flat `+3` far-field bump applied.

Reproduced: a fade-call setup at wall 7600 with a real 2-kind confluence zone exactly at 7600
(score 4) scored conviction 76 (grade A) alone; adding a stronger, unrelated 3-kind zone at 7300 (4%
away, score 6) **dropped** it to 73 (grade B) — adding strictly more corroborating market structure
elsewhere flipped the member-visible grade from A to B, because the stronger-but-irrelevant zone now
occupied `zones[0]` and starved credit for the zone actually being traded. This directly contradicts
the function's own doc comment ("Confluence stacked AT the level the play references... is the
single biggest edge").

**Fix:** scans all zones for the one nearest `refLevel` (not the globally top-scored one) and credits
that zone's score when it's within the proximity band; otherwise the same flat `+3` far-field bump.
Added a regression test asserting conviction never drops when an unrelated stronger zone is added
elsewhere.

### OPEN — 3 gaps flagged for follow-up (not fixed here; each needs a design decision, not a one-line patch)

1. **BIE grounding is fully built and tested but never populated by either production caller.** The
   engine has real, tested conviction-adjustment logic for `PlayBieContext` (historical win-rate
   nudges ±10, plus a starred evidence line), but both `src/lib/bie/vector-full-state.ts` (hardcoded
   `bie: null`) and `VectorChart.tsx` (zero references to `input.bie`) never supply a real value. The
   only place a real `bie` exists in the repo is the test fixture. Fully engineered, fully
   unit-tested, unreachable by any real member session — same shape as the deferred contract-picks
   BIE gap noted earlier this session.
2. **`dataAgeMs`/`dataAge` is a documented freshness passthrough that nothing sets and nothing
   reads.** `computeConviction` never reads it (zero staleness discount on conviction), the sole
   client caller never sets it on the snapshot it builds, and no UI component reads `play.dataAge` to
   show staleness as the doc comment claims. The field is simultaneously never produced and never
   consumed.
3. **Untested, unmeasured bearish default when short-gamma has no wall and no clear trend.** When
   posture is short, no wall is in proximity, and `technicals.emaStack` is absent/mixed, the engine
   still emits a directional "momentum-short" play off an asserted, uncited "asymmetry of a
   short-gamma regime" — the equivalent no-signal case under long gamma correctly falls through to
   neutral `range`. This exact branch is not exercised anywhere in `vector-play-engine.test.ts`, and
   unlike this repo's other documented design decisions (`docs/audit/INTENTIONAL-DESIGN.md`), it
   carries no equivalent measurement/A-B harness.

Flagging these 3 for Cursor (who wrote this module) rather than fixing here — each is a real design
question (build the missing BIE writer? add a staleness discount curve and calibrate it? measure the
short-gamma-no-signal default before keeping or removing it?), not a mechanical bug fix.

**Not flagged (checked and found correct):** `rangeMeanReference`'s rail-inclusion/collision
handling; `pickTargets`'s beyond-trigger exclusion; the position-horizon EMA-stack override ordering
relative to flip-pivot; `computeConviction`'s magnet-alignment gating on `posture === "long"` only;
`vector-play-platform.ts`'s bull/bear symmetry; wall-integrity's strength/persistence/isolation
normalization.

**Verification:** `npx tsx --test` on both touched test files clean; full suite clean; `tsc
--noEmit` clean; `npm run build` clean.
