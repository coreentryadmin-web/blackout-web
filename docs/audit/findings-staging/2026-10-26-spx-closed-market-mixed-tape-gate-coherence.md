> **kind:** `FINDING`

## SPX Slayer closed-market branch never ran the mixed-tape sub-check — `desk_context.mixed_tape_blocked:true` could show with no "Tape's mixed" text anywhere in `gates` — FIXED

| | |
|---|---|
| **Severity** | P3 — genuine API-contract coherence defect (the "gates.blocks coherent with underlying data" class of check this repo's audits apply everywhere else), but currently inert: a repo-wide grep found no UI component that reads `desk_context.mixed_tape_blocked`, and `src/lib/largo/spx-play-fit.ts` explicitly drops the whole `desk_context` object before Largo ingestion — so no member or Largo answer is affected today. Fixed anyway because the contract defect is real and cheap to close. |
| **Surface** | `src/features/spx/lib/spx-play-context.ts` (`buildSpxPlayDeskContext`), `src/features/spx/lib/spx-play-engine.ts` (`evaluateSpxPlayCore`'s closed-market branch), `src/features/spx/lib/spx-play-gates.ts` (`evaluatePlayGates`, new `mixedTapeGateMessage` export) |
| **Status** | FIXED |

### Root cause

`buildSpxPlayDeskContext` (`spx-play-context.ts`) unconditionally computes
`desk_context.mixed_tape_blocked = weighted_conflicts >= mixed_tape_threshold` on every response,
whether or not the real gate stack ever ran. `evaluateSpxPlayCore`'s closed-market branch
(`spx-play-engine.ts`, the `!desk.market_open && !premarket` path) hand-builds `gates` instead of
calling `evaluatePlayGates`:

```ts
gates: {
  passed: false,
  blocks: ["Session closed"],
  blocks_by_category: categorizeGateBlocks(["Session closed"]),
  first_block_category: firstGateBlockCategory(["Session closed"]),
  warnings: [],               // <-- always empty, regardless of desk_context
  entry_mode: "none",
  play_idea: playIdea,
},
```

`evaluatePlayGates` (`spx-play-gates.ts`) is the ONLY place that previously applied the mixed-tape
check (`confluence.weighted_conflicts >= mixedTapeBlockThreshold(confluence.grade, abs)`) and
appended `"Tape's mixed — too many conflicting signals for clean entry"` to `blocks`/`warnings` —
and the closed-market branch never called it. So the two independently-computed fields could
disagree: confirmed live, a real closed-market `/play` response showed
`desk_context.mixed_tape_blocked:true` alongside `gates.blocks:["Session closed"]` with no "Tape's
mixed" text anywhere in `gates.blocks` or `gates.warnings`.

### Why this wasn't caught earlier

The closed-market shortcut exists specifically to avoid running the full entry-gate machinery
(trade governor, halt checks, session-entry counters, playbook live-gate — all meaningless when no
entry is possible at all because the session is closed), which is correct. But that shortcut threw
out the mixed-tape sub-check along with everything else, even though that one check is cheap,
desk/confluence-only, and `desk_context` kept computing its own independent copy of the exact same
condition regardless.

### Evidence

New tests:

- `src/features/spx/lib/spx-play-context.test.ts` — `"mixed-tape coherence: desk_context
  .mixed_tape_blocked and the gate's mixed-tape message never disagree"`. Builds a confluence-shaped
  object (desk + score/grade/factors/direction) with exactly as many soft-opposing factors as the
  real `mixedTapeBlockThreshold` requires (computed via the real function, not a hardcoded magic
  number — robust to `SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN`/`SPX_PLAY_CONFLICT_BLOCK_MIN` env
  overrides), feeds it into both `buildSpxPlayDeskContext` and the new `mixedTapeGateMessage`, and
  asserts they agree in both directions (mixed tape → both fire; clean tape → neither fires).
- `src/features/spx/lib/spx-play-engine.test.ts` — `"evaluateSpxPlayCore closed-market branch runs
  the shared mixed-tape check and wires it into gates.warnings"`. A source-text regression guard
  (same idiom as the file's existing `getNhConfluenceBonus` staleness-check test) pinning that the
  closed-market branch actually calls `mixedTapeGateMessage(closedConfluence)` and merges the result
  into `gates.warnings` — the behavioral test above only proves the two shared functions agree in
  isolation, not that the engine's closed-market branch still wires them together, so this
  companion test exists specifically to catch a future regression that reverts just the engine-side
  wiring while leaving the gates.ts export intact. Driving this end-to-end through the real
  `computeSpxConfluence` signal engine was deliberately avoided — its own session-quality/live-tape
  factors shift with wall-clock ET time, which would make the test flaky depending on when CI runs.

RED→GREEN confirmed via a manual pre-fix/post-fix swap (this sandbox's shared git-stash stack makes
a bare `git stash` unsafe — pre-fix content was restored from `git show HEAD:<file>`, tested, then
the fixed content restored):

- **Before the fix:** `spx-play-context.test.ts` 5/6 pass (the new coherence test fails:
  `mixedTapeGateMessage is not a function`, since the export didn't exist yet).
  `spx-play-engine.test.ts` 6/7 pass (the new source-text regression test fails: the closed-market
  branch's hardcoded `warnings: []` doesn't match the expected wired-up pattern).
- **After the fix:** both files pass in full — `spx-play-context.test.ts` 6/6,
  `spx-play-engine.test.ts` 7/7. The two pre-existing mixed-tape tests in `spx-play-gates.test.ts`
  (`"mixed tape hard-blocks BUY"`, `"mixed tape warns on WATCH intent"`) also still pass unchanged,
  confirming the refactor into a shared `mixedTapeGateMessage` helper didn't alter
  `evaluatePlayGates`'s own behavior.

### Blast radius

`mixedTapeBlockThreshold` had exactly one consumer before this fix
(`evaluatePlayGates`'s inline check) plus `buildSpxPlayDeskContext`'s independent recompute of the
same condition — both now share the same `mixedTapeGateMessage` helper for the actual verdict, so
they can never drift apart again regardless of future changes to the threshold formula. No other
call site references the old inline `mixedTapeMsg` construction (verified by reading the full diff);
`evaluatePlayGates`'s behavior for every other path (`entry_intent: "watch"` and `"buy"`, on an open
market) is byte-identical before and after — the refactor only extracts the existing condition into
a named, exported function.

### Fix rationale

Extracted the shared condition into `mixedTapeGateMessage` (`spx-play-gates.ts`) rather than calling
the full `evaluatePlayGates` from the closed-market branch: `evaluatePlayGates` needs a `session`
object (buy-cooldown/loss-streak/governor state), a `confirmations` result, and various playbook
options that are meaningless (and in some cases simply unavailable) once the market is closed — the
closed-market branch would have had to synthesize fake inputs for machinery that serves no purpose
when no entry can happen at all. The mixed-tape sub-check, in contrast, is pure desk/confluence math
with no session-state dependency, so factoring it out once and calling it from both places is the
narrower, more honest fix.

Surfaced the result in `gates.warnings`, not `gates.blocks`: "Session closed" already fully explains
why no new entry is possible, so the mixed-tape read isn't an ADDITIONAL reason entry is blocked —
it's the same informational-only treatment `evaluatePlayGates` itself gives this check on its
non-buy (`entry_intent: "watch"`) path, which is the closer analogue here since no BUY is ever being
evaluated once the market is closed. This also matches the task's own preference for the fix that
"keeps `mixed_tape_blocked` meaningful" over silently suppressing it — the information is cheap and
correct, so it's surfaced rather than thrown away.

### Tests

`src/features/spx/lib/spx-play-context.test.ts` (1 new test, 6/6 total),
`src/features/spx/lib/spx-play-engine.test.ts` (1 new test, 7/7 total). Full suite:
`src/features/spx/lib/spx-play-context.test.ts`, `spx-play-engine.test.ts`, `spx-play-gates.test.ts`,
`spx-play-gates-gex-age-future.test.ts`, `spx-play-gates-playbook-allowlist.test.ts` together:
47/47 pass. `npx tsc --noEmit` clean repo-wide.
