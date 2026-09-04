# Halt-source freshness future-timestamp guard (follow-up to #3733)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | ingest / fail-closed halt gates |
| **PR** | (this branch) |

## Symptom

`isUwHaltSourceStale` (UW multiplex fallback), `isLuldHaltSourceStaleForState` (LULD halt
decision core), and `isLuldHaltFeedStale` still used raw `Date.now() - at > maxAgeMs` /
`now - at <= maxAgeMs`. Clock-skewed **future** stamps yield negative age, which still passes
`<= maxAgeMs` — the same false-fresh class fixed for UW channel freshness in #3733.

## Fix

Route halt staleness decisions through `isWsUpdatedAtFresh` from `timestamp-freshness.ts`.

## Evidence

- Extended `uw-socket-gate.test.ts` source scan for `isUwHaltSourceStale`
- `stocks-socket.test.ts` future-skew + boundary cases
- `npx tsx --test` on touched ws test files
