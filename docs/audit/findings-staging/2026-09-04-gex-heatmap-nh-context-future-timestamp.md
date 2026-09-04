# 2026-09-04 — GEX heatmap Night Hawk context future-dated edition

> **kind:** FINDING

## Symptom

`/api/market/gex-heatmap` could attach `nighthawk_context` from an edition whose `published_at` was in the future (cross-process clock skew from the Night Hawk cron writer). A negative age never exceeded the 24h gate, so an untrustworthy edition passed as fresh.

## Root cause

`getNightHawkContext()` compared raw `Date.now() - published_at` with no future guard — unlike sibling paths (`getNhConfluenceBonus`, flow-anomaly recency) fixed the same day.

## Fix

Extracted `isNighthawkContextEditionFresh()` using shared `isZeroDteMarkStale()` with 24h max age.

## Status

FIXED in PR.

## Market-open validation

On `/heatmap` or SPX matrix during RTH, confirm Night Hawk context chip only appears for editions published within the last 24h and does not flash on skewed/future rows after deploy.
