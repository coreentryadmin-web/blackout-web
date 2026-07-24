// src/lib/swing/industry-group-rs.ts — the INDUSTRY-GROUP relative-strength feed for SECTOR_ROTATION.
//
// WHY THIS EXISTS (operator directive + critique #6): a "sector rotation" thesis is only real when a name
// LEADS ITS OWN INDUSTRY GROUP as capital rotates in — NOT when it merely outperforms SPY. The archetype
// classifier historically had no industry-group RS feed, so `fitSectorRotation` fell through to the coarse
// name-vs-SPY relative strength (`relStrength01`). That MISLABELS: in a broad rally almost every name beats
// SPY, so SECTOR_ROTATION fired on names that were simply riding the tape, not rotating within their group.
//
// This module supplies the missing piece: resolve a name's INDUSTRY-GROUP (or, failing that, its SECTOR)
// benchmark ETF, then measure the name's return vs THAT benchmark. Both providers ground it (live-probed
// 2026-07-24, see docs/audit/FINDINGS.md):
//   • Polygon `/v3/reference/tickers/{ticker}` → `sic_code` + `sic_description` (rate-limit-free reference).
//     e.g. NVDA/AMD → 3674 "SEMICONDUCTORS & RELATED DEVICES"; JPM → 6021 "NATIONAL COMMERCIAL BANKS".
//   • The 11 SPDR sector ETFs + industry ETFs (SMH/KBE/IGV/GDX/JETS/XOP/XHB) have daily closes on the same
//     `/v2/aggs` path the swing name-closes already use — so the benchmark's return series is one extra
//     (cacheable) daily-closes fetch, not a new pipeline.
//
// GRANULARITY LADDER (finest first, fail-soft): exact-SIC INDUSTRY ETF → SIC-range SECTOR ETF → static
// sector-map SECTOR ETF → null. A null is HONEST ABSENCE — the classifier then simply doesn't fire
// SECTOR_ROTATION for that name (far better than mislabeling it on SPY RS). CONSERVATIVE BY DESIGN: an
// industry ETF is only mapped where it genuinely represents the SIC's constituents (mis-benchmarking would
// re-introduce the very mislabel this fixes); everything ambiguous falls back to the sector ETF or null.
//
// PURE & deterministic — no IO. The IO (classify the ticker, fetch the benchmark closes) lives in the
// swing-ingest shell + the discovery cron; this file is just the maps + the RS math, unit-tested in isolation.

import type { PlayDirection } from "../horizon-fanout";
import { relativeStrengthScore } from "../horizon-scorers";

/** The benchmark a name's relative strength is measured against for the SECTOR_ROTATION thesis. */
export interface GroupBenchmark {
  /** The benchmark ETF symbol (uppercase). */
  etf: string;
  /** Human label for the group (surfaces in reasons / audits). */
  label: string;
  /** How fine the benchmark is: a true INDUSTRY-group ETF (SMH/KBE/…) or the coarser 11-way SECTOR ETF. */
  kind: "industry" | "sector";
}

/** What the resolver needs about a name to pick its benchmark — all optional, all fail-soft to a coarser tier. */
export interface GroupBenchmarkQuery {
  ticker: string;
  /** Polygon `sic_code` (4-digit string), or null when the reference lookup didn't ground it. */
  sicCode?: string | null;
  /** Polygon `sic_description` (provenance only — resolution keys off the numeric code). */
  sicDescription?: string | null;
  /** Polygon `type` ("CS", "ETF", …). An ETF candidate gets NO industry-group RS (rotation is a single-name thesis). */
  tickerType?: string | null;
  /** Static ticker→sector label from sector-map.ts (`getSector`) — the zero-IO fallback when SIC is absent. */
  sectorLabel?: string | null;
}

