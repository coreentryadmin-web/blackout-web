> **kind:** FINDING

## `morningConfirmCoaching` was called unconditionally on every WATCH-bucket swing brief but was structurally guaranteed to always return null — FIXED (dead-code removal)

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `morningConfirmCoaching(play)` (`src/lib/swing/play-brief-narrative-coaching.ts`)
branched on `play.pulled`, `play.morningStatus`, and `play.morningReason`. Those three fields are
genuinely populated for Legacy (`terminalPlayFromEdition`, `adapters.ts:1107+`, reads
`src.morning_status`/`src.morning_reason`/`src.pulled` off `EditionDeckSource`) but **never for
SWING/LEAPS** — `terminalPlayFromHorizon` (`adapters.ts:801-1027`, the SWING/LEAPS adapter) sets
none of the three on its returned `TerminalPlay`, and its own input type (`HorizonDeckSource`,
`adapters.ts:645-801`) doesn't carry a `morning_status`/`pulled`/`morning_reason` field to source
them from at all — confirmed via grep across both the function body and the interface. No
swing-side resolve step (`play-brief-resolve.ts`) patches these fields in either.

Yet `morningConfirmCoaching(play)` was called unconditionally for every WATCH-bucket swing/LEAPS
brief (`collectCoachingBullets`, inside the `bucket === "watch"` branch). All four of the function's
`if` conditions read a field that is structurally always `undefined` on a swing `TerminalPlay`, so
every branch was always false and the function always returned `null` — guaranteed dead for 100% of
swing WATCH traffic, forever, by the same class of lane-specific field gap as the already-fixed
`scorecardCoaching` (same root cause shape: a field genuinely live for a sibling lane, never
populated for swing, read by a function called unconditionally in the swing assembly anyway).

**Evidence:** grepped `terminalPlayFromHorizon`'s true function body (lines 801-1027, verified via
the file's own closing brace before the next `EditionDeckSource` interface declaration) and its
input type `HorizonDeckSource`: zero `morning`/`pulled` matches in either. Grepped
`play-brief-resolve.ts`: zero matches. Grepped the whole repo for `morningConfirmCoaching`: exactly
two matches, the function definition and its one call site — no other importers. Zero test coverage
(`play-brief-narrative-coaching.test.ts` has no reference to this function).

Live-confirmed (not just by grep): fetched GOOG's real WATCH-bucket play-brief — the Trade-manager-
read section carries zero "morning confirm"-related text, consistent with the function silently
no-op'ing on real production data.

**Blast radius:** none on member-facing output — same as `scorecardCoaching`, the call always
evaluated to `null` and `push()` (the coaching-bullet accumulator) silently drops nulls, so this was
a functional no-op for the entire lifetime of the swing coaching assembly, not a rendering defect.
The risk was purely maintenance/readability: a future reader could mistake this call for live
WATCH-bucket functionality.

**Fix:** removed the dead `morningConfirmCoaching` function and its call site from the swing
coaching assembly's WATCH-bucket branch. Left an explanatory comment at the removal point tracing
the root cause and explicitly naming the identical `scorecardCoaching` precedent, so a future reader
recognizes the pattern rather than re-deriving it.

**Fix rationale:** same as `scorecardCoaching` — deletion over a defensive comment-out, since the
underlying lane-boundary gap (swing has no morning-confirm/pre-market-gate concept at all; that is a
Legacy-only workflow) is architectural, not a temporary data gap. `watchGateCoaching`, the sibling
coaching call directly below this one, already covers swing's own real WATCH-bucket gate signals
honestly.

**Test:** no regression tests removed or needed — zero tests referenced `morningConfirmCoaching`
before this change. Full `src/lib/swing/*.test.ts` suite (1144 tests, unchanged count) green before
and after, `tsc --noEmit` and `eslint` clean on the changed file.
