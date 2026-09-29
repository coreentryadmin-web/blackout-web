import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTheme,
  sameThesis,
  BROAD_MARKET_THEME,
  ETF_PROXY_THEMES,
  CORRELATION_THEMES,
} from "./theme-cluster.ts";

test("SEV-9 invariant: sameThesis('QQQ','NVDA') === true", () => {
  assert.equal(sameThesis("QQQ", "NVDA"), true);
});

test("NVDA + AMD + SMH + QQQ collapse to ONE cluster (semis)", () => {
  const themes = ["NVDA", "AMD", "SMH", "QQQ"].map(resolveTheme);
  assert.equal(new Set(themes).size, 1, `expected one cluster, got ${JSON.stringify(themes)}`);
  assert.equal(themes[0], "semis");
  // pairwise sameThesis across all four
  const names = ["NVDA", "AMD", "SMH", "QQQ"];
  for (const a of names) for (const b of names) assert.equal(sameThesis(a, b), true, `${a}~${b}`);
});

test("ETF proxy override wins over the index label (QQQ → semis, not broad-market)", () => {
  assert.equal(ETF_PROXY_THEMES.QQQ, "semis");
  assert.equal(resolveTheme("QQQ"), "semis");
  assert.equal(resolveTheme("qqq"), "semis"); // case-insensitive
});

test("broad-market complex clusters together (seeded from governor group)", () => {
  assert.equal(resolveTheme("SPY"), BROAD_MARKET_THEME);
  assert.equal(resolveTheme("IWM"), BROAD_MARKET_THEME);
  assert.equal(resolveTheme("XSP"), BROAD_MARKET_THEME); // governor-only name (sectorFor misses it)
  assert.equal(sameThesis("SPY", "IWM"), true);
  assert.ok((CORRELATION_THEMES[BROAD_MARKET_THEME] as ReadonlySet<string>).has("SPY"));
});

test("QQQ (proxied to semis) is NOT the same thesis as SPY (broad-market)", () => {
  assert.equal(sameThesis("QQQ", "SPY"), false);
});

test("unmapped names get their OWN cluster — never a false merge", () => {
  assert.notEqual(resolveTheme("ZZZZ"), resolveTheme("YYYY"));
  assert.equal(sameThesis("ZZZZ", "YYYY"), false);
  assert.equal(sameThesis("ZZZZ", "ZZZZ"), true); // a name matches itself
});

test("empty / null side never matches", () => {
  assert.equal(sameThesis("", "NVDA"), false);
  assert.equal(sameThesis(null, "NVDA"), false);
  assert.equal(sameThesis("NVDA", undefined), false);
});

test("themed sectors resolve via sectorFor (crypto-equity, china-adr)", () => {
  assert.equal(resolveTheme("COIN"), "crypto-equity");
  assert.equal(sameThesis("COIN", "MSTR"), true);
  assert.equal(resolveTheme("BABA"), "china-adr");
  assert.equal(sameThesis("BABA", "COIN"), false);
});

test("leveraged MSTR ETFs + Galaxy Digital + SBET cluster with crypto-equity (#4076 live finding: MSTU+MSTX book, no flag)", () => {
  assert.equal(resolveTheme("MSTU"), "crypto-equity");
  assert.equal(resolveTheme("MSTX"), "crypto-equity");
  assert.equal(resolveTheme("GLXY"), "crypto-equity");
  assert.equal(resolveTheme("SBET"), "crypto-equity");
  assert.equal(sameThesis("MSTU", "MSTX"), true);
  assert.equal(sameThesis("MSTU", "MSTR"), true);
  assert.equal(sameThesis("GLXY", "COIN"), true);
  assert.equal(sameThesis("SBET", "MSTR"), true);
});

test("single-stock leveraged ETFs cluster with their own underlying only, never each other (#4076 batch 26: RBLU/GMEU/SOFX live)", () => {
  assert.equal(sameThesis("RBLU", "RBLX"), true);
  assert.equal(sameThesis("GMEU", "GME"), true);
  assert.equal(sameThesis("SOFX", "SOFI"), true);
  assert.equal(sameThesis("RBLU", "GMEU"), false);
  assert.equal(sameThesis("GMEU", "SOFX"), false);
  // PLTU joins PLTR's existing software cluster.
  assert.equal(sameThesis("PLTU", "PLTR"), true);
  assert.equal(sameThesis("PLTU", "CRM"), true); // same "software" cluster as PLTR
});