// ─── Tier 1: exact-SIC → INDUSTRY-group ETF (high-confidence tight groups ONLY) ─────────────────
// Each entry is an industry where a liquid ETF genuinely tracks that SIC's constituents. Keyed by the exact
// 4-digit Polygon SIC. Deliberately SMALL: an industry ETF that only loosely matches would re-create the
// mislabel, so anything not clearly representative is left to the sector tier. Codes are the ones live-probed
// (NVDA/AMD 3674, JPM 6021, PLTR 7372, NEM 1040, DAL 4512) plus their obvious siblings.
export const INDUSTRY_ETF_BY_SIC: Record<string, { etf: string; label: string }> = {
  // Semiconductors & related devices → SMH (VanEck Semiconductor).
  "3674": { etf: "SMH", label: "Semiconductors" },
  // Prepackaged / application software → IGV (iShares Expanded Tech-Software).
  "7372": { etf: "IGV", label: "Software" },
  // Depository / commercial banks → KBE (SPDR S&P Bank).
  "6020": { etf: "KBE", label: "Banks" },
  "6021": { etf: "KBE", label: "Banks" },
  "6022": { etf: "KBE", label: "Banks" },
  // Gold & silver ores (miners) → GDX (VanEck Gold Miners).
  "1040": { etf: "GDX", label: "Gold miners" },
  // Scheduled / air-courier air transportation → JETS (U.S. Global Jets).
  "4512": { etf: "JETS", label: "Airlines" },
  "4513": { etf: "JETS", label: "Airlines" },
  // Crude petroleum & natural gas (E&P) → XOP (SPDR S&P Oil & Gas E&P).
  "1311": { etf: "XOP", label: "Oil & gas E&P" },
  // Operative builders (homebuilders) → XHB (SPDR S&P Homebuilders).
  "1531": { etf: "XHB", label: "Homebuilders" },
};

// ─── Tier 3 fallback: static sector-map label → the 11 SPDR SECTOR ETFs ─────────────────────────
// The labels are exactly those emitted by sector-map.ts `getSector`. "Indices"/"Other" intentionally have
// NO benchmark — a rotation thesis on SPY/QQQ or an unknown-sector name is meaningless, so it stays null.
export const SECTOR_ETF_BY_LABEL: Record<string, string> = {
  Tech: "XLK",
  Financials: "XLF",
  Healthcare: "XLV",
  Energy: "XLE",
  "Cons.Disc.": "XLY",
  "Cons.Staples": "XLP",
  Industrials: "XLI",
  "Comm.Svc.": "XLC",
  Utilities: "XLU",
  Materials: "XLB",
  "Real Estate": "XLRE",
};

