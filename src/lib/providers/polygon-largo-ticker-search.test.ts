import { test } from "node:test";
import assert from "node:assert/strict";
import { rankTickerSearchResults, type TickerSearchResult } from "./polygon-largo";

function stub(ticker: string, opts: Partial<TickerSearchResult> = {}): TickerSearchResult {
  return {
    ticker,
    name: opts.name ?? "",
    market: opts.market ?? "stocks",
    primary_exchange: opts.primary_exchange ?? "XNAS",
    type: opts.type ?? "CS",
    active: opts.active ?? true,
    currency_name: opts.currency_name ?? "usd",
  };
}

test("rankTickerSearchResults surfaces the exact ticker match first", () => {
  // Reproduces the live PLTR bug: Polygon's alphabetical order puts derivative
  // products whose ticker merely starts with/contains "PLT" ahead of the real
  // "PLTR" common stock, which used to fall off an 8-result page entirely.
  const input = [
    stub("I:PLTRCW", { market: "indices", type: "", name: "" }),
    stub("I:PLTRDI", { market: "indices", type: "", name: "" }),
    stub("PLA", { type: "ETF", name: "GraniteShares Autocallable PLTR ETF" }),
    stub("PLIB", { type: "ETF", name: "Direxion PLTR Defined Income Boost ETF" }),
    stub("PLTA", { type: "ETS", name: "ProShares Ultra PLTR" }),
    stub("PLTD", { type: "ETF", name: "Direxion Daily PLTR Bear 1X ETF" }),
    stub("PLTG", { type: "ETF", name: "Leverage Shares 2X Long PLTR Daily ETF" }),
    stub("PLTR", { name: "Palantir Technologies Inc." }),
  ];

  const ranked = rankTickerSearchResults(input, "PLTR").slice(0, 8);
  assert.equal(ranked[0].ticker, "PLTR", "exact ticker match must be first, not pushed off the page");
});

test("rankTickerSearchResults keeps prefix-match common stock ahead of derivative ETFs", () => {
  const input = [
    stub("AAA", { type: "ETF", name: "Some AAPL-adjacent ETF" }),
    stub("AAPL", { name: "Apple Inc." }),
  ];
  const ranked = rankTickerSearchResults(input, "AAPL");
  assert.deepEqual(ranked.map((r) => r.ticker), ["AAPL", "AAA"]);
});

test("rankTickerSearchResults with prepended direct hit surfaces short symbols (BE/NIO class)", () => {
  // Polygon fuzzy search for "BE" returns AABVF/AALBF/… — the real BE is ~131st alphabetically
  // and never enters the 50-result upstream page. Direct lookup prepends the exact symbol.
  const fuzzyNoise = [stub("AABVF"), stub("AALBF"), stub("AAPD")];
  const direct = stub("BE", { name: "Bloom Energy Corporation" });
  const ranked = rankTickerSearchResults([direct, ...fuzzyNoise], "BE");
  assert.equal(ranked[0].ticker, "BE");

  const nioDirect = stub("NIO", { name: "NIO Inc.", type: "ADRC" });
  const nioRanked = rankTickerSearchResults([nioDirect, stub("ABXL"), stub("ADAMG")], "NIO");
  assert.equal(nioRanked[0].ticker, "NIO");
});

test("rankTickerSearchResults is stable (preserves input order) within a tier", () => {
  const input = [stub("MSFT"), stub("META")];
  const ranked = rankTickerSearchResults(input, "M");
  assert.deepEqual(ranked.map((r) => r.ticker), ["MSFT", "META"]);
});
