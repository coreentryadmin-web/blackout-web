## closedDeckSourcesFromChains: `trimEnforcedBeforeClose` still leaked the terminal leg's own value onto the worst leg's card (6th site of the same bug class) — FIXED

> **kind:** `FINDING`

**Status:** Fixed, regression tests added (`src/lib/swing/closed-plays.test.ts`).
**Severity:** P3 — latent, not yet confirmed as a live wrong boolean (see Evidence), same
wiring-gap class as five already-fixed sibling fields.

### Root cause

`closedDeckSourcesFromChains()` (`src/lib/swing/closed-plays.ts`) builds the CLOSED-tab/Ask Largo
card for a multi-leg swing roll chain. When the chain's WORST-performing leg is not the same leg
as its TERMINAL (last) leg, the card must show the **worst leg's own** contract/price/outcome (the
"preserved-loss invariant" — `record.ts`), not the terminal leg's. Five prior fixes already
re-pointed one field (or field group) each at the worst leg's own row (`worstLegRow`) instead of
the terminal leg's (`src`, from `closedDeckSourceFromRow(terminal)`):

- **2026-10-11** — `contract` identity (strike/right/expiry/occ)
- **2026-10-18** — `contract.mid`/`contract.delta` (the quote, not just identity)
- **2026-10-21** — `entryPremium`/`peakPremium`/`troughPremium`
- **2026-10-22** — `positionId`
- **2026-10-31** — `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`/`exitAt`/`committedAt`/
  `firstSeenAt`

Each fix comment independently re-discovered the same root cause: the initial `...src` spread at
the top of the pushed object carries the TERMINAL leg's values for every field, and whoever wrote
the override object after it only re-pointed the specific field(s) they were fixing that day.

