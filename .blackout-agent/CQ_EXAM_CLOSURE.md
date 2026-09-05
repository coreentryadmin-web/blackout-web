# CQ Cross-Examination — Closure Ledger

**At:** 2026-09-05T18:45Z · Fix pass batches 1–2 in flight.

## CCQ-actionable gaps — status

| CQ | Gap | Status | PR |
|----|-----|--------|-----|
| CQ-007 | email enumeration (`isNew`) | **batch 1** #4023 | |
| CQ-095 | `internals_estimated` UI | **batch 1** #4023 | |
| CQ-173 | premium gate functional test | **batch 1** #4023 | |
| CQ-003 | JWT fast-path downgrade | **batch 2** pending | |
| CQ-054 | Vector spot≤0 guard | **batch 2** pending | |
| CQ-083 | FlowTapeSummary `as_of` | **batch 2** pending | |
| CQ-051 | vector offline audits unwired | **batch 2** pending | |
| CQ-170 | Whop webhook test | ✅ #3998 | |
| CQ-171 | tool-agent CI | ✅ #4007 | |
| CQ-183 | sitemap lastmod CI | ✅ #3995 | |

## Answer classes

| Class | Count | Disposition |
|-------|-------|-------------|
| PROVEN | 87 | **CLOSED** |
| DISPROVEN | 35 | **CLOSED** |
| PARTIALLY PROVEN | 76 | **CONFIRMED-PARTIAL** (+ 10 code gaps tracked/fixed) |
| UNKNOWN | 20 | **CONFIRMED-UNKNOWN** |

Full ledger: **`CQ_FIX_QUEUE.md`** · Regenerate: `node scripts/blackout/parse-cq-fix-queue.mjs`
