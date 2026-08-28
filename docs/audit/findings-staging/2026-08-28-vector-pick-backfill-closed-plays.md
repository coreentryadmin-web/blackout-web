> **kind:** `FINDING`

## Vector contract picks — no backfill on Don't buy + closed picks invisible

| **Status** | FIXED |

When a ranked pick went `dont_buy` (setup invalidated, premium chase, or cap breach), it stayed in
the active 1–3 strip with a red chip until the next 45s re-rank — and **no replacement** promoted
from rank #4+. Members asking "if one of three plays closed, do we find a new one?" got **no**
until the slow refresh, and invalidated contracts were not grouped as closed history.

**Fix:** rank an 8-contract deep pool server-side; `useVectorActionablePicks` archives every
`dont_buy`, excludes its OCC from the next rank, partitions active vs closed, and backfills active
slots from the pool. UI renders **Closed · setup invalidated** below the active strip.

Also: short-gamma with no wall and no EMA trend now **stand aside** (neutral) instead of asserting
`momentum-short` with zero evidence — mirrors long-gamma fail-closed behavior.

**Verification:** `npx tsx --test` on `vector-pick-partition`, `vector-play-candidates`,
`vector-play-engine`, replay gate, and `VectorContractPicksCard` tests — all green; `tsc --noEmit` clean.
