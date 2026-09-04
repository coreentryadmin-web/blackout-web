# 2026-09-04 — Dark-pool roundFloats + Vector live-quote future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `/api/market/dark-pool`, Vector pick live monitor |
| **Status** | FIXED |

## Symptom

1. `GET /api/market/dark-pool` returned `premium` and `share_size` without `roundFloats` at the JSON boundary — IEEE float noise at the member edge.
2. `isLiveQuotesStale()` used raw `now - lastSuccessAt` with no future guard; clock-skewed success time read as live (negative age → not stale).

## Root cause

- Dark-pool route predated the Vector roundFloats sweep (#3756) and was never enrolled.
- Live-quote staleness helper was written before the shared `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` pattern landed on halt/socket gates.

## Fix

- Wrap dark-pool response with `roundFloats({ prints, count })`.
- Guard `isLiveQuotesStale` with `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS → stale`.

## Evidence

- `dark-pool/route.test.ts` source scan for `roundFloats(`.
- `use-vector-pick-live-monitor.test.ts` future-skew cases.

## RTH validation

- Poll `/api/market/dark-pool?limit=5` — `premium` fields should be clean decimals, no long tails.
- On Vector contract-pick rail during RTH, confirm live badge flips to stale when quotes stop updating (no false "live" on skewed timestamps).
