> **kind:** `FINDING`

## Night Hawk Vector tab — persist closed contract picks for analysis

| **Status** | FIXED |

Vector contract picks were advisory-only: when the live monitor marked **Don't buy**, nothing was
persisted for later analysis. Operators could not answer "how often do rank-1 picks invalidate before
entry?" without scraping logs.

**Fix:** `vector_pick_closures` table + edge-triggered insert on `POST /api/market/vector/contract-picks/live`
(first `dont_buy` per session/ticker/OCC, idempotent on `commit_key`). Night Hawk gains a fifth toggle
**Vector** rendering `VectorPickLogBoard` via `GET /api/market/vector/pick-closures/board`.

These rows are analysis events, not committed positions — distinct from 0DTE/swing/banger ledgers.

**Verification:** unit tests on closure helpers + updated `nighthawk-view.test.ts`; `tsc --noEmit` clean.
