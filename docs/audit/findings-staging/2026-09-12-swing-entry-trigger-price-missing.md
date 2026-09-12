> **kind:** FINDING

## Ask Largo swing play-brief never surfaced the actual entry-trigger price, only a "flag anchor" easily mistaken for it — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — Ask Largo play-brief (WATCH lane) |
| **File** | `src/lib/horizon-plays.ts`, `src/lib/swing/serving-ingest.ts`, `src/lib/swing/serving-lane.ts`, `src/lib/swing/play-brief-resolve.ts`, `src/features/nighthawk/command-deck/{types,adapters}.ts`, `src/lib/swing/play-brief-intel.ts` |
| **Status** | FIXED (this PR) |

### Root cause

Found live, in a real conversation: an operator asked which price to watch for a WATCH-lane entry
and reasonably read the brief's **"Flag anchor: 175.87 — track move from here"** as the actionable
breakout level. It is not. `flagUnderlyingPx` (`serving-lane.ts`'s `enrichPlay`, own comment: "pinned
first-flag price only — never the live scan spot") is the underlying price *when the thesis was
first flagged* — a historical reference for "how far has this moved since discovery", not the level
that flips the setup from PRE_TRIGGER/FORMING to AT_TRIGGER/TRIGGERED.

That real trigger level (`setup-state.ts`'s `SetupStateReads.triggerPx`, own doc comment: "The entry
trigger level (breakout / reclaim / pivot the thesis fires on)" — sourced from
`dossier.plan.entryUnderlyingPx` in `serving-ingest.ts`'s `swingServingReadsFromPlan`) **was computed
server-side for every WATCH row already** (it drives `deriveSetupState`/`deriveEntryPlan`, which is
how the brief decides to show PRE_TRIGGER vs. AT_TRIGGER vs. EXTENDED in the first place) but was
never threaded through to `HorizonPlay` → `TerminalPlay` → the play-brief text. A member had no way
to see the actual number the system itself was already computing and gating on — only the derived
category label (PRE_TRIGGER) and the unrelated flag-anchor reference.

The two values are not always close either: the flag anchor is pinned at first-flag time and never
moves, while the entry trigger tracks the dossier's current plan and can shift on a later scan
refresh — confirmed live on COIN (flag anchor $175.87 vs. spot essentially there, but the real
resistance/trigger structure sat up near the $182.50 call wall, a genuinely different number).

### Fix

Purely additive threading of an already-computed value, no new computation:
- `HorizonPlay.entryTriggerUnderlyingPx` (new field, `horizon-plays.ts`)
- `SwingServingMeta.entryTriggerUnderlyingPx`, set from `reads.setup.triggerPx ?? reads.entry.triggerPx`
  in `swingServingMetaFromDossier` (`serving-ingest.ts`)
- `enrichPlay` (`serving-lane.ts`) stamps it onto the produced `HorizonPlay`
- `horizonRowToDeckSource` (`play-brief-resolve.ts`) → `HorizonDeckSource.entryTriggerUnderlyingPx`
  (`adapters.ts`) → `TerminalPlay.entryTriggerUnderlyingPx` (`types.ts`)
- `watchForSection` (`play-brief-intel.ts`) renders it right after "Flag anchor," direction-aware
  ("Break/reclaim above" for LONG, "below" for SHORT), only in the `watch` bucket, only when present
  (never fabricated — a WATCH row with no grounded plan read simply omits the line, same honesty
  discipline every other field in this pipeline already follows).

### Blast radius

Additive only — every existing field/section is untouched. `flagUnderlyingPx`'s own line, wording,
and every other consumer of `HorizonPlay`/`TerminalPlay` (0DTE, LEAPS, the command-deck UI's other
panels) ignore the new optional field exactly like every other Swing-only enrichment field already
on those types.

### Fix rationale

The value already existed and was already load-bearing for the PRE_TRIGGER/AT_TRIGGER/EXTENDED
classification shown to members — this fix surfaces the number behind a category label members
already see, rather than computing anything new or changing any gating/verdict logic.

### Evidence of testing

New tests in `play-brief-intel.test.ts` (3): entry trigger shown distinctly from flag anchor with
correct direction-aware phrasing (LONG), phrasing mirrors for SHORT, and the line is both omitted
when null and never shown outside the `watch` bucket (never fabricated). RED→GREEN proven via
`git stash` (2 of 3 new tests fail without the fix — the third, testing absence, correctly holds
either way). Full `play-brief-intel.test.ts` (91 tests) and the touched pipeline's own test files
(`serving-lane.test.ts`, `serving-ingest.test.ts`, `play-brief-resolve.test.ts` — 193 tests combined)
all pass, no regressions. `npx tsc --noEmit`: clean. Full `npm test` (Node 20): run alongside this fix.
