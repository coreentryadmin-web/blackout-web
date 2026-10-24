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

// Regression (Night Hawk Legacy aggressive-improvement mandate, 2026-09-13): the bare "Mon DD"
// label (formatOptionsPlay/shortExpiry's real production format — the year is NEVER printed) has
// no year of its own, so this function has always had to infer one. It used the WALL-CLOCK "now"
// as the inference anchor unconditionally, which is only correct while parsing happens close to
// when the play was published. The Legacy edition calendar strip
// (legacy-board-calendar.ts's legacyEditionSessionDates, up to 14 trading days back) lets a member
// re-open an OLD edition, and terminalPlayFromEdition (adapters.ts) re-parses that old edition's
// options_play text fresh on every view — anchored on real "now", not on when the edition actually
// published. For a play that already expired weeks ago, "the label read as before real-today" is
// true for nearly ANY month/day in the past, so the old code rolled it a full year FORWARD instead
// of recognizing it as already-past-this-year — producing an OCC for a completely different,
// never-traded contract a year later (which can resolve to a REAL, live, wrong-year option quote
// for a liquid underlying, not just a harmless 404).
test("parseOptionsContract: month/day label resolves against the supplied reference date, not real wall-clock now", () => {
  // Reference date stands in for "when the edition was published" — here, before the label date in
  // the SAME year, so no year-rollover is needed. A reference-date-blind implementation instead
  // uses actual today (whenever the test runs) and would roll this to next year once actual today
  // has passed Aug 28, exactly the historical-edition-view failure this test guards against.
  const reference = new Date("2026-08-24T12:00:00Z");
  const r = parseOptionsContract("NVDA $180 CALL @ $4.00 — Aug 28", reference);
  assert.equal(r?.expiryYmd, "2026-08-28", "must resolve to the reference year, not roll forward");
});

test("parseOptionsContract: month/day label still rolls forward across a year boundary relative to the reference date", () => {
  // Reference date in late December; label is an early-January date — correctly a NEXT-year
  // expiry relative to the reference, not real wall-clock now.
  const reference = new Date("2026-12-28T12:00:00Z");
  const r = parseOptionsContract("SPY $600 PUT @ $5.00 — Jan 5", reference);
  assert.equal(r?.expiryYmd, "2027-01-05");
});