// ─── Tier 2: SIC major-group range → SECTOR ETF (broad coverage for any name with a SIC) ─────────
// A coarse but defensible SIC→GICS-sector bucketing so a name with a clean SIC always gets a real SECTOR
// benchmark even when it isn't in the (liquid-name-only) static sector-map. CONSERVATIVE: genuinely
// ambiguous major-groups (wholesale, some manufacturing) return null and fall through to the static label
// or honest absence, rather than guessing a sector. This is data, not edge — evidence-only, never sizes risk.
function sectorEtfFromSic(sic: number): { etf: string; label: string } | null {
  const XLB = { etf: "XLB", label: "Materials" };
  const XLE = { etf: "XLE", label: "Energy" };
  const XLI = { etf: "XLI", label: "Industrials" };
  const XLK = { etf: "XLK", label: "Technology" };
  const XLV = { etf: "XLV", label: "Health Care" };
  const XLP = { etf: "XLP", label: "Consumer Staples" };
  const XLY = { etf: "XLY", label: "Consumer Discretionary" };
  const XLF = { etf: "XLF", label: "Financials" };
  const XLC = { etf: "XLC", label: "Communication Services" };
  const XLU = { etf: "XLU", label: "Utilities" };
  const XLRE = { etf: "XLRE", label: "Real Estate" };

  // Mining & extraction (10xx metal, 12xx coal, 13xx oil&gas, 14xx nonmetallic).
  if (sic >= 1000 && sic <= 1099) return XLB;
  if (sic >= 1200 && sic <= 1399) return XLE;
  if (sic >= 1400 && sic <= 1499) return XLB;
  // Construction.
  if (sic >= 1500 && sic <= 1799) return XLI;
  // Food / beverage / tobacco.
  if (sic >= 2000 && sic <= 2199) return XLP;
  // Textiles & apparel.
  if (sic >= 2200 && sic <= 2399) return XLY;
  // Lumber / furniture / paper → Materials; printing & publishing → Comm.Svc.
  if (sic >= 2400 && sic <= 2699) return XLB;
  if (sic >= 2700 && sic <= 2799) return XLC;
  // Chemicals: pharma/biologicals (283x) → Health Care; the rest → Materials.
  if (sic >= 2830 && sic <= 2836) return XLV;
  if (sic >= 2800 && sic <= 2899) return XLB;
  // Petroleum refining.
  if (sic >= 2900 && sic <= 2999) return XLE;
  // Rubber/plastics/leather/stone/glass/primary-metal → Materials.
  if (sic >= 3000 && sic <= 3399) return XLB;
  // Fabricated metal.
  if (sic >= 3400 && sic <= 3499) return XLI;
  // Machinery & computers: computers (357x) → Tech; other machinery → Industrials.
  if (sic >= 3570 && sic <= 3579) return XLK;
  if (sic >= 3500 && sic <= 3599) return XLI;
  // Electronic & electrical equipment (semis 3674 handled by the industry tier) → Tech.
  if (sic >= 3600 && sic <= 3699) return XLK;
  // Transportation equipment: motor vehicles (371x) → Cons.Disc; aerospace/other → Industrials.
  if (sic >= 3710 && sic <= 3716) return XLY;
  if (sic >= 3700 && sic <= 3799) return XLI;
  // Instruments: medical/surgical (384x, 3851) → Health Care; the rest → Tech.
  if (sic >= 3840 && sic <= 3851) return XLV;
  if (sic >= 3800 && sic <= 3899) return XLK;
  // Misc manufacturing.
  if (sic >= 3900 && sic <= 3999) return XLY;
  // Transportation services (air 451x handled by the industry tier) → Industrials.
  if (sic >= 4000 && sic <= 4599) return XLI;
  // Communications.
  if (sic >= 4800 && sic <= 4899) return XLC;
  // Utilities (electric/gas/sanitary).
  if (sic >= 4900 && sic <= 4999) return XLU;
  // Retail: food stores → Staples; general retail → Cons.Disc.
  if (sic >= 5400 && sic <= 5499) return XLP;
  if (sic >= 5200 && sic <= 5999) return XLY;
  // Finance (banks 602x handled by the industry tier): depository/credit/brokers/insurance → Financials.
  if (sic >= 6000 && sic <= 6499) return XLF;
  // Real estate; REITs (6798) → Real Estate, other holding/investment → Financials.
  if (sic >= 6500 && sic <= 6599) return XLRE;
  if (sic === 6798) return XLRE;
  if (sic >= 6700 && sic <= 6799) return XLF;
  // Services: lodging/personal → Cons.Disc.
  if (sic >= 7000 && sic <= 7299) return XLY;
  // Business services: advertising (731x) → Comm.Svc; computer/software services → Tech.
  if (sic >= 7310 && sic <= 7319) return XLC;
  if (sic >= 7300 && sic <= 7399) return XLK;
  // Motion pictures / amusement → Comm.Svc.
  if (sic >= 7800 && sic <= 7999) return XLC;
  // Health services.
  if (sic >= 8000 && sic <= 8099) return XLV;
  // Everything else (wholesale 50xx-51xx, engineering/research 87xx, nonclassifiable 99xx) → no confident
  // sector → null (fall through to the static label or honest absence).
  return null;
}

