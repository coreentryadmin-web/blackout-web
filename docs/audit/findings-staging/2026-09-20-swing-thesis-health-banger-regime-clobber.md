## Swing "Ask Largo" play-brief and the Command Deck board disagree about the same Banger-origin position's Thesis Health — a second, unguarded caller of `attachThesisExplanation` silently overwrites the honest `BANGER_LEDGER_REGIME_LABEL` sentinel — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/serving-lane.ts` (`attachThesisExplanation`), `src/lib/swing/thesis-health.ts` (`thesisHealthUncalibrated`), `src/lib/swing/banger-lane-merge.ts` (new shared `BANGER_LEDGER_REGIME_LABEL` export) |
| **Severity** | P2 — real member-facing cross-surface inconsistency in a Largo C6 (confidence-fabrication) omission gate, on live committed positions with real capital |

### Background

Flagged via PR #4076 comment 5751915312 (2026-09-20, 18:57 UTC): "Thesis health" was rendering a
byte-identical `84% · Minor drift` score across 19 of 36 structurally-identical Banger-promoted
swing positions (RIOT, MSTR, COIN, HOOD, IBIT, CRCL, IREN, BMNR, ETHA, MARA, BITO, AAOI, HUT, MUU,
APLD, CLSK, ETHU, LRCX all at 84%, SNXX at 74%), while the other 17 (BKKT, ABTC, GEMI, WOLF, ETHE,
BLSH, ETH, SBET, BULL, GLXY, GBTC, AMDL, MSTX, BTDR, MSTU, BITX, SOXL) correctly rendered the honest
omission ("Inputs not wired for committed positions — aggregate score withheld").

A follow-up comment (5751954861, 7 minutes later, same author) walked the severity back: traced the
arithmetic and found the 84% is NOT a hardcoded literal — `regimeScore()`'s `factorBoost` genuinely
caps at 0.2 once a real `factors[0].points` clears 20 (true for all these tickers, with different
underlying points), all 36 genuinely share `dte:5` (same Friday commit batch/expiry), and the
`Δ +0.0 pts` deltas are correct because the market was closed all weekend (Sunday, zero real drift).
Concluded "working as intended... nothing to fix here," with the one open question being *why*
19/36 get dossier enrichment and 17/36 don't (guessed: a liquidity/coverage split in native
discovery).

### What the correction missed — independently confirmed via a THIRD surface

Both prior comments only inspected the play-brief endpoint. Comparing the SAME positions against the
**canonical Command Deck board** (`GET /api/market/nighthawk/horizons?horizon=SWING`, which builds
its lane via `getSwingServingLane` — the code path `mergeBangerPositionsIntoSwingPlays` deliberately
runs banger rows through AFTER the native-only `attachThesisExplanation` enrichment pass, so banger
rows are NEVER enriched there by design) shows every one of RIOT/MSTR/COIN/HOOD/LRCX/BKKT/ABTC/BTDR
carrying the honest, untouched `regime: "BREAKOUT · BANGER"` sentinel — **including the 19 tickers
that showed a fabricated-looking 84% on the play-brief.** Live capture (2026-09-20, same scan
`asOf`):

```
BKKT | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
RIOT | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
COIN | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
HOOD | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
LRCX | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
MSTR | regime= BREAKOUT · BANGER | setupState= TRIGGERED | entryStatus= AT_TRIGGER
```

This is the real, narrower bug the walk-back's open question pointed at but didn't fully trace: the
SAME position must not show a different Thesis Health verdict depending on which route resolved it.
It does today, and the mechanism is deterministic, not a liquidity/coverage coincidence.

### Root cause

`src/lib/swing/play-brief-resolve.ts`'s `resolveSwingPlayForBrief` has a ticker-only lane fallback
(reached when no matching native `swing_positions` row exists for the ticker — true for a pure
Banger-ledger position) that calls:

```ts
const enriched = attachThesisExplanation(lanePlay, dossier, reads);
```

unconditionally, on whatever `pickLanePlayForBrief` selected — native or banger-origin, with no
distinction. `attachThesisExplanation` (`serving-lane.ts`) contained:

```ts
regime: meta.regime ?? play.regime,
```

