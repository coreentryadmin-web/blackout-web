import test from "node:test";
import assert from "node:assert/strict";
import { stripLeadingTicker } from "./adapters";

/**
 * Legacy play rows rendered the ticker twice — "MSFT MSFT $500 CALL @ $3.33 — Aug 10".
 *
 * `options_play` is built by formatOptionsPlay() and deliberately leads with the symbol, because
 * the briefing panel, the AI format contract and gex-heatmap all consume it standalone. The deck,
 * though, renders `ticker` in its own element next to the contract label, so the prefix showed up
 * a second time. Only Legacy was affected: the 0DTE lane builds its label from the contract object,
 * which never carried a symbol prefix to begin with.
 */

test("strips the ticker when the label leads with it", () => {
  assert.equal(
    stripLeadingTicker("MSFT $500 CALL @ $3.33 — Aug 10", "MSFT"),
    "$500 CALL @ $3.33 — Aug 10"
  );
  assert.equal(stripLeadingTicker("DELL $450 CALL @ $29.20 — Aug 21", "DELL"), "$450 CALL @ $29.20 — Aug 21");
});

test("leaves a label that does not start with the ticker alone", () => {
  assert.equal(stripLeadingTicker("$500 CALL @ $3.33", "MSFT"), "$500 CALL @ $3.33");
  assert.equal(stripLeadingTicker("Rank 3 · next session", "AMZN"), "Rank 3 · next session");
});

test("does not strip a ticker that merely appears inside the label", () => {
  // Word-boundary + anchored: a symbol mentioned mid-string is content, not a prefix.
  assert.equal(stripLeadingTicker("$100 CALL on HALO — Dec 18", "HALO"), "$100 CALL on HALO — Dec 18");
});

test("does not strip a longer symbol that merely starts with the ticker", () => {
  // Without the word boundary, ticker "SPX" would eat the "SPX" out of "SPXC $133 CALL".
  assert.equal(stripLeadingTicker("SPXC $133 CALL @ $9.73", "SPX"), "SPXC $133 CALL @ $9.73");
});

test("keeps the label when the ticker is the whole thing", () => {
  // formatOptionsPlay's no-contract shape is "AAPL — no options data available"; stripping to an
  // empty string would render a blank contract row, which is worse than a repeated symbol.
  assert.equal(stripLeadingTicker("AAPL", "AAPL"), "AAPL");
});

test("handles a missing or blank ticker without throwing", () => {
  assert.equal(stripLeadingTicker("$500 CALL", null), "$500 CALL");
  assert.equal(stripLeadingTicker("$500 CALL", undefined), "$500 CALL");
  assert.equal(stripLeadingTicker("$500 CALL", "  "), "$500 CALL");
});

test("is case-insensitive on the symbol", () => {
  assert.equal(stripLeadingTicker("msft $500 CALL", "MSFT"), "$500 CALL");
});

test("a ticker with regex metacharacters is matched literally, not as a pattern", () => {
  // BRK.B-style symbols contain a '.', which unescaped would match any character.
  assert.equal(stripLeadingTicker("BRK.B $400 CALL", "BRK.B"), "$400 CALL");
  assert.equal(stripLeadingTicker("BRKXB $400 CALL", "BRK.B"), "BRKXB $400 CALL");
});
