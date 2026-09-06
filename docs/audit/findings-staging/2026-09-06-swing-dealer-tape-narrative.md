# Ask Largo swing brief — GEX/dark-pool sections read as a data dump, not a trade manager's read

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product enhancement — direct trader feedback, not a defect) |
| **Area** | Swing / Ask Largo play brief |
| **Files** | `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-intel.test.ts` |

## Context

Operator feedback, verbatim: *"We could also add dark pool levels maybe .. saying watch here as
there is major dark pool levels .. king node at this level .. max pain, max gamma .. dealers
stepping in buying so it looks like this level could hold .. watch for this to break .. etc etc ..
more like a narration, trade manager instead of throwing down some random values ... Why cant we
make it like narrative??"*

## Root cause / gap

Three separate sections in the brief — `chartLevelsSection`, `gexPostureSection`,
`wallDynamicsSection` — each independently emitted bullet lines against the SAME underlying
numbers (call/put wall, gamma flip, GEX king strike, max pain, dark-pool prints, wall-strength
events), e.g.:
```
Call wall (GEX): 452.30 — +2.1%
GEX king strike: 450.00
Max pain: 450.10
Dark pool levels: 450.50 ($1.2M)
```
Every ingredient the operator asked for (king node, max pain, dark pool, dealer posture, "watch
for a break") was ALREADY computed and already present on `VectorFullState`/`GexPositioning` — the
gap was entirely in presentation: three lists of numbers left the reader to do the synthesis
("king strike and max pain and dark pool are all near 450 — is that meaningful? is that why the
level might hold?") that a real trade manager would do out loud.

## Fix

Replaced `gexPostureSection` + `wallDynamicsSection`, and trimmed the wall/flip/king-strike/
max-pain/dark-pool lines out of `chartLevelsSection` (kept there: expected-move bands, confluence
zones, proximity — genuinely distinct data), with one new narrated section:
**`dealerTapeSection()`** — "Dealer & dark-pool read". It synthesizes, in connected prose:
1. Dealer gamma posture and its behavioral implication ("dips get bought" / "moves can
   accelerate") — the WHY.
2. The magnet level(s) — GEX king strike and max pain, explicitly calling out when they're
   confluent ("two independent reads pointing at the same magnet") rather than listing both as
   unrelated numbers.
3. The structural wall worth watching, **direction-aware** (put wall as support for a LONG, call
   wall as the ceiling; reversed for a SHORT) — not just "here are both walls," but which one
   actually matters for THIS play.
4. Dark-pool institutional footprint, with an explicit confluence check against the GEX walls —
   "a real block trade agrees with it" when they line up, vs. "worth keeping on the radar" when
   they don't (never claims false confluence).
5. Wall-strength dynamics (`vec.wallEvents`) — building vs. fading — flagged as reinforcing or
   undermining the level, not just reported as a bare tag.
6. A direction-aware "Bottom line" invalidation sentence — the level, the direction it must hold,
   and an explicit "a close through it on real volume, not a wick" framing — the actual watch-for-
   a-break instruction the operator asked for.

Every clause is independently null-gated (matches the existing section convention across the
file) so a partial data read still narrates whatever IS known instead of either fabricating a
missing piece or refusing to render at all.

## Evidence (RED → GREEN)

New `play-brief-intel.test.ts` cases (16 total, 11 new for `dealerTapeSection`) cover: null on no
data, long/short gamma posture narration, confluent vs. non-confluent king-strike/max-pain framing,
direction-aware wall framing (LONG vs SHORT), dark-pool confluence vs. standalone framing, and
building vs. fading wall-event framing.

`git stash` on `play-brief-intel.ts` alone: **11/16 fail** (the 5 pre-existing `bookContextSection`
tests still pass, confirming the stash isolated exactly the new code). Restored: **16/16 pass**.
`tsc --noEmit` clean. Full `npm test` in progress at write time (Node 20); the earlier full run
this session (12867/12871, single pre-existing failure already tracked by PR #4081's
`computeLaneRank` guard, unrelated to this file) established the pre-change baseline.

## Blast radius

- No consumer reads `envelope.sections` by hardcoded title "GEX posture" or "Wall dynamics" —
  grepped the full repo, confirmed clean (only prose/doc mentions of those phrases elsewhere,
  no code dependency).
- `play-brief-diff.ts`'s `sectionTitles` diff compares titles generically (new/removed), so
  renaming/merging section titles here doesn't break the "what changed" engine — a brief that
  updates from the old section set to the new one on first load after this ships will show
  "New sections: Dealer & dark-pool read" once, which is correct (it IS new).
- `chartLevelsSection`'s trimmed lines (call/put wall, flip, king strike, max pain, dark pool) are
  not silently dropped — they now render, synthesized, inside `dealerTapeSection` instead.

## Fix rationale — what was deliberately left unchanged

- Kept `chartLevelsSection` (renamed nothing, same title "Levels on chart") for expected-move
  bands and Vector's own multi-factor confluence zones — genuinely distinct data the narrative
  doesn't (and shouldn't) restate.
- Did not touch `vectorDeskSection` (Vector's own play-engine narrative, `p.thesis`/`p.entryZone`)
  — it's already prose-first from a different, already-narrative-shaped source; duplicating its
  job would be redundant, not additive.
- Confluence thresholds (0.5% for king-strike/max-pain, 1% for dark-pool-vs-wall) are declared
  constants in the function, not configurable — this is presentation synthesis, not a new gate or
  scored signal, so no calibration/tuning surface was added.
