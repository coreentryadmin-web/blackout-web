> **kind:** FINDING

## Vector active (non-universe) bead-recorder lane never rotates — tail tickers starve forever — FIXED

**Status:** FIXED (round 305 discovery audit)

### Root cause

`src/features/vector/lib/vector-bead-schedule-core.ts`'s `selectTickersToRecord` implements a
round-robin scheduler specifically to fix a documented production incident (#2320, 2026-08-19):
without a rotating `cursor`, a binding concurrency ceiling always serves the same prefix of the
roster every tick and starves the tail completely (simulated: roster 122 / limit 64 over a full
RTH session gave the head 4680 samples each and the tail **0**). The fix is to persist a cursor
across ticks and feed it back in as `cursor`, which `vector-bead-recorder-core.ts`'s
**universe lane** (`recordSharedUniverseWallSamples`) does correctly via its module-level
`sharedSweepCursor`.

`vector-bead-recorder-core.ts`'s **second lane**, `recordActiveNonUniverseWallSamples` (records
15s bead buckets for viewer-watched tickers that are not yet in the shared universe — e.g. a
member's first view of PLTR/ASTS/any off-universe symbol), calls the exact same
`selectTickersToRecord` scheduler but **never passed a `cursor` at all**. `selectTickersToRecord`
itself documents what this means: *"Omitting `cursor` keeps the old index-0 behaviour, which is
what the HTTP backup cron and the existing tests rely on — rotation is a property of a REPEATING
caller, and a one-shot caller has no next tick to be fair across."* `recordActiveNonUniverseWallSamples`
is **not** a one-shot caller — the leader (`vector-bead-recorder-leader.ts`) invokes it every 15s,
forever, exactly like the universe lane beside it — so it silently inherited the pre-#2320
no-rotation behaviour the universe lane was specifically fixed to avoid.

`getActiveVectorTickers()` (`vector-stream-hub.ts`) returns the subscribed-ticker list in stable
Map-insertion (first-subscribed) order — no shuffling anywhere upstream. So whenever more distinct
off-universe tickers are actively viewed at once than the lane's own cap
(`vectorActiveBeadRecordConcurrency()`, default **8**), the lane's `selectTickersToRecord` ceiling
binds, and with no cursor to rotate the scan, the **same first ~8 subscribed tickers win every
single tick, forever** — every ticker past that point in subscription order gets **zero** 15s bead
samples for its entire session, the identical "tail recorded 0 samples" shape measured live for the
universe lane in #2320, just reintroduced in this second lane when it was added afterward (nothing
in this file's extensive #2320/#2303 commentary mentions the active lane needing the same fix).

### Evidence

Wrote `src/features/vector/lib/vector-bead-recorder-active-lane.test.ts`, mocking
`vector-stream-hub`/`vector-dynamic-universe`/`vector-universe` (and `server-only`) the same way
`vector-bead-rail-walls.test.ts` already does, and calling the REAL, unmodified
`recordActiveNonUniverseWallSamples` repeatedly with 20 simulated active off-universe tickers
(lane cap 8):

- **RED (pre-fix, manually verified against the unmodified function):** across 10 ticks, only
  `T00..T07` (the first 8, by subscription order) ever appear in `recordedTickers` — `T08..T19`
  (the tail, 12 of the 20 tickers) record **zero** samples across all 10 ticks, confirmed by a
  scratch run printing `served count: 8 of 20`.
- **GREEN (post-fix):** the same 20-ticker/10-tick scenario serves all 20 tickers at least once,
  and a second test confirms the whole 17-ticker roster is fully covered within
  `ceil(roster / laneCap)` ticks — the same fairness bound the universe lane's own
  "ROSTER FAIRNESS" tests already require of `selectTickersToRecord`.
- Full `vector-bead-recorder-core.test.ts` (40 cases across the recorder + leader + cron-route
  test files, including every existing universe-lane fairness simulation) stays green — the fix
  only threads a cursor through the active lane; the universe lane's own `sharedSweepCursor` and
  behaviour are untouched.

### Blast radius

Single call site: `recordActiveNonUniverseWallSamples` in `vector-bead-recorder-core.ts` is the
only caller of `selectTickersToRecord` for the active lane (confirmed via repo-wide grep — the only
other caller is the universe lane a few lines above, which already carries `sharedSweepCursor`
correctly). The HTTP backup cron (`src/app/api/cron/vector-bead-record/route.ts`) and the leader's
`activeTick()` both call the function with no arguments related to this, so the fix is entirely
internal to `vector-bead-recorder-core.ts` and needs no caller change.

### Fix rationale

Mirror the universe lane's own established pattern exactly: add a second module-level persisted
cursor (`activeLaneCursor`, alongside the existing `sharedSweepCursor`), thread it into the active
lane's `selectTickersToRecord` call as `cursor`, and write `decision.nextCursor` back after. Also
added `_resetVectorBeadRecorderStateForTest()` (test-only) to reset both cursors plus the shared
`recordInFlightTickers`/`narrowedTickIndex` module state, since neither lane previously exposed a
reset hook and a reliable regression test needs one. Deliberately did **not** touch
`selectTickersToRecord`/`vector-bead-schedule-core.ts` itself — that function already behaves
correctly when given a cursor; the defect was entirely in one caller forgetting to supply one, the
same class of gap the existing "omitting cursor keeps the old index-0 behaviour... for a one-shot
caller" doc comment already warns about.

### Files changed

- `src/features/vector/lib/vector-bead-recorder-core.ts` — added `activeLaneCursor`, threaded it
  into `recordActiveNonUniverseWallSamples`'s `selectTickersToRecord` call, added
  `_resetVectorBeadRecorderStateForTest()`.
- `src/features/vector/lib/vector-bead-recorder-active-lane.test.ts` — new regression test (RED
  without the fix, GREEN with it).
