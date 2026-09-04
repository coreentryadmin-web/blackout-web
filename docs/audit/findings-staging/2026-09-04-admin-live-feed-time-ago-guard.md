# 2026-09-04 — admin-live-feed-time-ago-guard

> **kind:** FINDING

## Admin API Live Feed + SPX Terminal still lacked future-timestamp guard (#3641 follow-up)

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` API Live Feed + SPX Terminal |
| **Status** | FIXED |

### Symptom

#3641 extracted `timeAgoFromIso()` for Operations + X Marketing panels, but `AdminApiLiveFeed.tsx` and `AdminSpxTerminal.tsx` kept local `fmtRel()` helpers using raw `Date.now() - new Date(iso).getTime()`. Clock-skewed future ISO timestamps displayed **"just now"** / **"now"** / negative **"open -Ns"** on incident rows.

### Fix

Extended `admin-time-ago.ts` with shared `ageMsFromIso()` plus `timeAgoCompactFromIso()` and `secondsSinceIso()`. Wired API Live Feed + SPX Terminal to the shared helpers.

### Evidence

- `npx tsx --test src/components/admin/admin-time-ago.test.ts` — 7 pass

### Market-open validation

- `/admin` → API Live Feed incident timestamps + SPX Terminal line times show sensible ages during RTH; skewed rows read **clock skew** / **skew**, not **just now**.
