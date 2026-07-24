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
