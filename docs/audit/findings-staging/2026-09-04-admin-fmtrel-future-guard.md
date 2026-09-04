# 2026-09-04 — Admin API/SPX feed fmtRel future-timestamp guard

> **kind:** FINDING

| Field | Detail |
|-------|--------|
| **Status** | FIXED |
| **Area** | `AdminApiLiveFeed`, `AdminSpxTerminal`, `AdminSpxDashboard` |

## Symptom

`timeAgoFromIso` already guarded Operations + X Marketing panels, but three sibling admin surfaces still computed `Date.now() - new Date(iso)` inline: API live-feed `fmtRel`, SPX terminal `fmtRel`/incident open duration, and SPX dashboard staleness (`staleMs`). Clock-skewed future timestamps read as "just now" / falsely fresh.

## Fix

Extended `admin-time-ago.ts` with `timeAgoCompactFromIso`, `timeAgoTerminalFromIso`, and `adminAgeMsFromIso`; wired all three remaining admin surfaces to the shared helper.

## Tests

`src/components/admin/admin-time-ago.test.ts` — 7 pass.

## Market-open validation

`/admin` → API live feed + SPX terminal: confirm relative timestamps show "clock skew" (not "just now") if a row carries a future-dated ISO during RTH.
