# 2026-09-04 — comprehensive-endpoint-audit false FAIL on optional TikTok OAuth routes

> **kind:** FINDING

## Symptom

`npm run validate:comprehensive-endpoints` reported 2 FAIL: `/api/social/tiktok/connect` and `/api/social/tiktok/callback` returned HTTP 503 during route-discovery smoke.

## Root cause

Both routes intentionally return 503 when `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` are absent (optional marketing integration). The route-discovery pass treated any 5xx as FAIL with no carve-out for optional OAuth endpoints.

## Fix

Add both paths to `skipOAuth` in `scripts/comprehensive-endpoint-audit.mjs` so they are skipped (not counted as FAIL) during GET smoke.

## Status

FIXED — regression: `scripts/comprehensive-endpoint-audit-skip.test.mjs`.
