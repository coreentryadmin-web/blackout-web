## Ask Largo swing play-brief never warned before an automatic roll executes, despite the exact signal being computed every tick

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `managementSection` (`src/lib/swing/play-brief.ts`) |
| **Severity** | P3 (member-facing narrative gap — a real, live signal a member would want advance warning of was silently absent, not incorrect) |
| **Status** | FIXED — `fix/swing-roll-candidate-advisory` |

### Root cause

`manage.ts`'s `evaluateSwingManagement` always computes `dteMigration`/`rollIntent` — theta decaying
faster than thesis progress inside the lane's migration-DTE window, the exact pre-roll signal
`roll.ts`'s live executor itself acts on before auto-rolling a still-valid thesis into a fresh
contract. `manage-sync.ts` persists both fields into every snapshot's `event_json`
(`dte_migration`/`roll_intent`). But `live-plays.ts`'s `manageObservablesFromEvent` — the sole
reader of that event_json — only ever extracted `action`/`rung`/`thesis_state`, never these two
fields. A position already flagged as an active roll candidate gave a member zero advance warning;
the first they'd hear of it was after the fact, via the roll-history disclosure
(`play-brief-narrative.ts`'s `rollLine`, which only ever cites PAST, already-executed rolls). The
Command Deck has no UI for the live signal either (no reference anywhere in
`src/features/nighthawk`). Same wiring-gap shape as the already-shipped #5161 greeks fix and the
underlying FINDINGS 2026-08-06 SEV-3 pattern: data computed and persisted every tick, never read
back out.

### Evidence

Verified in source, not speculation:
- `src/lib/swing/manage-sync.ts:400-401`: `dte_migration: verdict.dteMigration` /
  `roll_intent: verdict.rollIntent` — both stamped into `event_json` every manage-sync tick.
- `src/lib/swing/manage-sync.ts`'s own header: "PR-15 ROLL WIRING... executes a roll" — confirms
  `roll.ts`'s executor is the live consumer of `rollIntent`, the same signal this fix surfaces.
- Pre-fix `manageObservablesFromEvent` (`live-plays.ts`): only read `action`/`rung`/`thesis_state`
  off the event blob — `dte_migration`/`roll_intent` were present in every snapshot and never
  extracted.
- `roll_intent.reason` carries a stale internal note ("(INTENT ONLY; execution deferred to
  PR-15)") from before PR-15 wired up live execution — confirmed this text is not member-facing
  clean, which is why the fix surfaces `dte_migration.reason`'s prose instead, gated on
  `roll_intent.roll === true` (the post-veto authoritative "yes").

### Blast radius

Single extraction site (`manageObservablesFromEvent` in `live-plays.ts`) threaded through the
existing `HorizonPlay` → `TerminalPlay` → play-brief pipeline (`horizon-plays.ts` →
`live-plays.ts` → `command-deck/adapters.ts`/`types.ts` → `play-brief-resolve.ts` →
`play-brief.ts`). No other call site reads this event data. Every OPEN swing position currently
inside its migration-DTE window with a genuine roll candidate was affected.

### Fix rationale

Threaded a new optional `rollCandidate: { reason: string } | null` field end-to-end, gated on
`roll_intent.roll === true` AND a real string `dte_migration.reason` — malformed/partial shapes
(an older snapshot predating this field, a manual DB edit) degrade to `null`, never a guessed or
fabricated candidate. `managementSection` in `play-brief.ts` adds a "Roll watch" line only when
`play.rollCandidate` is genuinely present — honest absence, matching the section's own existing
convention (no "no roll pending" filler line when there's nothing to report).

Deliberately reused `dte_migration.reason`'s prose rather than `roll_intent.reason` — the latter
still carries the stale pre-PR-15 internal note, which would have read as broken/confusing copy to
a member.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/live-plays.test.ts src/lib/swing/play-brief.test.ts`
  — 94/94 pass. RED→GREEN independently confirmed: reverted only the source fix (kept the 4 new
  tests) — 4/94 failed exactly as expected (the new roll-candidate cases), 90/94 unaffected.
  Reapplied the source fix — 94/94 pass, no other regression.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14605/14608 pass, 0 fail, 3 pre-existing skips.
