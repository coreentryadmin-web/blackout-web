## wallDynamicsSection showed the OLDEST wall events, not the most recent ones — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** `vec.wallEvents` is chronologically ASCENDING (oldest-first) — `eventsFromWallHistory`
(`vector-wall-events.ts`) builds the array by iterating wall-history samples FORWARD (`for (let i =
1; i < history.length; i++)`, appending each diff), so index 0 is the earliest detected wall
transition and the last index is the newest. Every other reader of this identical field treats it
this way and takes from the END to get the most recent activity: `wallDynamicsCoaching`
(`play-brief-narrative-coaching.ts`, the sibling section rendering in the same brief's "Trade
manager read") does `events.slice(-2)`; `tradeManagerNarrativeSection`'s own "Wall just moved"
bullet (`play-brief-narrative.ts`) explicitly does `walls[walls.length - 1]`. `wallDynamicsSection`
instead used `events.slice(0, 5)` — the FIRST 5 elements — backwards relative to both its own title
("Wall bead dynamics — building/fading nodes") and doc comment ("these are TODAY's building/fading
wall events").

**Live impact:** a ticker accumulating more than 5 wall events in a session (routine by midday)
renders this dedicated "Wall dynamics" section showing the 5 EARLIEST events — e.g. pre-market noise
from hours earlier — and never shows the most recent 3+ events at all, while the SAME brief's "Trade
manager read" section, built from the exact same `vec.wallEvents` array, correctly describes the
newest, most decision-relevant wall shift. Two sections of one composed brief disagree about what
"current" wall activity looks like, purely because one slices from the front and the other from the
back of the same chronologically-ordered array.

**Fix:** Change `.slice(0, 5)` to `.slice(-5)`, matching the sibling sections' convention.

**Fix rationale:** Minimal, single-call fix — no change to how the array is built or ordered,
just correcting which end this one section reads from.

**Blast radius:** Single function (`wallDynamicsSection`). No other call site slices this array the
old way.

**Tests:** 1 new regression test — 8 synthetic wall events (ascending, oldest to newest), asserts
the rendered section includes the 5 most recent (e3 through e7) and excludes the 3 oldest (e0-e2).
RED→GREEN proven via `git stash` on just the source file (test failed pre-fix — showed e0-e4 instead
— passes post-fix). Full `play-brief-intel.test.ts` (287 tests) green on Node 20. `tsc --noEmit`
clean.
