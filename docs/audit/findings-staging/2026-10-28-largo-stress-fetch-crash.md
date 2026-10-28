# Largo stress nightly crashes on Cloudflare 429 / ECONNRESET tail — FIXED

> **kind:** FINDING

| **Status** | FIXED in PR (fix/largo-stress-transport-crash) |

## What broke

Nightly `largo-stress` (run 40695702887, 2026-10-28) answered ~40 live questions, then hit a burst of Cloudflare `http-429` SKIPs (handled correctly). The next request threw `TypeError: fetch failed` / `read ECONNRESET` from `fetchRetry` after retries exhausted, which was uncaught in `askLive` and aborted the entire sweep with exit 1 — not a Largo quality failure.

## Fix

- `askLive`: catch exhausted `fetchRetry` errors → `liveResultFromFetchError` (status 0, transport SKIP).
- Worker: per-question try/catch backstop; bump live retries 1→3.
- Regression: `scripts/largo-stress-live-result.test.mjs`.

## Live check

Re-run `workflow_dispatch` Largo stress nightly on `main` after merge; expect transport SKIPs under rate limit but job completes and exits 0 unless a scored answer is BAD.
