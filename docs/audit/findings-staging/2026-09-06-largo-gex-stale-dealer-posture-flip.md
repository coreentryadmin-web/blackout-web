# Largo swing brief — stale GEX-only flip in dealerPostureLine — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-dealer-posture-flip |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`dealerPostureLine()` resolved `flip` as `vec?.gammaFlip ?? gex?.flip` with no staleness gate. When live Vector supplied `regime.posture` but no `gammaFlip`, a stale GEX-only flip still appeared in the `γ-flip` suffix under a **"Right now"** lead — same Largo C2 class fixed in sibling paths (#4360/#4364/#4367/#4372/#4374/#4375).

## Fix

Per-value stale GEX gating on flip (mirrors `collectFocalLevels`, `counterThesisLine`, break-watch): suppress flip when sourced from stale GEX-only fallback; live Vector `gammaFlip` still wins.

## Evidence

`npx tsx --test src/lib/swing/play-brief-narrative.test.ts` — two new stale-parity cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
