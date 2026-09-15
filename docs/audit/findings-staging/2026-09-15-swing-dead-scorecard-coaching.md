> **kind:** FINDING

## `scorecardCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — FIXED (dead-code removal)

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `scorecardCoaching(play)` (`src/lib/swing/play-brief-narrative-coaching.ts`) read
`play.scorecard` and returned `null` unless it was present with `n >= 10`. `TerminalPlay.scorecard`
is genuinely populated for 0DTE (`zerodte-sources.ts:169`) and Legacy (`legacy-board-detail-copy.ts:30`
reads it), but **never for SWING/LEAPS** — `terminalPlayFromHorizon` (`adapters.ts:801-1027`, the
SWING/LEAPS adapter) has zero `scorecard` references anywhere in its body, and `play-brief-resolve.ts`
(the file that retroactively patches other fields like `ivRank` onto a swing `TerminalPlay`) has zero
`scorecard` references either — no override path exists. Yet `scorecardCoaching(play)` was called
unconditionally inside the swing coaching assembly (`collectCoachingBullets`, line 1149) for every
single swing/LEAPS brief composed.

This made the call structurally dead — not "data-starved on this particular fetch," but guaranteed
to return null for 100% of swing traffic, forever, by the same architectural decision `adapters.ts`
already documents for swing's `tierLabel: null` ("swing has no calibrated tier engine to back" a
letter grade). Not a missing signal that needs wiring up: swing already ships a superior, honest
replacement for this exact intent — `archetypeTrackRecordSection`/`graduatedArchetypeEntry` (#4685,
Wilson-LB gated, sub-lane-specific track record).

**Evidence:** grepped the full producer chain — `terminalPlayFromHorizon` body (adapters.ts:801-1027):
zero `scorecard` writes. `play-brief-resolve.ts`: zero `scorecard` references. `scorecardCoaching`
itself and its one call site (`play-brief-narrative-coaching.ts:831,1149`): confirmed as the only two
matches for `scorecardCoaching` anywhere in the repo, with zero test coverage referencing it either
(confirming it was never exercised by anything that would have caught the gap).

**Blast radius:** none on member-facing output — the call always evaluated to `null`, and `push()`
(the coaching-bullet accumulator) silently drops nulls, so this was a functional no-op for the
entire lifetime of the swing coaching assembly, not a rendering defect. The risk was purely a
maintenance/readability one: a future reader could mistake this call for live functionality and
build on a false assumption, or spend time debugging why "Playbook stats" never appears on a swing
brief without realizing it structurally never can.

**Fix:** removed the dead `scorecardCoaching` function and its one call site from the swing coaching
assembly. Left an explanatory comment at the removal point tracing the root cause (which field is
genuinely alive for 0DTE/Legacy, why it can never populate for swing, and which existing section
already covers the same intent honestly) so a future reader doesn't have to re-derive this.

**Fix rationale:** deletion over a defensive `if (false)`/comment-out, since the underlying
architectural decision (swing has no calibrated tier engine) is not expected to change, and swing
already ships the correct replacement — keeping dead code around invites confusion, not
future-proofing. The shared `TerminalPlay.scorecard` type field and its genuinely-live 0DTE/Legacy
consumers are untouched.

**Test:** no regression tests removed or needed — zero tests referenced `scorecardCoaching` before
this change (confirming it was untested dead code). Full `src/lib/swing/*.test.ts` suite (1142
tests, unchanged count) green before and after, `tsc --noEmit` and `eslint` clean on the changed
file.
