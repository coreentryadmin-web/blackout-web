> **kind:** `FINDING`

## Ask Largo swing brief's diff engine never narrated a roll-candidate transition — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-diff.ts`) |
| **Severity** | P3 (a real, already-rendered signal was invisible to the diff pulse — not a crash/incorrect-number bug) |
| **PR** | fix/swing-roll-candidate-diff-narration |

### Root cause

`play.rollCandidate: { reason: string } | null` (`src/features/nighthawk/command-deck/types.ts:301`)
is a real, live per-tick signal — set in `live-plays.ts:285-315` (the manage engine's roll-migration
check) and already rendered as a static "Roll watch" line in the Management section every refresh
once present (`play-brief.ts:146-148`, shipped this session as #5163).

But `play-brief-diff.ts`'s `BriefSnapshot` type (its whole job is to narrate what changed since the
LAST refresh — the "Since last read" pulse `useSwingPlayBrief.ts`'s polling exists to drive) had no
`rollCandidate`-derived field at all, and `snapshotFromBrief` never read `play?.rollCandidate`. So a
position crossing INTO roll-candidate territory — the manage engine newly weighing a roll, arguably
the single most actionable live trade-manager fact there is — produced zero diff narration, even
though the same diff engine already narrates far less urgent things (a HELIX flow premium moving
>$50k, a GEX wall drifting 5 cents, a trim rail firing). A member relying on the diff pulse alone
would only ever notice a fresh roll watch by re-reading the entire static Management block on every
poll — silently indistinguishable from "nothing changed."

### Evidence

Grep evidence (pre-fix, on `origin/main`):
- `types.ts:301`: `rollCandidate?: { reason: string } | null;` on `HorizonPlay`/`TerminalPlay`.
- `live-plays.ts:285-315`: the roll-migration check computing `rollCandidate`, threaded onto the
  returned play at `live-plays.ts:315`/`591`.
- `play-brief.ts:146-148`: `if (play.rollCandidate) { lines.push(\`Roll watch: ...\`) }` — the
  existing static rendering.
- Zero pre-existing hits for `rollCandidate` in `play-brief-diff.ts`, verified by isolating the file
  via `git stash` before the fix.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-roll-candidate-diff-narration`
branch off actual latest `origin/main`):
- Reverted `play-brief-diff.ts`, kept the tests. `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief-diff.test.ts`: **2 failures** (the two new trigger/clear tests) — the
  expected "field/rule doesn't exist yet" shape. 24/26 pass, nothing pre-existing broke.
- Reapplied. Re-ran the same file plus the directly-related sweep (`play-brief.test.ts`,
  `live-plays.test.ts`, `manage.test.ts`): **168/168 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result appended below once complete.

### Blast radius

Single-file addition to the diff engine's own data model:
- `src/lib/swing/play-brief-diff.ts` — new `rollCandidateReason: string | null` on `BriefSnapshot`;
  populated in `snapshotFromBrief`; two new edge-crossing rules in `diffBriefSnapshots`.

No other consumer needed updating — `BriefSnapshot` is internal to the diff engine, and the two new
narration lines slot into the same `lines: string[]` output every other diff rule already appends to.

### Fix rationale

Additive: a new field, a new pair of narration rules, nothing removed or flattened. Only the two
genuine EDGE crossings (null→reason, reason→null) are narrated — a roll-candidate reason merely
restating tick-to-tick (still weighed, DTE ticking down inside the same migration window) is NOT a
new fact worth a "What changed" line, matching the file's existing discipline elsewhere (e.g.
trims-fired only narrates on an increase, never on an unchanged repeat) — narrating every tick's
reason text would produce noise on every poll rather than a genuine signal.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main`, not the originating research agent's own working-tree state — diff applied
  cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
