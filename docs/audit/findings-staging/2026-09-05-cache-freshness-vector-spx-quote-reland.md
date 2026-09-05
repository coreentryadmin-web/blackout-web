# 2026-09-05-cache-freshness-vector-spx-quote-reland

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Vector DTE walls memo + SPX 0DTE quote cache |

## Symptom

Two in-process caches on `main` still used raw `Date.now() - entry.at < ttlMs`. A clock-skewed
future `at` stamp reads as negative age → treated as infinitely fresh, bypassing TTL expiry.

Affected paths:

- `getPerExpiryGexWalls()` memo in `vector-dte-walls-server.ts` (5s request coalescer)
- `quoteSpxOdteContract()` quote cache in `spx-play-options.ts` (live 0DTE marks on desk chips)

## Root cause

Pattern-scan follow-up to the Sep-2026 future-timestamp sweep. Fix landed as #3849 on branch
`da4426010` but that commit is **not an ancestor of `origin/main`** (deploy queue superseded /
parallel lane divergence). Production still ships the unguarded reads.

## Fix

Route both caches through shared `isWsUpdatedAtFresh()` (5s future tolerance). Source-scan
regression tests lock the wiring.

## RTH validation

- Vector `/vector` → DTE walls overlay: force a skewed memo `at` in staging is impractical; verify
  staleness chips flip STALE when `updatedAt` is >5s in the future (existing universe guard pattern).
- SPX desk open play chips: 0DTE quote cache must not serve stale quotes after clock skew — spot-check
  live marks refresh within `QUOTE_TTL_MS` off-hours.
