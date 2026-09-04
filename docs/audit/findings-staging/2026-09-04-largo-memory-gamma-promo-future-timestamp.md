# Largo memory + marketing GEX promo future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Largo / marketing |
| **Severity** | P3 |

## Symptom

Two off-desk surfaces treated clock-skewed future `lastUpdated` / `asof` timestamps as fresh:

- `isMemoryFresh()` — negative age still passed the max-age check, so Largo could reuse stale conversation memory.
- `HomeGammaPromo.fmtAgeFromAsof()` — negative age rendered as `"live"` on the marketing GEX band.

## Fix

- `conversation-memory.ts`: reject `lastUpdated` more than `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` ahead of now; clamp age with `Math.max(0, …)`.
- `HomeGammaPromo.tsx`: route `asof` through shared `ageSecFromIso()` — future/skewed → `"warming"`.

## Tests

- `conversation-memory.test.ts` — future `lastUpdated` → not fresh.
- Manual: homepage GEX promo chip should not read `"live"` when `asof` is in the future.
