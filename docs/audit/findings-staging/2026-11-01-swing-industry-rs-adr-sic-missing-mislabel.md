> **kind:** FINDING

## Swing `industry-group-rs.ts`: ADRs with no Polygon SIC (TSM/ASML/ARM) mislabel SECTOR_ROTATION as "Tech (XLK)" instead of "Semiconductors (SMH)" — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** Ask Largo × Night Hawk Swings standing ownership mandate, live deep-dive on
`GET /api/market/swing/play-brief` (2026-11-01, Sunday off-hours cycle, candidate: TSM, the sole
live WATCH-state swing candidate at the time — `SWING:TSM`, SHORT, Pullback continuation, score
51.7).

**Root cause:** `resolveGroupBenchmark()` in `src/lib/swing/industry-group-rs.ts` resolves a
name's SECTOR_ROTATION benchmark finest-first: exact-SIC INDUSTRY ETF → SIC-range SECTOR ETF →
static sector-map SECTOR ETF → null. Live-confirmed via Polygon's `/v3/reference/tickers/{ticker}`
(2026-11-01): TSM, ASML, and ARM all come back `type: "ADRC"` with **`sic_code: undefined`** —
Polygon never classifies these ADRs with a SIC at all — while their SIC-carrying semis peers
(NVDA/AMD/MU/AVGO/INTC/MRVL/AMAT/TXN/ON/NXPI/ALAB/CRDO/MTSI, all `sic_code: "3674"`) correctly
resolve to the SMH industry tier via `INDUSTRY_ETF_BY_SIC`. With no SIC to key off, TSM/ASML/ARM
fell straight through to the coarse static `sectorLabel` fallback — `src/lib/sector-map.ts` (the
*flow-aggregation* sector map, a different file from `portfolio/sector-map.ts`'s hand-curated
`semis` theme bucket that already lists all three alongside their SIC-3674 peers) hard-codes
`TSM: "Tech"`, which resolves to `XLK`. Exact same "mechanically-nearest-but-substantively-wrong
ETF" failure shape this file's own header already documents fixing for HUT (bitcoin miner →
Financials/XLF) and GE Aerospace (generic SIC "3600" → Technology/XLK) — just on the opposite side
of the ladder: those fixes blocked a resolvable-but-wrong match with `null`; this one routes a
genuinely unresolvable SIC to the *correct* tight industry tier instead of the coarse sector one.

**Live evidence:** TSM's live swing play-brief "Why this setup" section read "**Industry read:**
leading **Tech** (XLK) by 0.6% over 10 sessions (-1.6% vs -2.2%)" — comparing the world's largest
contract chipmaker against the entire broad tech sector (AAPL/MSFT/META/etc.) rather than its true
peer group. Confirmed the SIC gap directly:
```
TSM   sic=undefined type=ADRC  (MISSING-SIC)
ASML  sic=undefined type=ADRC  (MISSING-SIC)
ARM   sic=undefined type=ADRC  (MISSING-SIC)
NVDA  sic=3674       type=CS   (OK → SMH)
AMD   sic=3674       type=CS   (OK → SMH)
```
Swept the full `semis` theme bucket (`portfolio/sector-map.ts`) against live Polygon reference
data: of 22 non-ETF constituents, only these 3 ADR names have no SIC at all (the other no-SIC
entries, SMCX/MULL/AVGX/DRAM, are themselves ETFs and correctly get no benchmark via the existing
`tickerType === "ETF"` guard — not part of this bug).

**Fix:** added `ADR_SIC_MISSING_OVERRIDE`, a small hand-curated ticker→industry-ETF map (TSM,
ASML, ARM → SMH/Semiconductors — the same confirmed-correct benchmark their SIC-having peers
already get), checked in `resolveGroupBenchmark()` between the SIC tier and the static
`sectorLabel` fallback: only fires when the SIC lookup produced *nothing at all* (`!sicRaw`), never
overrides a real resolved SIC. Deliberately as narrow as `INDUSTRY_ETF_BY_SIC` itself — a ticker
must be independently confirmed (a) to carry no Polygon SIC and (b) to already sit in the
hand-curated `semis` bucket beside its SIC-3674 peers. Not a general "no SIC → guess" rule; an
unmapped no-SIC ADR still falls through to the static label or honest absence exactly as before.

**Evidence (RED → GREEN):** added a regression test (`resolveGroupBenchmark: a known no-SIC ADR
(TSM/ASML/ARM) resolves to its real industry ETF, not the coarse static sector label`) plus a
map-integrity test for the new override, in `src/lib/swing/industry-group-rs.test.ts`. RED (via
`git stash` on `industry-group-rs.ts` alone): 2 failing (the new resolution test — TSM/ASML/ARM
resolved `XLK`/`sector` instead of `SMH`/`industry` — and the map-integrity test, since the export
didn't exist). GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test
src/lib/swing/industry-group-rs.test.ts` → 17/17 pass; sibling `swing-ingest.test.ts` → 15/15 pass
(unaffected call sites, confirms no regression on the fail-soft/classifier-failure paths).
`npx tsc --noEmit`: clean.

**Blast radius:** one call site reaches this function in production —
`src/lib/swing/swing-ingest.ts:427`, feeding `sectorLeadership01`/`industryGroupRs01`/
`industryGroupRsFacts` for the `SECTOR_ROTATION` archetype thesis and the "Why this setup" /
"Industry read" narrative line on every swing candidate's Ask Largo play-brief. Scope: the 3
confirmed no-SIC semis ADRs (TSM/ASML/ARM) — any future semis ADR with the same gap shape is a
separate, independently-evidenced addition to the override map, not implied by this fix.
