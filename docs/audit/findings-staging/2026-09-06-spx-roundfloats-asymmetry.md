## 2026-09-06 — [FINDING, SPX Slayer, P2] roundFloats asymmetry between member route and getSpxPlayState/getSpxDeskSummary — FIXED

> **kind:** `FINDING`

### Symptom

`scripts/audit/spx-bie-consistency-validator.mjs` Layer A static check WARNs: member
`/api/market/spx/play` applies `roundFloats(play)` before responding, but
`getSpxPlayState()` (BIE `spx_full_state`, Largo `get_spx_play`) and `getSpxDeskSummary()`
(Largo `get_spx_structure`) returned raw IEEE754 tails — e.g. `7499.360000000001` vs `7499.36`.

Same class for desk summary via `/api/market/spx/desk` vs internal callers.

### Root cause

Rounding lived only at HTTP route boundaries in `play/route.ts` and `desk/route.ts`, not at the
shared derivation in `spx-service.ts` that BIE/Largo/Redis cache consume.

### Fix

Apply `roundFloats` once at derivation:

- `evaluateSpxPlayState()` return (covers `getSpxPlayState`, cross-replica cache, Largo/BIE)
- `getSpxDeskSummary()` return (covers desk summary for all internal callers)

### Evidence

- Static regression in `spx-service.play.test.ts` asserts both return sites call `roundFloats`
- `node scripts/audit/spx-bie-consistency-validator.mjs --static-only` → roundFloats asymmetry PASS
- `npx tsx --test src/features/spx/lib/spx-service.play.test.ts` — pass

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
