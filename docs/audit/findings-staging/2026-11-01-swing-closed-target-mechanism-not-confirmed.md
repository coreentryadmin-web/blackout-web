> **kind:** FINDING

## Night Hawk Swings CLOSED-bucket 'target'/TARGET label asserted a mechanical ladder exit that was never confirmed to have happened — FIXED

**Status:** Fixed, regression tests added (`adapters.test.ts`, `play-card-lifecycle.test.ts`,
`play-brief-intel.test.ts`).

### Root cause

`closedReasonFromRow` (`src/lib/swing/closed-plays.ts`) derives the `target`/`stopped`/`flat`
`closedReason` label purely from the SIGN of `realized_pnl_pct` — it has no reference at all to
whether the swing scale-out ladder (`SWING_SCALE_OUT_POLICY`, a single trim rung armed at +100%
premium gain, `exit-policy.ts`) ever actually triggered. A manual close, a time-stop, or a
thesis-break exit taken while still green all land on `closedReason === "target"` identically to a
genuine ladder/target-rail exit.

`trimEnforcedBeforeClose` (`closed-plays.ts`'s `trimEnforcedBeforeCloseFromScaleOutGrade`, frozen
at grade time into `scale_out_grade`) is the one fact that actually distinguishes the two cases —
but it was never readable from the object the brief and the Command Deck actually render.
`terminalPlayFromHorizon` (`adapters.ts`) read `src.trimEnforcedBeforeClose` to compute
`exitPolicy.trim_levels[].fired` (an existing 2026-10-07 fix), but never copied the raw boolean
onto the `TerminalPlay` it returns, and `TerminalPlay` (`types.ts`) never declared the field at
all. So every downstream consumer that needed the FACT itself — not just that one `exitPolicy`
side-effect — read `undefined` regardless of what was actually recorded, which meant two
consumers could not even gate on it:

- `swingActionDisplay`'s CLOSED branch (`play-card-lifecycle.ts`) mapped
  `closedReason === "target"` straight to a `{ label: "TARGET" }` pill unconditionally — this pill
  feeds the Command Deck chip AND, via `swingVerdictVerb`, the Ask Largo play-brief's headline and
  Verdict-section opening line (`play-brief.ts`).
- `lessonsSection` (`play-brief-intel.ts`) narrated `closedReason === "target"` as either
  "Mechanical exit fired as designed — thesis or ladder did its job." or "Exit mechanism fired
  correctly, but the ladder banked little of the peak..." — both phrasings unconditionally assert
  the programmed trim/target mechanism actually executed.

Live repro (production data, authenticated): `GET /api/market/swing/record`'s `closedDeck`,
positionId 67 (PANW 370C, expiry 2026-10-30) — `entryPremium` 17.70, `peakPremium` 34.73 (peak
+96.2%, i.e. the premium never crossed the ladder's own +100% trigger, so the single trim rung
could never have armed), `exitPnlPct` +10.03%, `closedReason` "target", and explicitly
`trimEnforcedBeforeClose: false` on the SAME record. `GET /api/market/swing/play-brief?playId=
SWING:PANW&positionId=67&status=CLOSED` for this exact position showed the headline
'TARGET — PANW 370C 1DTE' and the Lessons section's 'Exit mechanism fired correctly, but the
ladder banked little of the peak...' — both asserting a mechanical ladder exit the position's own
`trimEnforcedBeforeClose: false` and peak-below-trigger history prove did not happen.

