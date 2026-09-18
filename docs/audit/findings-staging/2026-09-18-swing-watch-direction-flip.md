> **kind:** `FINDING`

## Ask Largo swing brief's diff engine never narrated a WATCH-candidate direction flip — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-diff.ts`) |
| **Severity** | P3 (a real, already-carried field was documented "safe to skip" incorrectly for one bucket — not a crash/incorrect-number bug) |
| **PR** | fix/swing-watch-direction-flip |

### Root cause

`BriefSnapshot.direction` (`play-brief-diff.ts`) was documented "not itself diffed (a play's
direction doesn't change mid-life)." This is true for a COMMITTED position — direction locks to
the position at commit — but false for a WATCH candidate: `TerminalPlay.id` for an uncommitted row
is `${horizon}:${ticker}` with no `positionId` suffix (`adapters.ts`, `positionId` only appended
`if (src.positionId != null)`), so the SAME `play.id` persists across discovery cycles while
`src.direction` (freshly derived each cycle from that cycle's net-flow read) can genuinely flip
bullish↔bearish before ever being committed — a ticker's accumulated flow can turn from
net-bullish to net-bearish (or vice versa) session to session.

`diffBriefSnapshots` is keyed by that stable `play.id`, so a real directional reversal on a WATCH
ticker — arguably the single most material fact possible, since every other diffed field (thesis
health, spot, walls) is only meaningful relative to a direction the diff engine was implicitly
assuming stayed constant — was silently un-narrated by "What changed."

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5190):
- `play-brief-diff.ts`: `BriefSnapshot.direction` populated (`direction: play?.direction ?? null`)
  and read inside `adverseSpotDrift()` (used to judge whether a spot move is adverse), but never
  itself compared prev-vs-next anywhere in `diffBriefSnapshots` — confirmed via
  `grep -n "\.direction\b" play-brief-diff.ts`: only reads of `next.direction`, zero prev/next
  comparisons.
- `adapters.ts:983`: `id: \`${src.horizon}:${src.ticker.toUpperCase()}${src.positionId != null ?
  \`:${src.positionId}\` : ""}\`` — a WATCH row's id has no positionId suffix.
- `adapters.ts:930/985`: `direction: src.direction` — freshly derived per-cycle, not pinned.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-watch-direction-flip` branch off
the actual latest `origin/main`, which already includes #5190's merge):
- Reverted `play-brief-diff.ts`, kept the tests. `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief-diff.test.ts`: **1 failure** (the new direction-flip test) — the
  expected "rule doesn't exist yet" shape. 25/26 pass, nothing pre-existing broke.
- Reapplied. Re-ran the same file: **26/26 pass**. Broader sweep (`play-brief-diff.test.ts` +
  `play-brief.test.ts` + `thesis-health.test.ts` + `live-plays.test.ts`): **166/166 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result to be appended once the background run completes.

### Blast radius

Single-file addition to the diff engine:
- `src/lib/swing/play-brief-diff.ts` — new `directionChanged` check in `diffBriefSnapshots`,
  narrated first (ahead of every other rule, since a flip recontextualizes all of them); corrected
  the `BriefSnapshot.direction` doc comment to no longer claim direction is universally
  mid-life-stable.

No new fields threaded through the data model — `direction` was already present on
`BriefSnapshot`; this fix only adds a comparison rule at one existing call site.

### Fix rationale

Additive: a new narration rule, one corrected doc comment, nothing removed or flattened. Only
fires when both snapshots carry a real, non-null direction — never fabricates a flip off a
missing/predates-this-field snapshot (an older persisted snapshot from before this field existed
degrades to silent, not a false flip). Narrated first because every other diff rule's meaning
(favorable/adverse spot drift, thesis fade direction) is itself direction-relative — a flip
invalidates the framing of anything diffed alongside it in the same pulse.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5190's merge), not the originating research round's own
  working-tree state — every claimed pre-existing behavior (`adapters.ts`'s conditional positionId
  suffix, `src.direction`'s per-cycle derivation) independently grep-verified, diff applied
  cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
