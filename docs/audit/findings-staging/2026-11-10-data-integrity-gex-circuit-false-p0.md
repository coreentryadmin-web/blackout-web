> **kind:** `FINDING`

## data-integrity C6 — false P0 when Polygon circuit open (GHA RTH deep audit)

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/data-integrity-checks.ts` |
| **Severity** | P1 CI / ops noise — RTH deep audit run `42897223779` (Tue 15:38 ET) |

### Root cause

Sentry in the same GHA run showed `[polygon] Circuit open — rate limited`. While the circuit is
open, `getGexPositioning()` can return null even though the heatmap API/cache is healthy moments
later (full-site heatmap stage GREEN on the same run). C6 treated any null as `GEX SPX/SPY cold
during RTH` P0 and failed `data-integrity` + full-site audit.

### Fix

- Skip C6 cold incidents when `isPolygonCircuitOpen()` is true.
- One 2.5s guarded re-fetch for missing SPX/SPY matrices after market-open is confirmed.
- Pure helper `shouldFlagGexColdDuringRth` in `data-integrity-gex-freshness.ts`.

### Verification

`node --test --import tsx src/lib/data-integrity-gex-freshness.test.ts`

### Note

Same run still reported `swing-discovery` stale during RTH — a separate production lane issue, not
suppressed by this PR.