The sibling 'stopped' branch already uses appropriately hedged language ("Stop loss — check if
invalidation level was respected...") rather than an unconditional assertion — 'target' was the
one branch that overreached. This is the identical mislabeling class already recognized and fixed
for the sibling OPEN/HOLD command-deck TRIM badge (`swingActionDisplay`, 2026-09-18 fix, live
repro CRWD #39: "showed 'TRIM 100%'... read by a trader as 'the +100% trigger just fired,' when
nothing had" — fixed there by gating the ladder citation on real provenance).

### Evidence

- Confirmed `TerminalPlay` (`types.ts`) never declared `trimEnforcedBeforeClose`, and
  `terminalPlayFromHorizon`'s return object (`adapters.ts`) never forwarded it, by reading both
  files directly — the existing 2026-10-07 regression test (`adapters.test.ts`) only asserted the
  `exitPolicy.trim_levels[].fired` side-effect, never the raw field on the returned object, which
  is why this silent drop survived undetected.
- **RED (pre-fix, via `git stash` on the 4 source files only, keeping the extended test files):**
  - `adapters.test.ts`: 159/160 pass, 1 fail — `closedNeverTrimmed.trimEnforcedBeforeClose` read
    `undefined`, expected `false`.
  - `play-card-lifecycle.test.ts`: 56/57 pass, 1 fail — TARGET pill rendered unconditionally
    instead of falling back to the generic CLOSED pill when `trimEnforcedBeforeClose` is
    false/null.
  - `play-brief-intel.test.ts`: 345/346 pass, 1 fail — "Mechanical exit fired as designed" line
    rendered even when the mechanism was not confirmed.
- **GREEN (fix restored):** all three files combined, 563/563 pass (0 fail).
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` (`node scripts/run-tests.mjs`, Node 20) run clean — see PR for the exact pass
  count on this sandbox's documented Node-20 baseline.

### Blast radius

- `src/features/nighthawk/command-deck/types.ts` — `TerminalPlay` gained the
  `trimEnforcedBeforeClose?: boolean | null` field (additive; every other consumer of this type is
  unaffected since the field is optional).
- `src/features/nighthawk/command-deck/adapters.ts` — `terminalPlayFromHorizon` now forwards
  `src.trimEnforcedBeforeClose ?? null` onto the returned `TerminalPlay`, the same honest-absence
  rule the existing `exitPolicy` gating already applies.
- `src/features/nighthawk/command-deck/play-card-lifecycle.ts` — `swingActionDisplay`'s CLOSED
  branch only returns the `TARGET` pill when `trimEnforcedBeforeClose === true`; otherwise it
  falls through to `null`, letting the caller's existing fallback chain
  (`legacyActionDisplay ?? swingActionDisplay ?? zeroDteActionDisplay ?? playStatusDisplay`) render
  the honest generic `CLOSED` pill (`PlayLifecycleCard.tsx`). This same function feeds the Ask
  Largo play-brief's headline/Verdict-line/`thesis` field via `swingVerdictVerb`
  (`play-brief.ts`), so those three surfaces are corrected by this one change too.
- `src/lib/swing/play-brief-intel.ts` — `lessonsSection`'s `target`/`ratchet` branch now only
  asserts "Mechanical exit fired as designed..." / "Exit mechanism fired correctly..." when
  `trimEnforcedBeforeClose === true`; otherwise it degrades to an honest, non-mechanistic
  phrasing ("Closed positive, but the scale-out ladder's own +100% trigger is not confirmed to
  have fired — review how this actually exited...").
- `play-brief-narrative.ts`'s two other `swingActionDisplay` call sites (`actionNarrative`,
  `degradedReadLine`) were checked and are NOT affected — both explicitly return `null` for
  `bucket === "closed"` before ever reaching the CLOSED branch, so this fix's narrowing of the
  CLOSED/`target` case cannot change their output.
- `play-brief.ts`'s `closedSection` "Reason: **target**" line was checked and deliberately left
  unchanged — see below.

### Fix rationale

The root problem was two-layered: (1) the frozen `trimEnforcedBeforeClose` fact existed in the DB
and was correctly computed at `closedDeckSourceFromRow`, but never reached the `TerminalPlay`
object every brief/UI consumer actually reads, and (2) even once reachable, two call sites treated
`closedReason === "target"` as proof of a mechanical exit with no cross-check against that fact.
Fixed both: threaded the field through to `TerminalPlay` (mirroring the exact pattern
`entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` already use), then gated every "the
ladder/mechanism fired" claim on it, degrading to an honest alternative phrasing rather than
silently omitting the outcome — the member should still see that the position closed positive, with
nothing fabricated about why.

Mirrors the exact discipline the 2026-09-18 CRWD fix already established for the OPEN-bucket TRIM
badge (only cite the ladder's specific trigger when evidence confirms it is the actual source,
never fabricate a mechanism from a correlated-but-insufficient signal).

### Deliberately left unchanged

- `closedReasonFromRow` itself (`closed-plays.ts`) — the P&L-sign-based `target`/`stopped`/`flat`
  label is itself reasonable (it answers "did this close positive," which is a real and useful
  fact); the bug was downstream code treating that label as proof of a specific mechanism, not the
  label's own derivation.
- The `stopped`/`flat` branches in both `swingActionDisplay` and `lessonsSection` — out of scope
  for this finding, which is specifically about the `target` branch's mechanism claim (the
  sibling `stopped` branch already uses hedged, non-assertive language: "Stop loss — check if
  invalidation level was respected...").
- `play-brief.ts`'s `closedSection` "Reason: **target**" line — this literally echoes the
  recorded `closedReason` enum value (same as it does for `flat`/`stopped`), a true statement
  about what the DB field contains, not an independent claim that a mechanism fired. The
  overreaching claims were the pill/headline/Lessons prose, all of which are now corrected.
