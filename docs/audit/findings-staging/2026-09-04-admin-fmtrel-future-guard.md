# 2026-09-04 — admin-fmtrel-future-guard

> **kind:** FINDING

## Admin live-feed relative timestamps showed "just now" on clock-skewed future events

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` API Live Feed + SPX Terminal feed |
| **Status** | FIXED |

### Symptom

`AdminApiLiveFeed.tsx` and `AdminSpxTerminal.tsx` each carried a local `fmtRel()` that computed `Date.now() - iso` without a future guard. A timestamp more than a few seconds ahead of wall clock produced a negative age; the `< 5s` / `< 3s` branches still matched, so the feed read **"just now"** / **"now"** for events that had not occurred yet — the same failure class fixed in `timeAgoFromIso` (#3641) and `storeAge` earlier today.

### Fix

- **API Live Feed:** removed duplicate `fmtRel`, now uses shared `timeAgoFromIso`.
- **SPX Terminal:** extracted `formatAdminSpxTerminalRel()` (keeps compact `30s` / `5m` / ET clock format) with `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard → returns `"skew"` when untrustworthy.

### Evidence

- `npx tsx --test src/components/admin/admin-spx-terminal-rel-time.test.ts` — 3 pass
- `npx tsx --test src/components/admin/admin-time-ago.test.ts` — existing coverage for shared helper

### Market-open validation

- `/admin` → API Live Feed: confirm incident/API event ages tick forward during RTH; no perpetual "just now" on stale rows after a deploy.
- `/admin` SPX Terminal tab: confirm feed timestamps advance; skewed rows show `skew` not `now`.
