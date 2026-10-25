## Ask Largo swing play-brief: "entry trigger" level falsely inherits the flag anchor's pinned provenance once the two prices have diverged (live MSTR repro) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED (PR #TBD, this branch) |

### Root cause

`levelsFromContext()` (`src/lib/swing/play-brief.ts`, WATCH-bucket branch) builds ONE
`pinnedProvenance` object off `play.detectedAt` (the flag anchor's own pin moment) and stamped it
unconditionally onto BOTH structured `envelope.levels[]` entries it emits for a WATCH play: "flag
anchor" (correct — that price is genuinely pinned at `detectedAt` and never moves) and "entry
trigger" (incorrect once the two prices disagree).

`entryTriggerUnderlyingPx`'s own field doc (`src/lib/horizon-plays.ts`) states the mechanism
directly: it is "the CURRENT live level a break/reclaim of would flip PRE_TRIGGER/FORMING to
AT_TRIGGER/TRIGGERED ... the two [flag anchor and entry trigger] can diverge once a dossier
refreshes its plan on a later scan pass." `deriveSwingPlanLevels()`
(`src/lib/swing/structure-levels.ts`) sets `entryUnderlyingPx` to whatever price is current the
instant a plan is (re)built — it is recomputed on every dossier refresh, not pinned the way the
flag anchor is. So once a later scan rebuilds the dossier, `entryTriggerUnderlyingPx` moves away
from `flagUnderlyingPx`, but `levelsFromContext()` kept stamping the trigger level with the flag's
old `detectedAt`-derived asOf/freshness regardless — falsely claiming the (now-fresher) trigger
price was pinned at the same instant as the flag anchor.

This silently defeated the sibling staleness discriminator already living in the same product
surface: `entryTriggerDeadReason()`'s `legacyPinnedStale` (`src/lib/swing/play-brief-intel.ts`)
already uses the exact equality test `play.flagUnderlyingPx === play.entryTriggerUnderlyingPx` to
detect "is the entry trigger genuinely still pinned to the flag's moment" (scoped there to
Legacy-promoted rows specifically, since an organic row's trigger is only pinned-equal
*coincidentally*, on the very scan tick it was first flagged) — `levelsFromContext()` simply never
consulted that same equality signal when deciding what provenance to stamp.

### Evidence

Live MSTR WATCH play: `flagUnderlyingPx: 163.30`, `entryTriggerUnderlyingPx: 147.47` — two
genuinely different prices — yet both structured `envelope.levels[]` entries ("flag anchor" and
"entry trigger") carried byte-identical provenance, `asOf: "2026-10-21 09:15 ET"` / the same
`freshness` bucket, implying the entry-trigger price was pinned at the exact same instant as the
flag anchor. It was not: the divergence itself proves the trigger was recomputed on a later scan
pass, at an unrecorded later time.

### Fix

In `levelsFromContext()`, before pushing the "entry trigger" level, compute
`entryTriggerStillPinnedToFlag = play.flagUnderlyingPx != null && play.entryTriggerUnderlyingPx !=
null && play.flagUnderlyingPx === play.entryTriggerUnderlyingPx` — the same bare equality
`entryTriggerDeadReason`'s `legacyPinnedStale` already relies on, applied here without the
Legacy-only scoping (the equality itself, not the discovery origin, is what tells us whether the
dossier was rebuilt). When it holds, the entry-trigger level keeps reusing `pinnedProvenance`
exactly as before (unchanged behavior — a freshly-flagged or still-unrebuilt play still gets the
honest flag-anchor asOf/freshness). When it does not hold, the entry-trigger level instead gets
`{ source: "Swing lane", asOf: null, freshness: "unknown" }` — this file's existing honest-absence
convention (mirrors `gexFreshness`/`vectorFreshness` returning `"unknown"` when a reliable age
can't be established) — rather than fabricate a timestamp. There is no separate "dossier last
rebuilt" timestamp anywhere on `TerminalPlay`/`HorizonPlay` to stamp instead once diverged, so
`"unknown"` is the honest answer, not a placeholder pending a better one.

### Blast radius

`pinnedProvenance` has exactly two consumers in `levelsFromContext()` — the "flag anchor" push
(unchanged: it is the one level genuinely anchored to `detectedAt`) and the "entry trigger" push
(fixed here). No other call site in the repo stamps `entryTriggerUnderlyingPx` with
`pinnedProvenance`; `entryTriggerDeadReason`'s own `legacyPinnedStale` check (which this fix reuses
the equality shape of, not the function itself) is untouched — it governs the level's `note` text,
a separate, already-correct concern from its `provenance`.

### Tests

- `composeSwingPlayBrief: entry trigger reuses the flag anchor's pinned provenance when the price
  still matches it` (`play-brief.test.ts`) — new, asserts unchanged behavior for the
  still-genuinely-pinned case (equal prices).
- `composeSwingPlayBrief: entry trigger gets honest unknown provenance once its price has diverged
  from the flag anchor's (MSTR repro)` (`play-brief.test.ts`) — new, RED pre-fix (asserted
  `entryTrigger.provenance.asOf !== flagAnchor.provenance.asOf`, which failed because both were
  identical pre-fix), GREEN post-fix.
- Confirmed RED→GREEN via `git checkout -- src/lib/swing/play-brief.ts` (reverting only the source
  change, keeping the new tests) → 176/177 pass, 1 fail (the new diverged-price test, exact
  expected failure) → restored the fix → 177/177 pass.
- Full `play-brief.test.ts` (177 tests), `play-brief-intel.test.ts` + `entry-enterability.test.ts`
  (357 tests combined) re-run clean after the fix — no regression in any sibling consumer of
  `pinnedProvenance`, `entryTriggerDeadReason`, or the two pre-existing tests that already use
  divergent flag/trigger prices without asserting on `entryTrigger.provenance` (left unaffected by
  design, confirmed by inspection and by the clean re-run).
- `npx tsc --noEmit` clean.

### What was deliberately left unchanged

- `entryTriggerDeadReason()` itself (the `note` text / "this level no longer fires the setup"
  disclosure) — this finding is about `provenance` (asOf/freshness), a structurally separate field
  on the same `BieLevel` entry; `legacyPinnedStale`'s own Legacy-only scoping for that purpose is
  correct as-is and untouched.
- The "flag anchor" level's provenance — it is the one correctly-always-pinned level.
- No new shared equality helper was extracted — the fix inlines the same bare equality
  `legacyPinnedStale` already uses, per the finding's own instruction to reuse the exact
  condition rather than invent a new one; a shared export was judged out of scope for a surgical
  fix.
