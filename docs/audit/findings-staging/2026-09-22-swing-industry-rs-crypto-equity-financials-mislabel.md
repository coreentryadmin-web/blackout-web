> **kind:** FINDING

## Swing `industry-group-rs.ts` benchmarked crypto-equity names (HUT) against Financials/XLF — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — `src/lib/swing/industry-group-rs.ts` (`resolveGroupBenchmark`, SECTOR_ROTATION archetype's relative-strength feed) |
| **Severity** | P2 — a fabricated-looking, internally-contradictory score input on a live committed position; not a data-loss/crash bug, but a real trust-in-the-evidence defect (LARGO-PRODUCT-CONTRACT.md C6/C8 shaped: evidence must be honest, and cross-sections of the same brief must not contradict each other) |
| **Status** | FIXED |
| **Found via** | Live Ask Largo play-brief forensic audit of HUT:41 (positionId 41, a committed native — non-Banger — swing position), part of the standing "Ask Largo × Night Hawk Swings" ownership mandate |

### Root cause

`GET /api/market/swing/play-brief?playId=SWING:HUT&ticker=HUT&positionId=41&status=COMMIT&expandIntel=1`
contained an internal contradiction:

- **"Book context"** correctly read *"already holding 26 same-direction positions in theme 'crypto-equity'"*,
  grouping HUT with GEMI/MSTX/MSTU/ABTC/BLSH/SBET/GLXY etc. — sourced from `portfolio/sector-map.ts`'s
  hand-curated `sectorFor()`.
- **"Why this setup" → "Industry read"** read *"leading Financials (XLF) by 10.7% over 10 sessions"* — the
  **single largest score pillar** shown in the same brief ("Rel. strength — +35 pts") — benchmarking a
  bitcoin-mining/digital-infrastructure company against the Financials Select Sector SPDR.

Traced to `resolveGroupBenchmark` (`industry-group-rs.ts`), the pure resolver behind
`sectorLeadership01`/`sectorLeadershipFacts`. It resolves finest-first: exact-SIC industry ETF → SIC-range
sector ETF → static sector-map label → null. **Live-confirmed 2026-09-22** via Polygon
`/v3/reference/tickers/HUT`: HUT's real `sic_code` is `"6199"`, `sic_description: "FINANCE SERVICES"` — a
real, provider-assigned classification (bitcoin miners routinely get bucketed under a generic finance/
holding-company SIC because they don't fit a traditional mining code; HUT's own Polygon description reads
"energy infrastructure platform... Bitcoin Mining, GPU-as-a-Service, Data Center Cloud"). SIC 6199 lands
squarely in `sectorEtfFromSic`'s `if (sic >= 6000 && sic <= 6499) return XLF;` range
(`industry-group-rs.ts:158`) — a defensible rule for genuine finance-services firms, mechanically wrong for
a crypto miner mislabeled into that SIC bucket.

**This module has no equivalent override that `theme-cluster.ts`/`portfolio/sector-map.ts` already have.**
`portfolio/sector-map.ts`'s `sectorFor()` hand-classifies HUT (alongside COIN/MARA/RIOT/MSTR/CLSK/CIFR/
BITF/WULF/IREN/MSTU/MSTX/GLXY/SBET/…) as `"crypto-equity"` — used by `theme-cluster.ts`'s `resolveTheme`
for concentration risk (which is why "Book context" got it right) and by nothing in
`industry-group-rs.ts` (which is why "Industry read" got it wrong). A THIRD, unrelated sector map
(`src/lib/sector-map.ts`'s `getSector`, used only as `industry-group-rs.ts`'s Tier-3 zero-IO fallback)
independently classifies MSTR/COIN as `"Tech"` — a different label, from a different file, that would
ALSO have produced a wrong (XLK) benchmark for those two names had their SIC codes not resolved first.

### Blast radius

Any name `portfolio/sector-map.ts` classifies as `"crypto-equity"` was exposed via either path:
- A SIC that happens to fall in a `sectorEtfFromSic` range (confirmed for HUT: 6199 → XLF).
- No/unmapped SIC, falling through to `sector-map.ts`'s independent (and sometimes wrong-in-a-different-way)
  static label (MSTR/COIN → "Tech" → XLK).

The fix (below) is theme-general, not HUT-specific, so it closes every current and future crypto-equity
name in `portfolio/sector-map.ts`'s list — not just the one instance caught live.

### Fix

Added a `NO_SECTOR_BENCHMARK_THEMES` guard to `resolveGroupBenchmark`, checked right after the existing
`tickerType === "ETF"` guard and before any SIC/label resolution: a ticker whose `portfolio/sector-map.ts`
`sectorFor()` theme is `"crypto-equity"` gets no benchmark at all (`null`), same as this file's own
documented "honest absence over mislabel" design for every other unresolvable case. `sectorFor` is
pure/zero-IO, so importing it doesn't violate this module's own "PURE & deterministic — no IO" contract.

**Why null, not a crypto benchmark ETF:** inventing a crypto-sector proxy (e.g. BITQ/BLOK/WGMI) and
routing these names to it would be a real, standalone product decision (which ETF, is it liquid enough for
a 10-session RS read, does it match this module's existing "genuinely represents the SIC's constituents"
bar) — out of scope for a CARVE-OUT bug fix. `null` is the fix this module's own stated design already
calls for: *"a null here means SECTOR_ROTATION simply doesn't fire — the whole point: no industry-group RS
⇒ no rotation label, rather than a SPY-RS mislabel."* Exactly that principle applied one theme wider.

### Evidence

- RED→GREEN: `src/lib/swing/industry-group-rs.test.ts` — new test asserts `resolveGroupBenchmark({ticker:
  "HUT", sicCode: "6199", sicDescription: "FINANCE SERVICES"})` is `null` (was `{etf:"XLF",...}` pre-fix,
  confirmed via `git stash` isolation), plus the same guard for MSTR/COIN via the sector-map-label path, and
  a same-SIC-different-ticker control (JPM/6021 still resolves KBE — the guard is ticker-scoped via the
  theme lookup, not SIC-scoped).
- `npx tsc --noEmit` — clean.
- Collateral suite green: `industry-group-rs.test.ts` (13/13), `swing-ingest.test.ts`, `dossier.test.ts`,
  `archetype.test.ts`, `swing-pillars.test.ts` (42/42 combined).
- Live Polygon confirmation: `GET /v3/reference/tickers/HUT` → `sic_code: "6199"`, `sic_description:
  "FINANCE SERVICES"`.

### What was deliberately left unchanged

- `src/lib/sector-map.ts` (the flow-aggregation map that independently classifies MSTR/COIN as "Tech") was
  NOT touched — it's a separate, pre-existing system serving a different consumer (UW flow aggregation
  display), and reconciling all three sector-classification files into one is a larger unification a
  CARVE-OUT PR shouldn't attempt unilaterally. The fix here closes the SWING SECTOR_ROTATION mislabel
  specifically, which is the concrete, evidenced bug.
- No change to `sectorEtfFromSic`'s 6000-6499→XLF rule itself — it's correct for genuine finance-services
  SICs; the fix scopes the exclusion to the theme, not the SIC range.
