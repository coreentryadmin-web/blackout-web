# Largo swing brief: GEX-only dealer posture says "Right now" on stale matrix — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale |
| **Pri** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED in PR (pending merge) |

## Symptom

When Vector desk state was absent and dealer posture came solely from `ecosystem.gex_positioning`, a matrix older than 120s still produced "**Right now**" in the Trade manager narrative — violating Largo contract **C2 (freshness)**. Vector staleness was already gated; GEX matrix age was ignored in narrative and Data freshness section.

## Root cause

`dealerPostureLine()` in `play-brief-narrative.ts` only checked Vector `dataAgeMs` / `freshness`. `dataFreshnessSection()` had the same blind spot. `collectBriefUnavailableSources()` did not emit a structured absence for stale GEX.

## Fix

- Shared `gexMatrixAgeMs` / `gexMatrixStale` helpers in `play-brief-absence.ts` (uses `matrix_age_sec` or `asof`).
- Narrative lead uses "Last snapshot" when GEX-sourced posture is stale.
- Data freshness section warns on stale GEX matrix.
- `unavailableSources` includes `{ source: "GEX matrix", reason: "stale — dealer posture may lag spot" }`.

## Evidence

`npx tsx --test` on `play-brief-narrative.test.ts`, `play-brief-intel.test.ts`, `play-brief.test.ts` — 69/69 pass including new GEX-stale cases.
