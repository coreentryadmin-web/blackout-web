import test from "node:test";
import assert from "node:assert/strict";
import { parseOptionsContract } from "./option-contract-parse";

test("parseOptionsContract: normal CALL contract", () => {
  const r = parseOptionsContract("HPE $62 CALL @ $2.91 — Sep 25, entry prem ~$2.91");
  assert.ok(r);
  assert.equal(r!.strike, 62);
  assert.equal(r!.side, "call");
});

test("parseOptionsContract: normal PUT contract", () => {
  const r = parseOptionsContract("AAPL $150 PUT @ $3.20 — Oct 10");
  assert.ok(r);
  assert.equal(r!.strike, 150);
  assert.equal(r!.side, "put");
});

test("parseOptionsContract: empty/dash input returns null", () => {
  assert.equal(parseOptionsContract(""), null);
  assert.equal(parseOptionsContract("—"), null);
});

// Regression (Night Hawk Legacy aggressive-improvement mandate, 2026-09-13): a combined
// (CALL|PUT|C|P) alternation matches the FIRST position where any alternative succeeds, not the
// first UNAMBIGUOUS side token in the string. For a real single-letter ticker like Citigroup
// ("C"), the bare "C" alternative matched the ticker symbol itself — appearing before the real
// "PUT"/"CALL" word later in the string — so a PUT play on ticker C misparsed as a CALL.
test("parseOptionsContract: ticker literally 'C' (Citigroup) with a PUT does not misparse as a call", () => {
  const r = parseOptionsContract("C $62 PUT @ $2.91 — Sep 25, entry prem ~$2.91");
  assert.ok(r);
  assert.equal(r!.side, "put", "the real PUT token must win over the ticker symbol 'C'");
  assert.equal(r!.strike, 62);
});

test("parseOptionsContract: ticker literally 'C' with a CALL parses correctly (was already correct, kept as a control)", () => {
  const r = parseOptionsContract("C $62 CALL @ $2.91 — Sep 25");
  assert.ok(r);
  assert.equal(r!.side, "call");
});

test("parseOptionsContract: bare C/P suffix notation still works when there is no ticker collision", () => {
  const call = parseOptionsContract("F $12 C @ $0.50");
  const put = parseOptionsContract("F $12 P @ $0.50");
  assert.equal(call?.side, "call");
  assert.equal(put?.side, "put");
});

test("parseOptionsContract: ISO expiry date is captured", () => {
  const r = parseOptionsContract("DELL $570 CALL @ $18.15 — 2026-09-18");
  assert.equal(r?.expiryYmd, "2026-09-18");
});
