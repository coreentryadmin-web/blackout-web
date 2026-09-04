# UW lit/dark ratio future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | SPX desk / lit-dark ratio |
| **PR** | (pending) |

## Symptom

`computeLitDarkRatio()` used raw `now - store.updatedAt <= maxAge` — a clock-skewed future `updatedAt` reads as infinitely fresh (negative age always passes). SPX desk could show a lit/dark ratio built on stale WS data while `spx-desk.ts` already guards `darkPoolStore` via `uwWsStoreFresh` on other paths.

## Root cause

Duplicate freshness logic in `uw-lit-dark-ratio.ts` predated the shared `isWsUpdatedAtFresh` helper landed in #3771/#3762.

## Fix

Use `isWsUpdatedAtFresh` for both `litTradesStore` and `darkPoolStore`; optional `now` param for tests.

## Tests

`src/lib/uw-lit-dark-ratio.test.ts` — source scan + far-future stores → null.

## RTH validation

On SPX desk during RTH: lit/dark ratio tile should disappear (null) when UW WS stores are genuinely stale, not persist because of a skewed timestamp.
