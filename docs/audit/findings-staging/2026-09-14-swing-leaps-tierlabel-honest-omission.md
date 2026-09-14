> **kind:** FINDING

## Swing/LEAPS `tierLabel` computed and displayed a letter grade this codebase's own comments already document as empirically inverted — fix/swing-leaps-tierlabel-honest-omission — 2026-09-14

| **Status** | FIXED |
|---|---|

**Credit:** cross-lane finding — reported (not fixed) by the Night Hawk Legacy audit lane (PR #4950, held as out-of-scope for that lane) while finishing an unrelated `scorer.ts`/`conviction.ts` review. Verified and fixed here as the Night Hawk Swings owner.

### What was broken

`terminalPlayFromHorizon` (`src/features/nighthawk/command-deck/adapters.ts`) unconditionally set `tierLabel: convictionFromScore(Math.round(src.score))` for every SWING/LEAPS play — `HorizonDeckSource` carries no pinned tier/conviction field at all, unlike the 0DTE and Legacy adapters in the same file, which both correctly source `tierLabel` from a real pinned tier (`src.tier?.tier` / `src.tier?.tier ?? src.conviction`).

`convictionFromScore` (`>=70` → `A+`, `>=55` → `A`, `>=40` → `B`, else `C`) is the *exact* function `nighthawk-tiers.ts`'s own header comment already documents as the root cause of a measured, empirical inversion on the product it was calibrated for:

```
A+ (>=70): 0 wins / 1 loss
A  (55-69): avg -0.55%
B  (40-54): avg +2.99% — the best performer
```

i.e. it labels the worst-performing score band as the best grade. `assignNighthawkTier` was built specifically to replace it and deliberately excludes `"A+"` from its own assignable type — but that replacement was never wired into the SWING/LEAPS path, which kept calling the old, disproven mapping.

This was never validated for swing's own, differently-shaped score distribution either — and swing's own calibration tooling (`scripts/audit/swing-score-calibration.mjs`, PR #4716, first live run, 31-chain closed population) independently found swing's score is *also* not a reliable outcome ranker ("SPREAD WITHOUT ORDER" — the middle score band 49-57 outperformed every high band 60-86).

**Blast radius — the adapter was only half the picture.** Two display-layer functions (`playGradeLabel` in `play-card-display.ts`, `convictionDisplay` in `terminal-display.ts`) both carried their own SWING/LEAPS-gated fallback to `convictionFromScore(play.score)` whenever `tierLabel` came back empty. Before this fix, `tierLabel` was *never* empty for a `terminalPlayFromHorizon`-sourced play, so these fallbacks never fired — but fixing only the adapter (`tierLabel: null`) would have made them fire for the *first* time, silently re-deriving the identical bad grade at render time and completely undoing the adapter fix. Both fallbacks were removed, not just gated, since there is no swing-calibrated tier engine to fall back to yet.

### What changed

- `adapters.ts`: `terminalPlayFromHorizon` now sets `tierLabel: null` for SWING/LEAPS instead of computing it from `convictionFromScore`. Honest omission is an already-tested, already-supported state (see the Legacy adapter's own "missing conviction → tierLabel null" test).
- `play-card-display.ts`: `playGradeLabel` no longer falls back to `convictionFromScore` for SWING/LEAPS — returns the pinned `tierLabel` or `null`.
- `terminal-display.ts`: `convictionDisplay` — same fallback removed.
- Unused `convictionFromScore` imports removed from all three files.

This is the same Largo product contract principle (`docs/audit/LARGO-PRODUCT-CONTRACT.md`, C6: "confidence must be omitted when a product cannot calibrate it") already governing the Ask Largo brief, applied to the Command Deck's own letter-grade display.

### Evidence

RED→GREEN regression (Node 20, `git stash` isolation): a new test in `adapters.test.ts` asserting `tierLabel === null` for SWING (score 92 and score 3) and LEAPS rows failed pre-fix (`'A+' !== null`) and passed post-fix. `swing-grade-display.test.ts`'s existing test (previously asserting the old fallback: `playGradeLabel(swingPlay({score:62})) === "A"`) updated to assert `null`; its sibling case with an explicit `tierLabel: "B"` is unaffected (pinned tier data always wins). New `terminal-display.test.ts` case covers `convictionDisplay` directly for both horizons. Full suite + `tsc --noEmit` clean.

### Blast radius (full)

- `adapters.ts` — `terminalPlayFromHorizon` (SWING/LEAPS only; 0DTE/Legacy adapters untouched, they already source from a real pinned tier).
- `play-card-display.ts` — `playGradeLabel`, used wherever the Command Deck's Grade column renders (all horizons, but the fallback branch only ever applied to SWING/LEAPS).
- `terminal-display.ts` — `convictionDisplay`, same scope.
- No change to `conviction.ts`/`convictionFromScore` itself (still used by 0DTE/Legacy paths, which have real calibration evidence behind their own bands, or at least aren't the subject of this specific documented inversion) or to `nighthawk-tiers.ts`.

### Why this fix, not building a new swing tier engine

The reporting PR (#4950) correctly identified this as a decision for the Swings lane: either wire in a swing-calibrated tier engine, or omit the label until one exists. Building a new tier engine needs real backtested evidence (score-band-vs-outcome, by archetype/sub-lane) that doesn't exist yet — `swing-score-calibration.mjs`'s first run found no clean ordering even in the score itself, so a hand-built letter-grade threshold on top of it would be fabricating the same class of false confidence this fix removes. Omission is the correct interim state per the Largo contract's own C6 principle; building real swing tier calibration is a separate, much larger follow-up (not scoped here).
