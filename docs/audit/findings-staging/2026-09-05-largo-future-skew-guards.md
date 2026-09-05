# Largo future-skew guards — conversation memory + toolbar

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-largo-future-skew |
| **Status** | FIXED |
| **Area** | Largo |
| **Severity** | P2 |

## Symptom

`isMemoryFresh()` used raw `(Date.now() - lastUpdated) / 1000`. A clock-skewed future
`lastUpdated` yields negative age that passes the `< maxAgeSeconds` gate, so
`shouldReuseCachedConsensus()` could serve stale multi-tool consensus on follow-up questions.

`LargoTerminalToolbar.formatRelative()` had the same class of bug for history labels: negative
`diff` fell through to `"just now"`.

## Root cause

Missing shared future-timestamp tolerance (already standardized in `timestamp-freshness.ts` for WS
gates).

## Fix

- `isMemoryFresh`: reject `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; clamp positive age.
- `formatRelative`: show `"—"` when `rawDiff < -5_000`; clamp display age with `Math.max(0, rawDiff)`.

## Evidence

- `npx tsx --test src/lib/largo/conversation-memory.test.ts` — future-skew regression tests GREEN.
- `npx tsx --test src/features/largo/largo-toolbar-relative-time.test.ts` — source scan GREEN.
