# 2026-09-04-platform-integrity-clerk-auth.md

> **kind:** FINDING

## Platform integrity probe false-WARNs on tier-gated desk routes

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | ops / RTH lifecycle |
| **PR** | fix/platform-integrity-clerk-auth |

### Symptom

`npm run validate:platform-integrity` ran unauthenticated against prod. Tier-gated routes
(`/api/market/gex-heatmap`, `/api/market/vector/walls`, etc.) returned 401 or empty bodies,
producing WARN/FAIL noise in RTH lifecycle sweeps even when live desk data was healthy.

### Root cause

The probe documented itself as "no auth for public reads" but still asserted on premium desk
endpoints without a Clerk session — same class of false negative as data-validator before
Layer C auth was added.

### Fix

Mint a temp admin+premium Clerk session via `mintClerkPremiumSession()` (deleted in `finally`),
pass `Cookie` on tier-gated fetches, and assert vector walls by `callWalls`/`putWalls` counts
instead of a missing top-level `spot` field.

### Evidence

Live run post-fix: **14 pass, 0 warn, 0 fail** @ `https://blackouttrades.com` (2026-09-04 off-hours).
