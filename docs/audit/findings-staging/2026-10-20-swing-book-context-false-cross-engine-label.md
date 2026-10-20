> **kind:** FINDING

## Swing play-brief — Book Context mislabels a same-ticker Banger/Banger pair as "cross-engine" — FIXED

| **Status** | Fixed (PR TBD) |
|---|---|

**Found:** 2026-10-20, Ask Largo standing deep-dive cycle (background workflow), targeting the Book
Context and Dealer/dark-pool read sections specifically — not yet audited this session's prior
cycles. Adversarially verified (independent refutation attempt, CONFIRMED real).

**Root cause:** `formatOverlapPosition` (`src/lib/swing/play-brief-intel.ts`) labels a same-ticker
sibling position `(separate, cross-engine position #N)` whenever that sibling lacks a `positionId`
— per `loadOpenBook`'s convention (`play-brief-context.ts`), a null `positionId` means the sibling
is Banger-origin. But the function never checked whether the **reviewed play itself** is also
Banger-origin. When both sides are Banger-origin, "cross-engine" is simply false — it's the same
engine (Banger) committing to the same ticker twice, not two independent systems both flagging it.

**Live impact:** reproduced on two independent ticker pairs in the same cycle:
- **LABD** positionId 1955's Book Context cited positionId 1761 as `"(separate, cross-engine
  position #1761)"`; positionId 1761's own brief symmetrically cited 1955 the same way. Both
  confirmed Banger-origin via `regime === BANGER_LEDGER_REGIME_LABEL` and each brief's own "Why
  this setup" text ("BANGER flagged this as a triggered breakout continuation setup").
- **RNG** positionId 1966 and 1902 — identical pattern, both `signalKinds: ['BANGER']`.

21 of 26 live committed Swing positions audited that cycle were Banger-origin, so same-ticker
Banger/Banger pairs are common, not an edge case. This matters because "cross-engine" reads as a
stronger, independently-corroborated signal (two separate systems both like this ticker) than
"same engine, same ticker, twice" (a narrower, single-source signal) — misrepresenting how
diversified the book's duplication actually is.

**Fix:** `formatOverlapPosition` now takes a `reviewedIsBangerOrigin` parameter (computed once in
`bookContextSection` as `play.regime === BANGER_LEDGER_REGIME_LABEL`) and only applies the
"cross-engine" wording when the sibling is Banger-origin AND the reviewed play is NOT — i.e. the
two sides genuinely differ in origin. When both sides are Banger, it falls back to the existing
"separate position #N" wording (same as the known-`positionId` case), which is accurate without
needing a new phrase.

**Blast radius:** single function, two call sites (both within `bookContextSection`, same-direction
and opposed-direction branches). No other caller of `formatOverlapPosition`.

**Test:** `src/lib/swing/play-brief-intel.test.ts` — new regression test for the Banger/Banger case
(CRWD fixture, `regime: BANGER_LEDGER_REGIME_LABEL`), plus a sibling no-regression test confirming
the cross-engine label still fires correctly for a swing-native reviewed play with a Banger
sibling. RED→GREEN proven via `git stash` on the production file alone; full
`play-brief-intel.test.ts` suite (274 tests) green.