test("XRP wrapper tickers cluster with each other, not with crypto-equity mining/holding names (#4076: XRP+XRPZ+XXRP book, no flag)", () => {
  assert.equal(ETF_PROXY_THEMES.XRP, "crypto-xrp");
  assert.equal(resolveTheme("XRP"), "crypto-xrp");
  assert.equal(resolveTheme("xrpz"), "crypto-xrp"); // case-insensitive
  assert.equal(sameThesis("XRP", "XRPZ"), true);
  assert.equal(sameThesis("XRPZ", "XXRP"), true);
  // Deliberately NOT the same cluster as equity crypto proxies — a token's own price is a different
  // risk driver than mining/holding-company equity beta.
  assert.equal(sameThesis("XRP", "COIN"), false);
});

test("crypto exchanges, miners, and BTC/ETH trust/ETF wrappers cluster with crypto-equity (2026-09-20 live finding: 2026-09-18 Banger batch undercounted real book concentration 11 vs ~25 same-direction positions)", () => {
  // Exchanges/custodians — same risk bucket as COIN.
  assert.equal(resolveTheme("GEMI"), "crypto-equity");
  assert.equal(resolveTheme("BKKT"), "crypto-equity");
  assert.equal(resolveTheme("ABTC"), "crypto-equity");
  assert.equal(resolveTheme("BLSH"), "crypto-equity");
  // Miners — same risk bucket as MARA/RIOT/CLSK/HUT/IREN.
  assert.equal(resolveTheme("BMNR"), "crypto-equity");
  assert.equal(resolveTheme("BTDR"), "crypto-equity");
  // Direct BTC/ETH trust/ETF wrappers — not equities, but an even more direct crypto-price read than
  // the mining/holding equities already in the bucket.
  assert.equal(resolveTheme("ETH"), "crypto-equity");
  assert.equal(resolveTheme("ETHE"), "crypto-equity");
  assert.equal(resolveTheme("ETHU"), "crypto-equity");
  assert.equal(resolveTheme("ETHA"), "crypto-equity");
  assert.equal(resolveTheme("IBIT"), "crypto-equity");
  assert.equal(resolveTheme("GBTC"), "crypto-equity");
  assert.equal(resolveTheme("BITO"), "crypto-equity");
  assert.equal(resolveTheme("BITX"), "crypto-equity");
  assert.equal(sameThesis("GEMI", "COIN"), true);
  assert.equal(sameThesis("BMNR", "RIOT"), true);
  assert.equal(sameThesis("ETH", "IBIT"), true);
  assert.equal(sameThesis("ETHE", "MSTR"), true);
});

test("quantum-computing pure-plays cluster together, not each in its own isolated cluster (2026-09-25 live finding: RGTI+QBTS+IONQ concurrent LONG book, no Book-context concentration flag)", () => {
  assert.equal(resolveTheme("RGTI"), "quantum-computing");
  assert.equal(resolveTheme("QBTS"), "quantum-computing");
  assert.equal(resolveTheme("IONQ"), "quantum-computing");
  assert.equal(resolveTheme("QUBT"), "quantum-computing");
  assert.equal(sameThesis("RGTI", "QBTS"), true);
  assert.equal(sameThesis("RGTI", "IONQ"), true);
  assert.equal(sameThesis("QBTS", "QUBT"), true);
  // Not merged into an unrelated theme (e.g. semis) just because both are "tech".
  assert.equal(sameThesis("RGTI", "NVDA"), false);
});

test("AI-datacenter connectivity chips + semis-equipment names cluster into semis, not their own isolated clusters (2026-09-25 live finding: ALAB+CRDO+KLAC+LRCX+INTC concurrent LONG book, no Book-context concentration flag)", () => {
  assert.equal(resolveTheme("ALAB"), "semis");
  assert.equal(resolveTheme("CRDO"), "semis");
  assert.equal(resolveTheme("KLAC"), "semis");
  assert.equal(sameThesis("ALAB", "CRDO"), true);
  assert.equal(sameThesis("ALAB", "NVDA"), true);
  assert.equal(sameThesis("KLAC", "LRCX"), true);
  // Not merged into an unrelated theme just because both are "tech".
  assert.equal(sameThesis("ALAB", "AAPL"), false);
});
