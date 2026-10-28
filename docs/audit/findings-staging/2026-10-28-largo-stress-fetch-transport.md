# Largo stress CI crash on ECONNRESET — transport handling

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

`largo-stress` on `main` (commit `734b7f94`) died mid-sweep with uncaught `TypeError: fetch failed` / `read ECONNRESET` from `fetch-retry.mjs` after Cloudflare 429 streaks. Questions that returned 429 were already SKIPPED; network resets were not.

## Fix

`scripts/largo-stress-run.mjs`: `askLive` catches exhausted `fetchRetry` and returns `status: 0` with `transport_error`; `askLiveThrottleAware` retries status 0 with the same backoff as 429; retries increased from 1 to 3 inside `askLive`.

## Verify

- `npx tsx --test src/largo-stress-transport.test.ts`
- Next green `largo-stress-nightly` run completes without process crash when transport blips occur.
