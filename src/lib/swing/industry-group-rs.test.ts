import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGroupBenchmark,
  industryGroupRs01,
  INDUSTRY_ETF_BY_SIC,
  SECTOR_ETF_BY_LABEL,
} from "./industry-group-rs.ts";

// pctReturnOverSessions (internal) reads only closes[0] and closes[len-1] for a length-(n+1) array, so a
// series pinned to {past, last} yields an exact n-session return regardless of the middle values.
const mk = (past: number, last: number): number[] => {
  const a = Array(11).fill(past);
  a[10] = last;
  return a;
};

test("resolveGroupBenchmark: exact SIC → INDUSTRY ETF (finest), live-probed codes", () => {
  // NVDA/AMD 3674, JPM 6021, PLTR 7372, NEM 1040, DAL 4512 (all confirmed live 2026-07-24).
  assert.deepEqual(resolveGroupBenchmark({ ticker: "NVDA", sicCode: "3674" }), { etf: "SMH", label: "Semiconductors", kind: "industry" });
  assert.deepEqual(resolveGroupBenchmark({ ticker: "JPM", sicCode: "6021" }), { etf: "KBE", label: "Banks", kind: "industry" });
  assert.deepEqual(resolveGroupBenchmark({ ticker: "PLTR", sicCode: "7372" }), { etf: "IGV", label: "Software", kind: "industry" });
  assert.deepEqual(resolveGroupBenchmark({ ticker: "NEM", sicCode: "1040" }), { etf: "GDX", label: "Gold miners", kind: "industry" });
  assert.deepEqual(resolveGroupBenchmark({ ticker: "DAL", sicCode: "4512" }), { etf: "JETS", label: "Airlines", kind: "industry" });
});

test("resolveGroupBenchmark: SIC range → the right SECTOR ETF when no tight industry ETF applies", () => {
  // AAPL 3571 electronic computers → Tech; LLY 2834 pharma → Health Care; NEE 4911 electric → Utilities;
  // TSLA 3711 autos → Cons.Disc; AMZN 5961 retail → Cons.Disc; CAT 3531 machinery → Industrials.
  assert.equal(resolveGroupBenchmark({ ticker: "AAPL", sicCode: "3571" })?.etf, "XLK");
  assert.equal(resolveGroupBenchmark({ ticker: "LLY", sicCode: "2834" })?.etf, "XLV");
  assert.equal(resolveGroupBenchmark({ ticker: "NEE", sicCode: "4911" })?.etf, "XLU");
  assert.equal(resolveGroupBenchmark({ ticker: "TSLA", sicCode: "3711" })?.etf, "XLY");
  assert.equal(resolveGroupBenchmark({ ticker: "AMZN", sicCode: "5961" })?.etf, "XLY");
  assert.equal(resolveGroupBenchmark({ ticker: "CAT", sicCode: "3531" })?.etf, "XLI");
  // range hits are labelled "sector", not "industry".
  assert.equal(resolveGroupBenchmark({ ticker: "AAPL", sicCode: "3571" })?.kind, "sector");
});

test("resolveGroupBenchmark: no SIC → static sector-map label fallback (zero-IO)", () => {
  // XOM has no SIC in Polygon (confirmed live) → resolve from its sector-map label.
  assert.deepEqual(resolveGroupBenchmark({ ticker: "XOM", sectorLabel: "Energy" }), { etf: "XLE", label: "Energy", kind: "sector" });
  assert.equal(resolveGroupBenchmark({ ticker: "GS", sectorLabel: "Financials" })?.etf, "XLF");
});

test("resolveGroupBenchmark: honest nulls — ETF candidate, self-benchmark, unresolvable", () => {
  // An ETF candidate has no 'own group' to lead.
  assert.equal(resolveGroupBenchmark({ ticker: "SMH", tickerType: "ETF", sicCode: "3674" }), null);
  // A name can't have relative strength against itself (candidate IS the sector ETF).
  assert.equal(resolveGroupBenchmark({ ticker: "XLK", sectorLabel: "Tech" }), null);
  // No SIC, no known sector label → null (SECTOR_ROTATION simply won't fire — better than a SPY-RS mislabel).
  assert.equal(resolveGroupBenchmark({ ticker: "WXYZ", sectorLabel: "Other" }), null);
  assert.equal(resolveGroupBenchmark({ ticker: "WXYZ" }), null);
  // Wholesale (51xx) is deliberately unmapped → falls through to null when there's no static label.
  assert.equal(resolveGroupBenchmark({ ticker: "WXYZ", sicCode: "5122" }), null);
});

test("resolveGroupBenchmark: 'Indices'/'Other' labels never resolve (no rotation thesis on SPY/QQQ)", () => {
  assert.equal(SECTOR_ETF_BY_LABEL["Indices"], undefined);
  assert.equal(SECTOR_ETF_BY_LABEL["Other"], undefined);
  assert.equal(resolveGroupBenchmark({ ticker: "SPY", sectorLabel: "Indices" }), null);
});

test("industryGroupRs01: name OUTperforming its group scores > 0; UNDERperforming clamps to 0", () => {
  const nameUp5 = mk(100, 105); // +5% over 10 sessions
  const groupUp2 = mk(100, 102); // +2%
  // LONG: (5 − 2)/6 = 0.5 (relativeStrengthScore band = 6, only outperformance counts).
  assert.equal(industryGroupRs01({ nameCloses: nameUp5, benchmarkCloses: groupUp2, direction: "LONG" }), 0.5);
  // LONG underperformer: name +1% vs group +2% → clamped to 0.
  assert.equal(industryGroupRs01({ nameCloses: mk(100, 101), benchmarkCloses: groupUp2, direction: "LONG" }), 0);
});

test("industryGroupRs01: SHORT mirror — leading the group DOWN reads identically to its LONG mirror", () => {
  // SHORT: name −5% (leading down) vs group −2% → both negated → (5 − 2)/6 = 0.5, same as the LONG mirror.
  const nameDown5 = mk(100, 95);
  const groupDown2 = mk(100, 98);
  assert.equal(industryGroupRs01({ nameCloses: nameDown5, benchmarkCloses: groupDown2, direction: "SHORT" }), 0.5);
});

test("industryGroupRs01: honest null on no direction / no benchmark / thin history", () => {
  const up = mk(100, 105);
  assert.equal(industryGroupRs01({ nameCloses: up, benchmarkCloses: mk(100, 102), direction: null }), null);
  assert.equal(industryGroupRs01({ nameCloses: up, benchmarkCloses: null, direction: "LONG" }), null);
  assert.equal(industryGroupRs01({ nameCloses: up, benchmarkCloses: [], direction: "LONG" }), null);
  // Too few benchmark closes for a 10-session return → null (never a fabricated 0).
  assert.equal(industryGroupRs01({ nameCloses: up, benchmarkCloses: [100, 101, 102], direction: "LONG" }), null);
});

test("map integrity: every INDUSTRY_ETF_BY_SIC key is a 3–4 digit SIC; sector labels are the 11 SPDRs", () => {
  for (const sic of Object.keys(INDUSTRY_ETF_BY_SIC)) assert.match(sic, /^\d{3,4}$/);
  assert.equal(Object.keys(SECTOR_ETF_BY_LABEL).length, 11);
  for (const etf of Object.values(SECTOR_ETF_BY_LABEL)) assert.match(etf, /^XL[A-Z]{1,2}$/);
});
