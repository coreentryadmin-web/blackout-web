## 2026-09-04 — [FINDING, P2 Data correctness] Future timestamps read as fresh + unrounded API floats — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 — false-fresh on clock-skewed timestamps; cosmetic float precision at API boundaries |
| **Surface** | `playbook-data-quality.ts`, `stocks-socket.ts`, Vector contract-picks/live + dark-pool routes |
| **Status** | FIXED |

### Root cause

Three related gaps from the hourly pattern scan:

1. **`playbookDataQualityFlags`** used `Math.max(0, now - polled_at)` — a future `polled_at` clamped to age 0 → `desk_stale: false`. Sibling `spx-play-gates.ts` already guards this; this path did not.

2. **`isLuldHaltSourceStaleForState`** used raw `now - ts <= maxAgeMs` — negative age (future timestamp) satisfied the freshness check. Same class as the fixed UW-halt / matrix-freshness guards.

3. **Member-facing routes** `contract-picks/live`, `dark-pool`, `dark-pool/ticker` returned unrounded floats while sibling Vector routes already use `roundFloats()`.

### Fix

- `playbook-data-quality.ts`: use shared `ageSecFromIso()` — null (future/invalid) → `desk_stale: true`.
- `stocks-socket.ts`: use `isWsUpdatedAtFresh()` for all three freshness branches.
- Three routes: wrap JSON responses with `roundFloats()`.

### RED → GREEN evidence

- `playbook-data-quality.test.ts`: future `polled_at` → `desk_stale: true`.
- `stocks-socket.test.ts`: future delivery timestamp → STALE.
- `vector-roundfloats-routes.test.ts`: extended to cover `contract-picks/live`.
