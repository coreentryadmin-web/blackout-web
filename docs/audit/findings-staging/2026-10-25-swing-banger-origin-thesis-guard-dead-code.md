## 2026-10-25 — [FINDING, P1 Largo/Swing] Banger-origin thesis-suppression guard became dead code after a later, unrelated fix nulled the field it checked — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED on `fix/swing-banger-origin-thesis-dead-guard` |
| **Found by** | Workflow-fanned Ask Largo live gap-hunt agent (Largo deep-dive mandate, CLAUDE.md "ASK LARGO × NIGHT HAWK SWINGS" section) |
| **Scope** | `src/features/nighthawk/command-deck/adapters.ts`, `src/lib/swing/play-brief-intel.ts` |

### Root cause

Two independent, individually-correct fixes landed weeks apart and silently defeated each other:

1. **2026-10-08** (`bangerOriginNoRealThesis`, play-brief-intel.ts) — suppresses the Ask Largo
   "What to watch"/"Trade manager read" thesis line entirely for a Banger-ledger-origin swing
   position (one with no real per-position dossier, just a mechanical Engine B price trigger — see
   `horizonPlayFromBangerPosition`'s own header in `banger-lane-merge.ts`). Checked
   `play.regime === BANGER_LEDGER_REGIME_LABEL` on the `TerminalPlay` the play-brief pipeline
   reads. A sibling guard, `reviewedIsBangerOrigin` (same file, `bookContextSection`'s
   `formatOverlapPosition` cross-engine labeling), checked the identical expression.

2. **2026-10-24** (BMNR live repro, `adapters.ts`) — fixed a *different* leak: `TerminalPlay.regime`
   itself used to forward the raw `BREAKOUT · BANGER` sentinel straight to the UI (rendered as a
   literal "Regime: BREAKOUT · BANGER" line in `PlayTerminal.tsx`'s play-detail panel and
   `SwingCockpitStrip.tsx`'s lane-level cockpit header). The fix was `regimeForDisplay = src.regime
   === BANGER_LEDGER_REGIME_LABEL ? null : (src.regime ?? null)`, correctly nulling the field for
   *display*.

Both fixes were correct in isolation and both were tested in isolation. Neither noticed that
`terminalPlayFromHorizon` (`adapters.ts`) is the SHARED adapter both consumers read from, and that
fix #2 nulls the exact field fix #1's two guards read — `regimeForDisplay` runs *before* the
`TerminalPlay` is returned, so by the time `play-brief-intel.ts` sees `play.regime`, it is always
`null` for a Banger-origin row. `null === BANGER_LEDGER_REGIME_LABEL` is always `false`, so:

- `bangerOriginNoRealThesis` is always `false` → the suppression at the thesis-line `if` never fires.
- `reviewedIsBangerOrigin` is always `false` → `formatOverlapPosition`'s same-ticker-Banger-pair
  "separate position" vs "cross-engine" distinction (the 2026-10-20 LABD/RNG fix) is defeated too.

Neither regression test caught this because both constructed a `TerminalPlay` fixture directly
with `regime: BANGER_LEDGER_REGIME_LABEL`, bypassing `terminalPlayFromHorizon` entirely — the real
adapter pipeline a live play-brief actually runs through was never exercised end-to-end by either
test suite.

### Evidence

Live GET `/api/market/swing/play-brief?playId=SWING:<ticker>:<id>` against production on
2026-10-25 for three independent, previously-unchecked Banger-origin OPEN/MANAGING positions
(`SWING:HAL:2113`, `SWING:CLF:2116`, `SWING:NET:2104`) all returned a "What to watch" section
containing the literal, self-contradictory line:

> Thesis **unknown** — Engine B scale-out — whole-market breakout

— declaring the thesis unknown, then immediately stating what reads as the explanatory reason,
directly beside a confidently-managed HOLD recommendation with specific dealer-posture/trim-ladder
coaching in the same brief. Per CLAUDE.md's own prior measurement ("78/81 of the live committed
Swing book is Banger-origin"), this affects the large majority of live OPEN-bucket swing
play-briefs, not an edge case.

### Fix

Added a new, stable `TerminalPlay.bangerOrigin?: boolean` field, computed once in
`terminalPlayFromHorizon` from the raw `src.regime === BANGER_LEDGER_REGIME_LABEL` check — BEFORE
`regimeForDisplay` nulls the display-facing `regime` field — and exposed alongside it. Both
`bangerOriginNoRealThesis` and `reviewedIsBangerOrigin` now read `play.bangerOrigin === true`
instead of the already-nulled `play.regime`.

### Blast radius

Both consumers of the defeated sentinel check in `play-brief-intel.ts` are fixed by the same field:
the thesis-line suppression (`watchForSection`) and the cross-engine book-context labeling
(`bookContextSection`'s `formatOverlapPosition`, via `reviewedIsBangerOrigin`). No other consumer
of `BANGER_LEDGER_REGIME_LABEL` was affected — `thesisHealthUncalibrated` (thesis-health.ts) and
`computeSwingThesisHealth`'s own regime pillar read the RAW `src.regime` directly (adapters.ts
passes `regime: src.regime` unchanged into that call), never the nulled `TerminalPlay.regime`, so
they were never broken by the 2026-10-24 fix and needed no change. The `whyThisSetupSection`
defense-in-depth check (`if (play.regime && play.regime !== BANGER_LEDGER_REGIME_LABEL)`) also
needed no change — it degrades gracefully to "regime is falsy, don't render" once `regime` is
nulled, which is the correct outcome either way.

### Regression tests

- `adapters.test.ts`: extended the two existing Banger-origin adapter tests to also assert
  `TerminalPlay.bangerOrigin` is `true` for a Banger row and not `true` for a native row.
- `adapters.test.ts`: added a new end-to-end test chaining the REAL `terminalPlayFromHorizon` output
  into the REAL `watchForSection` — the exact pipeline shape a live play-brief runs, which the
  original bug's own regression tests never exercised. Confirmed RED (reproduces the live
  "Thesis **unknown** — Engine B scale-out — whole-market breakout" text byte-for-byte) against the
  pre-fix `bangerOriginNoRealThesis` check, GREEN after the fix.
- `play-brief-intel.test.ts`: the three existing fixtures that used to simulate Banger origin via
  `regime: BANGER_LEDGER_REGIME_LABEL` directly (a combination the real adapter can no longer ever
  produce post-fix) now use `bangerOrigin: true`, matching what `terminalPlayFromHorizon` actually
  emits.