`meta.regime` comes from `swingServingMetaFromDossier`, keyed on the SAME ticker's **current,
independent, ongoing swing discovery dossier** (`serving-ingest.ts`: `archetypeLabel + " · regime " +
regime01.toFixed(2)`) — a completely different thesis from the already-committed Banger position,
matched by ticker alone. Whenever that ticker also happens to still be actively re-screened by
native FLOW/STRUCTURE discovery that session (true for liquid large-caps like RIOT/MSTR/COIN, false
for the smaller/newer names), `meta.regime` is non-null and **wins** over `play.regime` — silently
overwriting `horizonPlayFromBangerPosition`'s deliberate `BANGER_LEDGER_REGIME_LABEL` sentinel
(`"BREAKOUT · BANGER"`) with the discovery dossier's own regime string. `thesisHealthUncalibrated()`
(`thesis-health.ts`) matches on that EXACT sentinel string to correctly withhold the aggregate score
for a banger-origin position (the 2026-09-15 fix this file's own comment describes); once the
sentinel is gone, the omission gate no longer fires, and `computeSwingThesisHealth` proceeds to
compute a real (not hardcoded) but still largely batch-shared aggregate — hence the byte-identical
84% across every ticker whose regime happened to get clobbered the same way from the same shared
`dte:5`/`setupState`/`entryStatus`/`signalKinds` ledger constants.

`getSwingServingLane` itself never has this problem: `mergeBangerPositionsIntoSwingPlays` runs
strictly AFTER the native-only `attachThesisExplanation` pass, so a banger row's sentinel is never
exposed to this overwrite there — which is exactly why the board and the play-brief disagreed.
`play-brief-resolve.ts`'s second call site is the one place that doesn't respect this ordering.

### Blast radius

Any consumer that reaches a banger-ledger `HorizonPlay` through `resolveSwingPlayForBrief`'s
ticker-only fallback (any pure-Banger position with no matching native `swing_positions` row) is
affected — this includes Ask Largo's play-brief tool (the reported symptom) and any other reader of
the same resolved `TerminalPlay`. `loadOpenTerminalPlay` (the OTHER caller of
`attachThesisExplanation` in this file, for native rows resolved by position id) is unaffected by
this bug — native plays start with `regime: null`, so there is no sentinel for it to clobber; that
call path is working exactly as designed and is unchanged by this fix.

### Fix

Exported the sentinel as `BANGER_LEDGER_REGIME_LABEL` from `banger-lane-merge.ts` (previously an
inline literal duplicated in two call sites there, and re-declared as a SEPARATE private constant in
`thesis-health.ts` — the exact kind of un-shared duplicate that let this drift happen unnoticed).
`thesis-health.ts` now imports it instead of re-declaring it. `attachThesisExplanation` now computes
`freshRegime = play.regime === BANGER_LEDGER_REGIME_LABEL ? null : meta.regime` and uses
`freshRegime ?? play.regime` everywhere it previously used `meta.regime ?? play.regime` — a banger
sentinel is never treated as replaceable by an unrelated, ticker-keyed discovery dossier, in EITHER
call site, so the board and the play-brief now agree by construction rather than by which caller
happened to still have the sentinel intact.

**Why this fix and not the alternative** (e.g. skipping `attachThesisExplanation` entirely in the
ticker-only lane fallback for banger-origin plays): the guard lives inside the shared function so
BOTH existing and any future callers get the same correct behavior automatically, rather than
requiring every caller to remember to special-case banger origin — the same discipline
`mergeBangerPositionsIntoSwingPlays`'s ordering already tried to encode structurally in
`getSwingServingLane`, just not enforced at the function itself, which is exactly the gap the second
caller fell into. `factors`/`sectorLeadershipFacts` enrichment is left untouched (not part of this
bug — `factorsValid` already prefers the position's own pinned factors, and banger's single
`[{label:"Discovery gain",...}]` factor already sums to its score, so it was never at risk here).

### Evidence

- Live cross-surface diff (above): identical positions, disagreeing Thesis Health between board and
  play-brief, both captured 2026-09-20 from the same scan.
- RED→GREEN regression test in `src/lib/swing/serving-lane.test.ts`
  ("`attachThesisExplanation` never overwrites a banger-ledger sentinel regime, even when a
  same-ticker dossier exists (Largo C6)"), git-stash-verified: fails pre-fix
  (`enriched.regime !== BANGER_LEDGER_REGIME_LABEL`), passes post-fix. A companion test confirms the
  guard is scoped ONLY to the sentinel — a native play with no prior regime still gets enriched
  normally.
- `npx tsc --noEmit` clean; `serving-lane.test.ts` + `thesis-health.test.ts` +
  `banger-lane-merge.test.ts` + `play-brief-resolve.test.ts` + `play-brief-narrative.test.ts` +
  `play-brief-pillar-guard.test.ts` all green (148 tests) after the fix.

### Corrective note for CLAUDE.md's Ask Largo mandate ledger

The 2026-09-20 mandate-ledger correction that dismissed this as "walking back the severity...
nothing to fix here" was itself premature — it stopped at the play-brief surface and didn't check
the board, which is what actually revealed the real (narrower, still genuine) bug. Treat this as the
closing correction on that thread, not a reopening of the "fabrication" framing: the 84% arithmetic
really was real (per the walk-back), the bug is the sentinel-clobber causing the SAME position to
disagree across surfaces, now fixed.
