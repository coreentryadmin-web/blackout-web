# Swing play-brief level freshness hardcoded "live" — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-brief-freshness |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`composeSwingPlayBrief()` stamped every Vector-sourced envelope level (spot, confluence, dark pool, max pain) with `provenance.freshness: "live"` and GEX walls as `"recent"` regardless of snapshot age. Off-hours or cache-served Vector state up to 15 minutes old was presented as live in the structured levels table Largo and the Swing deck render.

## Root cause

`levelsFromContext()` in `src/lib/swing/play-brief.ts` used static freshness strings instead of `describeVectorFreshness()` / `freshnessFromAgeMs()` — the same C2 helpers Vector desk brief and `get_vector_full_state` already use.

## Fix

- Derive Vector freshness from `vec.asOf` vs brief read time via `describeVectorFreshness`.
- Derive GEX freshness from `gex.asof` via `freshnessFromAgeMs`.
- Option-mark evidence uses measured age when `markAsOf` is ISO-parseable; otherwise `unknown`.

## Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts` — new test asserts 20m-old snapshot → `stale`, not `live`.

## Market-open check

RTH: select an OPEN swing row on Night Hawk Swings → Ask Largo panel → expand levels; off-hours brief should show stale/recent tags on spot/walls when Vector cache is aged (Data freshness section should align).