/**
 * Resolve a name's SECTOR_ROTATION benchmark, finest-first: an exact-SIC INDUSTRY ETF, else a SIC-range
 * SECTOR ETF, else the static sector-map SECTOR ETF, else null (honest absence). PURE.
 *
 * Guards: an ETF candidate (`tickerType === "ETF"`) gets NO benchmark — rotation is a single-name thesis, and
 * a sector ETF has no "own group" to lead. And a resolved benchmark that IS the candidate itself (e.g. the
 * candidate is XLK) is dropped — a name can't have relative strength against itself.
 */
export function resolveGroupBenchmark(q: GroupBenchmarkQuery): GroupBenchmark | null {
  const ticker = String(q.ticker ?? "").trim().toUpperCase();
  if (!ticker) return null;
  if ((q.tickerType ?? "").toUpperCase() === "ETF") return null;

  let benchmark: GroupBenchmark | null = null;

  const sicRaw = (q.sicCode ?? "").trim();
  if (/^\d{3,4}$/.test(sicRaw)) {
    const industry = INDUSTRY_ETF_BY_SIC[sicRaw];
    if (industry) {
      benchmark = { etf: industry.etf, label: industry.label, kind: "industry" };
    } else {
      const sector = sectorEtfFromSic(Number(sicRaw));
      if (sector) benchmark = { etf: sector.etf, label: sector.label, kind: "sector" };
    }
  }

  // Fallback to the static sector-map label (zero-IO) when the SIC didn't resolve.
  if (!benchmark && q.sectorLabel) {
    const etf = SECTOR_ETF_BY_LABEL[q.sectorLabel];
    if (etf) benchmark = { etf, label: q.sectorLabel, kind: "sector" };
  }

  // Never benchmark a name against itself.
  if (benchmark && benchmark.etf === ticker) return null;
  return benchmark;
}

/** ~10-session lookback default (matches the swing momentum/rel-strength window). */
export const INDUSTRY_GROUP_RS_LOOKBACK = 10;

/** Local, cycle-free % return over `n` sessions from ascending closes (mirrors swing-ingest's helper; kept
 *  local so this pure module has no dependency back on the IO shell). Null when too short / bad reference. */
function pctReturnOverSessions(closes: number[], n: number): number | null {
  if (!Array.isArray(closes) || closes.length <= n) return null;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - n];
  if (!(past > 0) || !Number.isFinite(last)) return null;
  return ((last - past) / past) * 100;
}

/**
 * The industry-group relative-strength read (0–1) that GROUNDS `sectorLeadership01` and thus drives the
 * SECTOR_ROTATION fit. It is the name's return vs its GROUP benchmark's return over the lookback, DIRECTION-
 * SIGNED exactly like the SPY rel-strength pillar: for a SHORT both returns are negated so LEADING the group
 * DOWN scores as strength (a mirror SHORT reads identically to its LONG mirror). Reuses `relativeStrengthScore`
 * so the scale (only OUTperformance counts, 6% band) matches the rest of the engine.
 *
 * Null (honest absence, never a fabricated 0) when: no direction (not a directional swing), or either return
 * can't be computed (too little history / no benchmark closes). A null here means SECTOR_ROTATION simply
 * doesn't fire — the whole point: no industry-group RS ⇒ no rotation label, rather than a SPY-RS mislabel.
 */
export function industryGroupRs01(args: {
  nameCloses: number[];
  benchmarkCloses: number[] | null | undefined;
  direction: PlayDirection | null;
  lookback?: number;
}): number | null {
  const { nameCloses, benchmarkCloses, direction } = args;
  const lookback = args.lookback ?? INDUSTRY_GROUP_RS_LOOKBACK;
  if (!direction || !Array.isArray(benchmarkCloses) || benchmarkCloses.length === 0) return null;

  const nameRet = pctReturnOverSessions(nameCloses, lookback);
  const groupRet = pctReturnOverSessions(benchmarkCloses, lookback);
  if (nameRet == null || groupRet == null) return null;

  const sign = direction === "SHORT" ? -1 : 1;
  return relativeStrengthScore(sign * nameRet, sign * groupRet);
}
