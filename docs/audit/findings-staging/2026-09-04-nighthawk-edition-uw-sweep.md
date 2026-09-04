## 2026-09-04 — [P2 perf] nighthawk-edition background build missing runWithBackgroundUwSweep — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 — tail-latency / UW budget starvation risk during nightly edition build |
| **Found by** | Autopilot cron UW-sweep pattern scan |

### Root cause

`GET /api/cron/nighthawk-edition` dispatches `buildEveningEdition` via `after()` without tagging the work as a background UW sweep. The builder fans out per-ticker UW REST (`fetchAllDossiers`, `fetchMarketWideContext`) and can contend with live desk/vector traffic on the shared 2-RPS cluster budget.

### Fix

Wrap the background `buildEveningEdition` dispatch in `runWithBackgroundUwSweep`, matching `vector-universe-snapshot`, `darkpool-discord`, and sibling crons.

### Evidence

- `npx tsx --test src/app/api/cron/nighthawk-edition/route.test.ts` — 2/2 PASS
- Source scan asserts import + wrapper; bare `void buildEveningEdition(` absent

### Market-open validation

Off-hours only — confirm at next edition window that `nighthawk-edition` cron still returns 202 and edition publishes; no spike in UW 429s on vector/desk routes during the build window.
