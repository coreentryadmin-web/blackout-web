## `portfolio/sector-map.ts`'s `semis` cluster was missing ALAB/CRDO/KLAC, so `checkPortfolioOverlap` missed a real concurrent-position concentration — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — portfolio concentration awareness |
| **Severity** | P3 (correctness gap — a real book concentration goes undetected/undisclosed, not a wrong number or a trading-gate defect) |
| **Status** | FIXED |
| **File** | `src/lib/portfolio/sector-map.ts` (`SECTORS.semis`) |

### Root cause

Same bug class as the 2026-09-20 crypto-equity extension and the 2026-09-25 quantum-computing
addition (both already in `docs/audit/FINDINGS.md`): `sectorFor`/`SECTORS` is the single curated
ticker→theme map both `theme-cluster.ts` (`resolveTheme`/`sameThesis`, feeding
`checkPortfolioOverlap`'s Book-context concentration evidence) and the allocation engine resolve
against — an unmapped ticker becomes its own isolated cluster by design, so a real correlated name
that shares no existing entry reads as "no concentration."

`ALAB` (Astera Labs) and `CRDO` (Credo Technology) are AI-datacenter connectivity-chip plays
(PCIe/CXL retimers, SerDes/optical DSP) — the same AI-infra risk bucket as the already-listed
NVDA/AVGO/MRVL. `KLAC` (KLA Corp) is semis-equipment/process-control — the identical subsector as
the already-listed LRCX/AMAT. None had an entry in the `semis` array.

### Evidence

Live audit, 2026-09-25: the committed book held ALAB concurrently LONG across 3 positions
(#1270/#1153/#1139), CRDO across 2 (#1275/#1136), plus KLAC/LRCX/INTC — a real 6-position
semiconductor/AI-infra concentration. ALAB#1139's and CRDO#1136's live play-briefs' Book-context
sections reported only same-ticker concentration, never the cross-ticker semis basket —
`checkPortfolioOverlap` structurally couldn't see it.

### Fix

Added `"ALAB", "CRDO", "KLAC"` to `SECTORS.semis`. Considered but did NOT add (lower confidence,
not live-verified this pass): SMTC/AMBA/AXTI — left for a future pass per the same "deliberately
conservative" discipline the crypto-equity/quantum-computing precedents state.

Regression test added (`src/lib/swing/theme-cluster.test.ts`): confirmed RED before the fix
(`resolveTheme("ALAB")` returned its own isolated `NAME:ALAB` cluster) / GREEN after (ALAB/CRDO/KLAC
resolve to `"semis"`, cluster with each other and with NVDA/LRCX, and still correctly do NOT merge
into an unrelated theme). `tsc --noEmit` clean; 1,729 collateral tests across `src/lib/portfolio`,
`src/lib/swing`, `src/lib/banger`, `src/lib/zerodte/governor.test.ts` pass.
