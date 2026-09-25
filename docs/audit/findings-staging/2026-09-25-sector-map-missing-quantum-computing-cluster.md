## `portfolio/sector-map.ts` had no quantum-computing cluster, so `checkPortfolioOverlap` missed a real concurrent-position concentration — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — portfolio concentration awareness |
| **Severity** | P3 (correctness gap — a real book concentration goes undetected/undisclosed, not a wrong number or a trading-gate defect) |
| **Status** | FIXED |
| **File** | `src/lib/portfolio/sector-map.ts` (`SECTORS`) |

### Root cause

`sectorFor`/`SECTORS` is the single curated ticker→theme map both the allocation engine's duplicate-thesis
clustering and the swing engine's `theme-cluster.ts` (`resolveTheme`/`sameThesis`, which directly feeds
`checkPortfolioOverlap`'s Book-context concentration evidence) resolve against. An unmapped ticker returns
`null` and becomes its own isolated cluster by design (never a false shared-thesis merge) — but that also
means a real, correlated basket of tickers that happen to share no existing sector entry reads as "no
concentration" even when a member's book holds all of them concurrently, same direction.

`RGTI` (Rigetti), `QBTS` (D-Wave), `IONQ` (IonQ), and `QUBT` (Quantum Computing Inc) — the four liquid,
options-active pure-play quantum-computing names that trade as one basket-level bet — had no entry in
`SECTORS` at all, so each resolved to its own unmapped cluster. Same gap shape as the 2026-09-20
crypto-equity extension (`docs/audit/FINDINGS.md`), which the code's own comment on that entry already
names as the precedent for this kind of gap.

### Evidence

Live audit, 2026-09-25 (non-RTH): the current committed book holds RGTI, QBTS, and IONQ concurrently
LONG, all from the same TACTICAL/BREAKOUT-archetype discovery batch. Pulled RGTI's live play-brief
(`GET /api/market/swing/play-brief?ticker=RGTI&positionId=1339`) — its Book-context section makes zero
mention of QBTS or IONQ, i.e. `checkPortfolioOverlap` reported no concentration for a genuinely correlated
3-name basket a member is actually exposed to.

### Fix

Added a `"quantum-computing": ["RGTI", "QBTS", "IONQ", "QUBT"]` entry to `SECTORS`, deliberately
conservative (per the crypto-equity precedent's own stated discipline) — only unambiguous, liquid
pure-play names, no partial/ambiguous quantum exposure included.

Regression test added (`src/lib/swing/theme-cluster.test.ts`): confirmed RED before the fix (`resolveTheme("RGTI")`
returned its own isolated `NAME:RGTI` cluster, `sameThesis("RGTI","QBTS")` false) / GREEN after (all four
resolve to `"quantum-computing"`, pairwise `sameThesis` true, and still correctly does NOT merge into an
unrelated theme like `semis` just because both are "tech"). `tsc --noEmit` clean; 1,725 collateral tests
across `src/lib/portfolio`, `src/lib/swing`, `src/lib/banger`, and `src/lib/zerodte/governor.test.ts` pass.
