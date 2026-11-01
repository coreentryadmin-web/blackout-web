import assert from "node:assert/strict";
import test from "node:test";
import { parseRelatedCompanies } from "./polygon-related";

// /v1/related-companies/AAPL → results: [{ ticker }] (per scratchpad/polygon-arsenal.log)

test("parseRelatedCompanies: uppercases, de-dupes, excludes self, preserves order", () => {
  const r = parseRelatedCompanies("AAPL", [
    { ticker: "msft" },
    { ticker: "GOOG" },
    { ticker: "MSFT" }, // dup
    { ticker: "AAPL" }, // self
    { ticker: "NVDA" },
  ]);
  assert.deepEqual(r, { ticker: "AAPL", related: ["MSFT", "GOOG", "NVDA"] });
});

test("parseRelatedCompanies: keeps dotted tickers, drops junk/empty/non-string", () => {
  const r = parseRelatedCompanies("brk.a", [
    { ticker: "BRK.B" },
    { ticker: "" },
    { ticker: "TOOLONGSYM" }, // 8 chars → rejected
    { ticker: 123 as unknown as string },
    { ticker: "  jpm  " }, // trimmed
    {},
  ]);
  assert.deepEqual(r, { ticker: "BRK.A", related: ["BRK.B", "JPM"] });
});

test("parseRelatedCompanies: empty / null results → empty peer list (honest 'no peers')", () => {
  assert.deepEqual(parseRelatedCompanies("NVDA", []), { ticker: "NVDA", related: [] });
  assert.deepEqual(parseRelatedCompanies("NVDA", null), { ticker: "NVDA", related: [] });
  assert.deepEqual(parseRelatedCompanies("NVDA", undefined), { ticker: "NVDA", related: [] });
});

// BUG: live repro 2026-11-01 (Ask Largo swing audit, five-engine-largo-cycle-58) — TMUS's own
// exchange-traded senior notes (TMUSZ/TMUSI/TMUSL — each verified live via Polygon's own
// /v3/reference/tickers/{ticker} as "T-Mobile US, Inc. ... Senior Notes due ...", mislabeled type
// "CS" same as an equity) came back from /v1/related-companies/TMUS mixed in with real peers
// (VZ, T, ANET), rendering "Peers: VZ, T, TMUSZ, TMUSI, TMUSL, ANET" with no way to tell three of
// the six names were TMUS itself — a Largo Contract C4 (identity) violation.
test("parseRelatedCompanies: drops an issuer's own self-issued debt tickers (root + 1 letter, live TMUS shape)", () => {
  const r = parseRelatedCompanies("TMUS", [
    { ticker: "VZ" },
    { ticker: "T" },
    { ticker: "TMUSZ" },
    { ticker: "TMUSI" },
    { ticker: "TMUSL" },
    { ticker: "ANET" },
  ]);
  assert.deepEqual(r, { ticker: "TMUS", related: ["VZ", "T", "ANET"] });
});

test("parseRelatedCompanies: does NOT apply the self-issued-debt filter to short (<3 char) root tickers", () => {
  // A short root ("GE") colliding with "root + 1 letter" is far too likely to be a real, unrelated
  // ticker to use as a signal — the filter must stay off for these, unlike the TMUS (4-char) case.
  const r = parseRelatedCompanies("GE", [{ ticker: "GEX" }, { ticker: "HON" }]);
  assert.deepEqual(r, { ticker: "GE", related: ["GEX", "HON"] });
});

test("parseRelatedCompanies: does NOT drop real dotted share-class peers (no regression)", () => {
  // BRK.A / BRK.B are real, distinct share classes of the same real peer company, not self-issued
  // debt — the dotted-ticker exclusion in isLikelySelfIssuedSecurity must keep this working.
  const r = parseRelatedCompanies("BRK.A", [{ ticker: "BRK.B" }, { ticker: "AXP" }]);
  assert.deepEqual(r, { ticker: "BRK.A", related: ["BRK.B", "AXP"] });
});
