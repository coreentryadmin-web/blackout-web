/**
 * TICKER → SECTOR / THEME map for the Allocation Engine's duplicate-thesis clustering.
 *
 * The allocation layer clusters by (sector, direction) so NVDA/AMD/SMCI all-bullish reads as one semis
 * thesis, not three edges. That needs a ticker→theme lookup. This is a curated static map of the liquid,
 * high-flow options universe the 0DTE board actually surfaces — deliberately THEME-grained (not raw GICS):
 * "semis", "crypto-equity", "china-adr" cluster the way a trader's RISK does, which is what concentration is
 * really about. Unknown tickers return null → the Allocation Engine keys them by ticker (their own cluster),
 * so an unmapped name is NEVER falsely merged into a shared thesis.
 *
 * PURE. Extend as new names show up on the board; a later slice can fall back to a live Polygon/UW sector
 * lookup for the long tail, but this covers the names that actually cluster in practice.
 */

const SECTORS: Record<string, string[]> = {
  "index-etf": ["SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "RUT"],
  // Added 2026-09-25 (Ask Largo standing mandate, live finding): a real committed book held ALAB
  // (x3) + CRDO (x2) concurrently LONG alongside KLAC/LRCX/INTC — same real semis/AI-datacenter-
  // infra concentration checkPortfolioOverlap should catch but couldn't, since ALAB/CRDO/KLAC had
  // no entry here. ALAB (Astera Labs) and CRDO (Credo Technology) are AI-datacenter connectivity-
  // chip plays (PCIe/CXL retimers, SerDes/optical DSP) — same risk bucket as the AI-infra names
  // already listed (NVDA/AVGO/MRVL). KLAC (KLA Corp) is semis-equipment/process-control — the
  // identical subsector as the already-listed LRCX/AMAT. Live-verified: ALAB#1139's and CRDO#1136's
  // Book-context sections reported only same-ticker concentration, never the cross-ticker basket.
  // Same gap shape/fix pattern as the 2026-09-20 crypto-equity and 2026-09-25 quantum-computing
  // extensions above.
  // Extended 2026-10-07 (Ask Largo standing mandate, live finding, same gap shape as the ALAB/
  // CRDO/KLAC and crypto-equity leveraged-wrapper extensions above): a real committed book held
  // SMCI LONG (MANAGING) *and* SMCX — "Defiance Daily Target 2X Long SMCI ETF" — LONG (MANAGING)
  // at the same time, and separately MU LONG (WATCH) alongside MULL — "GraniteShares 2x Long MU
  // Daily ETF" — LONG (MANAGING): the identical underlying stock held twice through a plain and a
  // leveraged wrapper, same shape as the already-fixed MSTR/MSTU/MSTX and RBLX/RBLU precedent, but
  // unlike those pairs SMCI/MU already have an established peer bucket here (semis), so the
  // leveraged wrapper joins that bucket directly rather than getting its own isolated pair.
  // AVGX ("Defiance Daily Target 2X Long AVGO ETF") is the same wrapper shape on AVGO, already
  // listed below — added proactively for when the book holds it too (not yet live at time of
  // writing, but the gap is identical in kind). Verified ticker identity via Polygon reference
  // (`/v3/reference/tickers/<T>`) before adding, not guessed from the symbol alone.
  // MTSI added 2026-10-08 (Ask Largo standing mandate, live finding, same gap shape as the
  // ALAB/CRDO/KLAC extension above): a real committed book held MTSI LONG (MANAGING, Breakout
  // continuation) concurrently with SMCI/INTC/SMCX/MULL/AVGX/MRVL — all already in this list —
  // but MTSI itself had no entry anywhere in this map, so `checkPortfolioOverlap` resolved it to
  // its own isolated `NAME:MTSI` cluster and MTSI's live play-brief rendered NO "Book context"
  // section at all, hiding a real 7-name same-direction semis concentration from the one ticker
  // whose brief should have shown it. MTSI (MACOM Technology Solutions Holdings) is confirmed via
  // Polygon reference (`sic_code: "3674"`, "SEMICONDUCTORS & RELATED DEVICES") — not guessed from
  // the symbol — and the SAME live play-brief's own independently-sourced "Peers" line already
  // named LRCX and KLAC, both already in this list, corroborating the classification.
  semis: ["NVDA", "AMD", "SMCI", "MU", "AVGO", "TSM", "INTC", "ARM", "MRVL", "QCOM", "ASML", "LRCX", "AMAT", "TXN", "ON", "NXPI", "ALAB", "CRDO", "KLAC", "SMCX", "MULL", "AVGX", "MTSI"],
  // AMZU ("Direxion Daily AMZN Bull 2X ETF") added 2026-10-07 for the same reason as SMCX/MULL
  // above — AMZN already has a peer bucket here, so its leveraged wrapper joins it directly.
  megatech: ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "AMZU"],
  // PLTU is a leveraged single-stock ETF tracking PLTR itself — same bet, different wrapper.
  software: ["PLTR", "PLTU", "CRM", "NOW", "SNOW", "ADBE", "ORCL", "CRWD", "NET", "DDOG", "PANW", "MDB", "ZS", "SHOP"],
  "ev-auto": ["TSLA", "RIVN", "LCID", "F", "GM"],
  financials: ["JPM", "GS", "BAC", "MS", "WFC", "C", "SCHW", "BLK", "AXP", "V", "MA"],
  energy: ["XOM", "CVX", "OXY", "SLB", "COP", "MPC", "PSX", "DVN", "HAL"],
  // MSTU/MSTX are leveraged single-stock ETFs tracking MSTR itself — same bet, different wrapper.
  // GLXY (Galaxy Digital) and SBET (crypto-treasury) are crypto-holdings proxies in the same risk
  // bucket as COIN/MARA/etc.
  // Extended 2026-09-20 (Ask Largo standing mandate, live repro: a 2026-09-18 Banger-promoted swing
  // batch of 36 positions was, per checkPortfolioOverlap's own "Book overlap" evidence line, reporting
  // only 11 same-direction crypto-equity positions when the live book actually held ~25+ crypto-price-
  // correlated names — every one of the additions below was live and committed at the time this was
  // found). GEMI (Gemini Space Station), BKKT (Bakkt), ABTC (American Bitcoin Corp) and BLSH (Bullish)
  // are crypto exchanges/custodians — same risk bucket as COIN. BMNR (Bitmine Immersion) and BTDR
  // (Bitdeer) are bitcoin miners — same risk bucket as MARA/RIOT/CLSK/HUT/IREN. ETH, ETHE, ETHU, ETHA
  // are direct Ethereum trust/ETF wrappers and IBIT, GBTC, BITO, BITX are direct Bitcoin trust/ETF
  // wrappers — not equities, but an EVEN MORE direct crypto-price read than the mining/holding equities
  // already in this bucket, so they belong in the same concentration cluster, not their own isolated
  // one. Deliberately conservative: left out names with only partial/ambiguous crypto correlation
  // (HOOD, CRCL, APLD, BULL) rather than over-reaching this pass.
  //
  // Added 2026-10-07 (Ask Largo standing mandate, live finding): ASST (Strive, Inc. — the former
  // "Asset Entities" shell that converted to a bitcoin-treasury company in 2025, same corporate
  // structure as MSTR/Strategy) was live on the Swing WATCH lane and unmapped here, so it fell
  // through `resolveGroupBenchmark` (industry-group-rs.ts) straight into the SIC-range fallback —
  // Polygon classifies it under a generic finance/holding SIC, landing in the 6000-6499 Financials
  // range exactly like HUT did before HUT was added to this same list (see that 2026-09-20 note
  // above). Live play-brief for ASST cited "leading Financials (XLF) by 2.8%" as a real score
  // pillar input for a bitcoin-treasury name — the identical mislabel this list exists to prevent,
  // just on a name added to the list later than its peers.
  "crypto-equity": [
    "COIN", "MARA", "RIOT", "MSTR", "CLSK", "HUT", "CIFR", "BITF", "WULF", "IREN", "MSTU", "MSTX", "GLXY", "SBET",
    "GEMI", "BKKT", "ABTC", "BLSH", "BMNR", "BTDR", "ASST",
    "ETH", "ETHE", "ETHU", "ETHA", "IBIT", "GBTC", "BITO", "BITX",
  ],
  "china-adr": ["BABA", "PDD", "NIO", "JD", "BIDU", "LI", "XPEV", "FUTU"],
  // Added 2026-09-25 (Ask Largo standing mandate, live finding): a real committed book held RGTI+QBTS+IONQ
  // concurrently LONG (same TACTICAL/BREAKOUT batch) — all unmapped, so checkPortfolioOverlap reported no
  // concentration for a genuinely correlated 3-name basket (each resolved to its own isolated cluster).
  // Same gap shape/fix as the 2026-09-20 crypto-equity extension above. RGTI (Rigetti), QBTS (D-Wave),
  // IONQ (IonQ) and QUBT (Quantum Computing Inc) are the four liquid, options-active pure-play quantum-
  // computing names that trade as one basket-level bet — deliberately conservative (per the crypto-equity
  // precedent's own note), leaving out names with only partial/ambiguous quantum exposure.
  "quantum-computing": ["RGTI", "QBTS", "IONQ", "QUBT"],
  consumer: ["NKE", "SBUX", "MCD", "DIS", "WMT", "COST", "TGT", "LULU", "CMG"],
  healthcare: ["LLY", "UNH", "PFE", "JNJ", "MRNA", "ABBV", "TMO", "AMGN"],
  "ai-power": ["VST", "CEG", "NEE", "GEV", "OKLO", "SMR", "ASTS"],
  // Single-stock leveraged ETFs whose underlying has no existing themed peer — each pair is its OWN
  // cluster (never merged with an unrelated leveraged-ETF pair) so RBLU only overlaps with RBLX, etc.
  roblox: ["RBLX", "RBLU"],
  gamestop: ["GME", "GMEU"],
  sofi: ["SOFI", "SOFX"],
  // Added 2026-10-07 (Ask Largo standing mandate, live finding): a real committed book held GLW
  // (Corning, plain equity) *and* GLWG ("Leverage Shares 2X Long GLW Daily ETF") LONG in MANAGING
  // at the same time — the literal same stock, held twice through a plain and a leveraged wrapper,
  // completely invisible to `checkPortfolioOverlap` because GLW had no entry anywhere in this map
  // at all (not even its own name), so both resolved to DIFFERENT `NAME:<ticker>` own-clusters
  // (`NAME:GLW` vs `NAME:GLWG`) instead of the one cluster they actually are. GLW has no existing
  // themed peer here (it is not a semis name), so — same precedent as roblox/gamestop/sofi above —
  // it gets its own small pair cluster rather than being folded into an unrelated bucket.
  corning: ["GLW", "GLWG"],
  // Added 2026-10-10 (Ask Largo standing mandate, live finding): a real committed Swing book held
  // NTLA+CRSP+VIR+MIRM+IONS+NVAX+IOVA+PCVX+TNGX+RLAY concurrently LONG — ten clinical/commercial-
  // stage biotech names whose dominant risk driver is the SAME binary catalyst (FDA decision,
  // clinical trial readout), not ten independent edges — and `checkPortfolioOverlap` reported
  // concentration only on the two names that happened to repeat (NTLA, IOVA each held twice),
  // never the cross-ticker biotech basket, because none of these tickers had any entry anywhere
  // in this map (same gap shape as the quantum-computing/semis/crypto-equity extensions above).
  // Each identity verified via Polygon reference (`/v3/reference/tickers/<T>`) before adding, not
  // guessed from the symbol alone: NTLA (Intellia Therapeutics, gene editing), CRSP (CRISPR
  // Therapeutics, gene editing), VIR (Vir Biotechnology), MIRM (Mirum Pharmaceuticals), IONS
  // (Ionis Pharmaceuticals), NVAX (Novavax), IOVA (Iovance Biotherapeutics, cell therapy), PCVX
  // (Vaxcyte, vaccines), TNGX (Tango Therapeutics, oncology), RLAY (Relay Therapeutics, precision
  // oncology) — SIC 2834/2835/2836 (pharmaceutical preparations / biological products) throughout.
  // Deliberately conservative, same discipline as the crypto-equity/quantum-computing precedents:
  // left out names that were ALSO live in the same book but trade on a materially different risk
  // driver rather than a clinical/regulatory binary catalyst — RGEN (Repligen) sells bioprocessing
  // equipment/tools TO biotech manufacturers (steady recurring picks-and-shovels revenue, not a
  // trial-readout bet), GRAL (GRAIL) is a diagnostics-services company (SIC 8071, medical
  // laboratories) whose catalyst is commercial adoption of a cancer-detection test rather than a
  // drug trial, and ABSI (Absci, SIC 8731 commercial biological research) is an AI drug-discovery
  // PLATFORM company monetized via partnerships, not a clinical-stage therapeutics developer —
  // each left unmapped (its own `NAME:` cluster) rather than folded into this bucket, matching the
  // existing "never falsely merge" posture elsewhere in this file. The existing `healthcare`
  // bucket above is deliberately left untouched — it is large-cap diversified pharma/managed-care
  // (LLY/UNH/PFE/JNJ/ABBV/TMO/AMGN), a different risk profile from this small/mid-cap clinical-
  // catalyst cluster; reclassifying MRNA (also in `healthcare` today, arguably closer to this
  // bucket's risk profile) is a separate question out of scope for this fix.
  biotech: ["NTLA", "CRSP", "VIR", "MIRM", "IONS", "NVAX", "IOVA", "PCVX", "TNGX", "RLAY"],
};

// Inverted once at module load: TICKER → sector.
const TICKER_TO_SECTOR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [sector, tickers] of Object.entries(SECTORS)) for (const t of tickers) m[t] = sector;
  return m;
})();

/** Theme/sector for a ticker, or null when unmapped (→ its own cluster, never a false shared thesis). */
export function sectorFor(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  return TICKER_TO_SECTOR[ticker.trim().toUpperCase()] ?? null;
}

/** The full inverted map (for tooling / coverage checks). */
export const KNOWN_SECTORS = Object.freeze({ ...TICKER_TO_SECTOR });
