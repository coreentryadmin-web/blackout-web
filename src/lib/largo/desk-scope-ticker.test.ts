import test from "node:test";
import assert from "node:assert/strict";

import { parseDeskSlashArgs } from "./desk-scope";
import { looksLikeMemberTicker } from "./question-intent";

/**
 * A scoped desk turned the first word of any ordinary question into its ticker.
 *
 * PRODUCTION, 2026-08-20. A member asked "how is SPX looking for 8/23? what is a good play?" under
 * the SPX Slayer scope. The scope chip came back reading "SPX Slayer · HOW", the mini-panel
 * rendered "SPX SLAYER HOW", and the follow-up chips offered "What happens if HOW breaks 7891.98
 * flip?" — a symbol that does not exist.
 *
 * `parseDeskSlashArgs` decided the question independently of `question-intent.ts`, with a bare
 *
 *     const TICKER_TOKEN = /^\$?([A-Z][A-Z0-9]{0,4})$/i
 *
 * on the first token. Case-INSENSITIVE, and with no stopword list — so "how" matched, was
 * uppercased, and became the scope ticker. Measured before the fix, all under scope "spx-slayer":
 *
 *     "how is SPX looking for 8/23?"   -> { ticker: "HOW" }
 *     "what is a good play?"           -> { ticker: "WHAT" }
 *     "where are the walls"            -> { ticker: "WHERE" }
 *     "is the system aligned?"         -> { ticker: "IS" }
 *     "any good setups"                -> { ticker: "ANY" }
 *     "can you show me the flip"       -> { ticker: "CAN" }
 *
 * The stopword set that catches every one of these already existed in question-intent.ts and
 * contained "HOW" by name. It was simply unreachable from here — the same shape as the trading
 * calendar bug: the correct guard present, and not wired.
 *
 * So the fix reuses that module's predicate rather than adding a second stopword list. These tests
 * pin BOTH halves: prose must not yield a ticker, and real symbols must still resolve — a guard
 * that fixed the first by breaking the second would be a worse bug, since it silently re-scopes a
 * member asking about NVDA onto the desk default.
 */

const SCOPE = "spx-slayer";

test("REGRESSION: ordinary questions donate no ticker", () => {
  for (const q of [
    "how is SPX looking for 8/23? what is a good play?",
    "what is a good play?",
    "where are the walls",
    "is the system aligned?",
    "any good setups",
    "can you show me the flip",
    "which index is the laggard?",
    "do you see a pin into the close",
  ]) {
    assert.equal(
      parseDeskSlashArgs(q, SCOPE).ticker,
      undefined,
      `prose must not yield a ticker: ${q}`
    );
  }
});

test("real symbols still resolve — the guard must not overshoot", () => {
  assert.equal(parseDeskSlashArgs("NVDA flow", SCOPE).ticker, "NVDA");
  assert.equal(parseDeskSlashArgs("$AAPL", SCOPE).ticker, "AAPL");
  // Lowercase but KNOWN: members type "spx gamma" constantly.
  assert.equal(parseDeskSlashArgs("spx gamma", SCOPE).ticker, "SPX");
  // Unknown symbol, shouted by the member — the case signal is what makes an allowlist-free
  // extractor possible at all (CRWV/OKLO/NET were all absent from KNOWN_TICKERS when measured).
  assert.equal(parseDeskSlashArgs("CRWV setup", SCOPE).ticker, "CRWV");
});

test("the $ prefix always wins, even over a stopword", () => {
  // "$NOW" is ServiceNow, and the member marked it themselves.
  assert.equal(looksLikeMemberTicker("$NOW", "$NOW flow"), true);
  assert.equal(looksLikeMemberTicker("now", "now what"), false);
});

test("case is the discriminator for stopword-shaped symbols", () => {
  // Bare lowercase function word: never a ticker.
  assert.equal(looksLikeMemberTicker("how", "how is SPX looking"), false);
  assert.equal(looksLikeMemberTicker("all", "all the walls please"), false);
  // Shouted in the member's own text: allowed through.
  assert.equal(looksLikeMemberTicker("ALL", "ALL earnings this week"), true);
});

test("non-symbol shapes are rejected outright", () => {
  assert.equal(looksLikeMemberTicker("", "x"), false);
  assert.equal(looksLikeMemberTicker("TOOLONG", "TOOLONG"), false);
  assert.equal(looksLikeMemberTicker("8/23", "8/23"), false);
  assert.equal(looksLikeMemberTicker("123", "123"), false);
});

test("submodule peeling still works and no longer drags a prose ticker with it", () => {
  // `/spx-slayer /gex how does this look` must scope the SUBMODULE without inventing "HOW".
  const withProse = parseDeskSlashArgs("/gex how does this look", SCOPE);
  assert.equal(withProse.submodule, "gex");
  assert.equal(withProse.ticker, undefined);
  // A real ticker after the submodule is still honoured.
  const withTicker = parseDeskSlashArgs("/gex NVDA", SCOPE);
  assert.equal(withTicker.submodule, "gex");
  assert.equal(withTicker.ticker, "NVDA");
});

test("explicit multi-word modes are untouched by the guard", () => {
  // These branches return before the first-token test; asserted so a future refactor that moves
  // the guard earlier cannot silently break them.
  assert.equal(parseDeskSlashArgs("trinity", SCOPE).mode, "trinity");
  assert.equal(parseDeskSlashArgs("gate trace", SCOPE).mode, "gate-trace");
  assert.deepEqual(parseDeskSlashArgs("watch NVDA AMD", SCOPE).watchTickers, ["NVDA", "AMD"]);
});