This fix is the 6th site of the identical class: `trimEnforcedBeforeClose` was the one remaining
field still surviving unconditionally from that `...src` spread — i.e. always the TERMINAL leg's
own `scale_out_grade.trim_enforced_before_close` (persisted at grade time by `gradeSwingPosition`,
`src/lib/db.ts`, from that row's own pre-update status) — never re-pointed at the worst leg's row.
`trim_enforced_before_close` is a real per-row column on `swing_positions`, the exact same class as
`entry_premium`/`contract_delta`/`closed_at` already borrowed from the worst leg by the five prior
fixes — there was never a "no per-leg equivalent" gap here either.

### Evidence

This was found by code audit (reading `closedDeckSourcesFromChains` end to end and checking every
field in the pushed object against the `...src` spread) rather than reproduced against a live
wrong boolean on `GET /api/market/swing/record`: no live roll-chain was found this cycle where (a)
the worst leg differs from the terminal leg AND (b) the two legs' own `trim_enforced_before_close`
values actually differ — the specific combination needed to observe a visibly wrong value in
production right now. That absence of a live repro does not make the wiring defect any less real:
it is mechanically identical to the five already-fixed sibling fields, all of which were found and
fixed the same way (reading the code, not waiting for a live symptom) before most of them had a
confirmed live repro of their own. Disclosed honestly rather than claimed as a live-reproduced bug.

Two real consumers pair this field with other already-worst-leg-sourced fields on the exact same
served card, so a future divergence (once a live case with differing per-leg trim history appears)
would be a real, checkable, cross-leg contradiction, not just an unused data gap:

1. `terminalPlayFromClosedSwing`'s exit-ladder "fired" gate
   (`src/features/nighthawk/command-deck/adapters.ts:1022`): `status === "TRIM" ||
   src.trimEnforcedBeforeClose === true`. For a CLOSED row this card's `status` is always
   CLOSED/ROLLED (never TRIM), so the gate collapses to `trimEnforcedBeforeClose === true` alone —
   which, pre-fix, always read the terminal leg's own trim history on a worst-leg != terminal-leg
   chain, not the worst leg's whose contract/P&L/reason the rest of the card already describes.
2. The CLOSED-bucket "TARGET" badge (`src/features/nighthawk/command-deck/play-card-lifecycle.ts:
   328-329`): `play.trimEnforcedBeforeClose === true ? { label: "TARGET", tone: "closed" } : null`.
   Same leg-mismatch exposure — the badge would describe whether the TERMINAL leg's own trim ladder
   fired, not whether the leg whose `closedReason`/`exitPnlPct` the card is actually showing ever
   trimmed.

### Blast radius

Single function, single call site (`closedDeckSourcesFromChains`, the chain-composite path used by
`GET /api/market/swing/record`'s closed deck and Ask Largo's closed-play briefs). The single-leg
mapper `closedDeckSourceFromRow` is unaffected — it already sources everything from one row by
construction (`trimEnforcedBeforeCloseFromScaleOutGrade(row.scale_out_grade)`, line 272), no
mismatch possible there. `terminalPlayFromClosedSwing` (adapters.ts) forwards
`trimEnforcedBeforeClose` straight through onto `TerminalPlay` with no transformation (two call
sites, `adapters.ts:1231` and `:1584`), so both the exit-ladder "fired" gate and the CLOSED-bucket
TARGET badge inherit the fix automatically, as does `mechanismConfirmed` in
`src/lib/swing/play-brief-intel.ts:2720` (Ask Largo's own lessons-section narration of whether the
ladder mechanism actually fired, not just whether the play happened to close at a profit).

### Fix

Added `worstLegTrimEnforcedBeforeClose`, read via the existing
`trimEnforcedBeforeCloseFromScaleOutGrade` parser off `worstLegRow.scale_out_grade` (`null` exactly
when the worst leg IS the terminal leg, the same `worstLegRow` every prior fix already resolves),
and wired it into the override object with the same `worstLegIsTerminal ? src.X : worstLegX` gate
every sibling field already uses — no new branch invented, same pattern copied exactly:

```ts
const worstLegTrimEnforcedBeforeClose = worstLegRow
  ? trimEnforcedBeforeCloseFromScaleOutGrade(worstLegRow.scale_out_grade)
  : null;
// ...
trimEnforcedBeforeClose: worstLegIsTerminal ? src.trimEnforcedBeforeClose : worstLegTrimEnforcedBeforeClose,
```

Reuses the file's existing honest-absence contract: `trimEnforcedBeforeCloseFromScaleOutGrade`
already returns `null` (never a fabricated `false`) when a row predates the field, and that same
honesty now holds for the worst leg specifically, not just the terminal leg.

### Verify

- New tests in `src/lib/swing/closed-plays.test.ts`:
  - `"borrows the WORST leg's own trimEnforcedBeforeClose, not the terminal leg's — mismatched-leg
    trim history"` — RED pre-fix (asserted `true`, got the terminal leg's own `false` via the
    unconditional `...src` spread), GREEN after restoring the fix. Proved by temporarily reverting
    only the `trimEnforcedBeforeClose` line in the pushed object (not the test) and re-running.
  - `"falls back to the terminal leg's own trimEnforcedBeforeClose when the worst leg IS the
    terminal leg (no mismatch to fix)"` — the no-roll-mismatch case stays unchanged.
  - `"is honestly null when the worst leg's own scale_out_grade predates this field, never a
    fabricated false borrowed from the terminal leg"` — RED pre-fix (asserted `null`, got the
    terminal leg's own `true`), GREEN after restoring the fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/closed-plays.test.ts` — 37/37
  green (2 of the 3 new tests fail pre-fix, confirming the RED→GREEN proof).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/closed-plays.test.ts
  src/features/nighthawk/command-deck/adapters.test.ts
  src/features/nighthawk/command-deck/play-card-lifecycle.test.ts
  src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts` — 809/809 green, no
  regressions in consumers.
- `npx tsc --noEmit` (Node 20.20.2) — clean.
