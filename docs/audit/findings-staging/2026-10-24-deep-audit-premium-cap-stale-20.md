# full-site-deep-audit's PREMIUM-CAP check uses a stale $20 cap — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## What broke

`scripts/full-site-deep-audit.mjs`'s `auditNightHawk()` flagged any Night Hawk play with
`entry_premium > 20` as a `P1 PREMIUM-CAP` violation. The real, current product cap is
`MAX_OPTION_PREMIUM_PER_SHARE = 35` (`src/features/nighthawk/lib/constants.ts`). The audit's
own literal had drifted stale relative to the product it audits.

## Root cause

Surfaced while triaging a large pile of duplicate open PRs (2026-10-22 batch, 28 PRs across 4
unrelated bug clusters — see the closing comments on #6605/#6602/#6599/etc.) racing each other to
fix a separate Postgres/cron-health issue. #6605 happened to bundle this premium-cap fix in with
the (now-superseded) PG fix; extracting it here since nothing else covers it.

The $20 literal was never updated when the product's premium cap was raised to $35 — the audit
script and the product constant have no shared source, so the two can silently diverge with no
compile-time or runtime signal until someone reads both side by side.

## Fix

Import-by-reference isn't practical here (`full-site-deep-audit.mjs` is a standalone script, not
part of the Next.js build graph, and `src/features/nighthawk/lib/constants.ts` has its own
dependency chain), so this names the shared constant explicitly in a local
`NIGHTHAWK_PREMIUM_CAP_PER_SHARE = 35` with a comment pointing at the real source of truth, and a
new regression test (`full-site-deep-audit.test.mjs`) that reads both files and asserts the two
values stay equal — so a future bump to `MAX_OPTION_PREMIUM_PER_SHARE` without a matching audit
update fails CI instead of silently drifting again.

## Verify

- `node --import tsx --experimental-test-module-mocks --test scripts/full-site-deep-audit.test.mjs`
  — 2/2 pass post-fix; the new test fails (RED) against the pre-fix source (git-stash confirmed).
- Next scheduled `full-site-deep-audit` run against production.
