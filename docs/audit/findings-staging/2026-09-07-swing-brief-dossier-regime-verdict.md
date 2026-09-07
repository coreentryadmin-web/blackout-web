# Swing play-brief dossier regime leaked into Verdict unlabeled

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Pri** | P2 |

## Symptom

WATCH and dossier-enriched rows carried `play.regime` strings like `Breakout · regime 0.82` (discovery-pillar metadata from `swingServingMetaFromDossier`, not Vector/SPX market regime) into the **Verdict** section verbatim and unlabeled, while **Archetype** was shown separately on the next line — redundant and misreads as desk regime (Largo contract C7 identity).

Committed rows were already fixed in #4481 (`live-plays.ts` sets `regime: null`); WATCH/dossier attach path still pushed the string into Verdict.

## Fix

- `play-brief.ts`: stop echoing `play.regime` in Verdict.
- `play-brief-intel.ts`: label dossier regime as **Discovery read:** in "Why this setup".

## Verify at RTH

Open a WATCH swing row with dossier factors → Ask Largo panel: Verdict shows archetype only; "Why this setup" shows labeled discovery read, not raw regime string in Verdict.
