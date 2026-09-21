> **kind:** FINDING

## Ask Largo — swing "Thesis health" section permanently withheld for committed positions because the entry-geometry pillar was never live-derived (only its sibling, persistence, was) — FIXED

| | |
|---|---|
| **Area** | `src/features/nighthawk/command-deck/adapters.ts`, `src/lib/swing/entry-model.ts` |
| **Status** | FIXED |
| **Severity** | P2 — Largo product-contract absence/precision issue (a real, computable pillar was withheld member-facing as "Inputs not wired", every cycle, for every committed swing position); no wrong-direction risk |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`) live deep-dive against `GET /api/market/swing/play-brief` for 3 fresh tickers (HOOD, SNOW, SMCI) not previously checked this session |

### Root cause

`computeSwingThesisHealth` (`src/lib/swing/thesis-health.ts`) scores five pillars — persistence,
entry geometry, flow corroboration, regime, theta budget — and `thesisHealthUncalibrated()` withholds
the WHOLE aggregate score (member sees only "Inputs not wired for committed positions — aggregate
score withheld; pillar breakdown not shown.") if **any single pillar** is still sitting on its generic
default label. It is an OR across pillars, not a per-pillar gate.

A prior fix (comment dated 2026-09-20, `adapters.ts` around `liveSetupState`) already closed this gap
for the **persistence** pillar: `src.setupState` is structurally `null` for every committed SWING
position (the WATCH-lane dossier state never survives the WATCH→COMMIT transition — `live-plays.ts`'s
`livePlaysFromOpenPositions` never sets it), so `liveSetupState` now re-derives it live via
`deriveSetupState(direction, {price: liveSpot, triggerPx: entryTriggerUnderlyingPx, invalidationPx})`.
`flow_corroboration` (signalKinds) was independently fixed by reading `entry_context.signal_kinds`
back off the commit row.

**But the exact same structural gap exists for `entry_geometry` (`src.entryStatus`), and nothing had
fixed it.** `HorizonPlay` literals built from committed rows in `live-plays.ts` never set
`entryStatus` at all — not even to `null`, it is simply absent from the returned object — so
`entryGeometryScore(undefined)` in `thesis-health.ts` always falls through to its `"n/a"` default
label. Because `thesisHealthUncalibrated()` ORs across all five pillars, this ONE unfixed pillar was
enough to keep tripping the whole withheld-aggregate path on every single committed swing
position, regardless of how complete the other four pillars' inputs were.

Live-verified 2026-09-21 against production (`GET /api/market/swing/play-brief`, temp Clerk session):
**every** committed swing position checked this cycle — HOOD, SNOW, SMCI, and the previously-known
CRWD — showed the same withheld "Thesis health" section, even though setupState and signalKinds are
both wired today. The persistence-pillar fix landed correctly but never actually restored the
feature it was aimed at, because its OR-gated sibling was still permanently defaulted.

### Evidence

RED→GREEN regression added to `src/features/nighthawk/command-deck/adapters.test.ts`:
- **RED (pre-fix, confirmed via `git stash` on the two source files):** a committed-row fixture with
  real `liveSpot`/`entryTriggerUnderlyingPx` (the same two legs the persistence fix already uses)
  still produced `entryGeometry.currentLabel === "n/a"` — the uncalibrated default — instead of a real
  derived state.
- **GREEN (post-fix):** the same fixture now derives `"at trigger"` from live price-vs-trigger
  geometry; a second test confirms the fallback (no `liveSpot`/`entryTriggerUnderlyingPx`) still
  correctly reads `"n/a"` — no regression to the honest-absence case.

### Fix

`src/lib/swing/entry-model.ts`: exported the previously-module-private `deriveEntryState(dir, reads)`
— it already needed only `direction`/`price`/`triggerPx` (with `entryZoneFar`/`atr` optional and
gracefully degrading), the same two legs `deriveSetupState` already threads through for the sibling
persistence fix.

`src/features/nighthawk/command-deck/adapters.ts`: added `liveEntryStatus`, computed the same way
`liveSetupState` already is — `working && liveSpot != null && entryTriggerUnderlyingPx != null` gates
a live call to `deriveEntryState`, falling back to `src.entryStatus` (still structurally absent, but
kept as the honest no-op fallback) otherwise. Wired into `computeSwingThesisHealth`'s `entryStatus`
field in place of the always-undefined `src.entryStatus`.

### Blast radius

Single call site — `terminalPlayFromHorizon` in `adapters.ts` is the only place `computeSwingThesisHealth`
is invoked for a live/committed SWING row (the play-brief's own thesis-health section reads the SAME
`TerminalPlay.thesisHealth` this adapter produces, so the fix reaches the Ask Largo play-brief and the
live Command Deck panel identically, with no second implementation to fix). WATCH-lane call sites
(`swingEnterability`/`entryVerdict`, same file, ~lines 848/881) already read a REAL `src.entryStatus`
from the WATCH-lane dossier and were untouched — this fix only affects the `working` (OPEN/HOLD/TRIM)
branch.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/adapters.test.ts` — 150/150 pass (was 149/150 red pre-fix on the new test alone; full suite untouched otherwise).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-model.test.ts src/lib/swing/thesis-health.test.ts src/lib/swing/play-brief-narrative.test.ts src/lib/swing/play-brief-pillar-guard.test.ts src/lib/swing/play-brief-resolve.test.ts src/features/nighthawk/command-deck/terminal-display.test.ts` — 164/164 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` — run in background this cycle; see `docs/audit/RUN-LOG.md` for the pass/fail tail if not yet folded in at merge time.
