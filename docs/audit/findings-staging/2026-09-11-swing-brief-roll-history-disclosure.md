> **kind:** FINDING

## Ask Largo swing play-brief never disclosed roll history — FIXED

**Status:** FIXED (`fix/swing-brief-roll-history-disclosure`)

### What was broken

`record.ts`'s chain composite has always had the full `roll_seq` thread available for a swing
position that has been rolled — the DB row (`swing_positions`) carries `root_position_id`/
`roll_seq` for exactly this purpose, and the play-brief resolve layer already threads chain
identity carefully (see PR #4801, "chain rolled twice" fix). But the deterministic play-brief
narrative (`src/lib/swing/play-brief-narrative.ts`'s `tradeManagerNarrativeSection`, "Trade
manager read") never mentioned a roll at all. A member reading the brief on a twice-rolled
position had no way to know from the brief text alone that the current contract wasn't the
original entry — a real, evidenced gap under the standing Ask Largo ownership mandate ("what is
missing" — noted explicitly in the prior coordinator cycle's context as a genuine gap, not yet
built).

### Fix

Additive, three-file change:

1. **`play-brief-types.ts`** — new `SwingRollHistory`/`SwingRollHistoryLeg` types and a
   `rollHistory?: SwingRollHistory | null` field on `SwingPlayBriefContext` (Largo C6 absence
   discipline: `null` for "never rolled" or "ledger read failed", never fabricated).
2. **`play-brief-context.ts`** — `loadRollHistory()` resolves the play's `positionId` (parsed out
   of `TerminalPlay.id`, which has no discrete `positionId` field — `terminalPlayFromHorizon` bakes
   it into the `id` string as `${horizon}:${ticker}:${positionId}`), looks up the row via
   `fetchSwingPositionById` to get its sticky `root_position_id`, then walks the full chain via
   `fetchSwingPositionChain(rootId)`. Never rolled (`chain.length < 2`) → `null` (nothing to
   disclose). Best-effort like the existing `archetypeTrackRecord` read — a DB hiccup degrades to
   "no roll history cited," never fails the whole brief.
3. **`play-brief-narrative.ts`** — new `rollHistoryLine()` cites ONLY the most recent roll (the
   last two legs — the full chain is `record.ts`'s own composite's concern, not something to
   unpack bullet-by-bullet here), wired into `tradeManagerNarrativeSection` for both the "open"
   and "closed" buckets. Only ever fires when `rollHistory.rollCount > 0`.

### Evidence

Regression tests added to `play-brief-narrative.test.ts`:
- never-rolled position → no "Rolled" line (Largo C6 omission).
- rolled-once (open bucket) → `**Rolled once** — most recently from the $100 call to the $110
  call on 2026-08-20.`
- rolled-twice (closed bucket) → `**Rolled 2 times** — most recently from the $95 put to the $100
  put on 2026-08-25.` and explicitly asserts the FIRST leg ($90) is NOT cited (only the latest
  roll, by design).

RED→GREEN proven by stashing the three source files and re-running the test file — the added
tests fail to type-check/fail against the pre-fix code (no `rollHistory` context field, no
`rollHistoryLine`), pass cleanly restored. Full suite + `tsc --noEmit` both clean post-fix.

### Blast radius

Only the three files above. No other call site reads `SwingPlayBriefContext.rollHistory` or
`positionIdFromPlayId` yet — additive, no existing behavior changed for a never-rolled position
(the overwhelming majority of live positions).

### Deliberately left unchanged

- Full chain P&L semantics (per-leg entry/exit) — already owned by `record.ts`'s composite;
  this narrative discloses WHAT was rolled, not how each leg graded.
- Only the LATEST roll is narrated even for a multi-roll chain — keeps the "Trade manager read"
  section a coaching read, not a ledger dump.
