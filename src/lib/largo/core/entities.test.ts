import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEntityBlock,
  canonicalTicker,
  sameTicker,
  parseOccSymbol,
  buildOccSymbol,
  canonicalSession,
  extractTickers,
} from "./entities";

test("every spelling of SPX collapses to one join key", () => {
  // The join key is the whole point: flow keyed on "$SPX", GEX keyed on "I:SPX" and a chain keyed
  // on "SPXW" are evidence about ONE instrument. Split across three keys, each bucket looks thin.
  for (const spelling of ["SPX", "spx", "$SPX", "I:SPX", " SPX ", "SPXW"]) {
    assert.equal(canonicalTicker(spelling)?.key, "SPX", spelling);
  }
  assert.equal(canonicalTicker("SPX")?.polygon, "I:SPX", "indices read through Polygon's I: namespace");
  assert.equal(canonicalTicker("NVDA")?.polygon, "NVDA");
});

test("SPXW keeps the distinction that actually matters — which chain to price", () => {
  // Collapsing SPXW to SPX for joins is right; forgetting it was weekly is not. SPXW and the
  // monthly SPX settle differently, so a caller selecting a chain needs the flag back.
  assert.equal(canonicalTicker("SPXW")?.weeklyVariant, true);
  assert.equal(canonicalTicker("SPX")?.weeklyVariant, false);
  assert.equal(canonicalTicker("SPXW")?.raw, "SPXW", "the user's own word survives normalisation");
});

test("kind classification drives labelling, not routing", () => {
  assert.equal(canonicalTicker("VIX")?.kind, "index");
  assert.equal(canonicalTicker("SPY")?.kind, "etf");
  assert.equal(canonicalTicker("NVDA")?.kind, "equity");
  // An unknown symbol is still a well-formed key — this layer does not decide what exists.
  assert.equal(canonicalTicker("ZZQQXX")?.kind, "equity");
  assert.equal(canonicalTicker("ZZQQXX")?.key, "ZZQQXX");
});

test("non-symbols never become entities", () => {
  for (const junk of ["", "   ", null, undefined, "what is the price", "1234", "$", "TOOLONGSYMBOL12"]) {
    assert.equal(canonicalTicker(junk as string), null, JSON.stringify(junk));
  }
});

test("sameTicker is the join predicate string equality cannot be", () => {
  assert.equal(sameTicker("$SPX", "SPXW"), true);
  assert.equal(sameTicker("I:VIX", "vix"), true);
  assert.equal(sameTicker("SPX", "SPY"), false, "SPX and SPY are 10x related, not the same thing");
  assert.equal(sameTicker("SPX", null), false, "an unknown side never joins");
});

test("OCC strike is thousandths — the factor-of-1000 bug is pinned against real symbols", () => {
  const c = parseOccSymbol("NVDA260821C00230000");
  assert.equal(c?.ticker, "NVDA");
  assert.equal(c?.expiry, "2026-08-21");
  assert.equal(c?.right, "C");
  assert.equal(c?.strike, 230, "00230000 is $230.000, not $230,000 and not $0.23");

  const p = parseOccSymbol("O:SPXW260810P06500000");
  assert.equal(p?.ticker, "SPX", "the underlying canonicalises even inside a contract key");
  assert.equal(p?.strike, 6500);
  assert.equal(p?.right, "P");

  // Fractional strikes are real (SPY trades half-dollars) and must survive the divisor intact —
  // truncating to an integer here would silently move the strike by 50 cents.
  assert.equal(parseOccSymbol("SPY260821C00612500")?.strike, 612.5);
});

test("OCC round-trips: build(parse(x)) === x", () => {
  for (const sym of ["NVDA260821C00230000", "SPY260918P00450500", "AAPL270115C00300000"]) {
    const parsed = parseOccSymbol(sym);
    assert.ok(parsed, sym);
    const rebuilt = buildOccSymbol({
      ticker: parsed!.ticker,
      expiry: parsed!.expiry,
      right: parsed!.right,
      strike: parsed!.strike,
    });
    assert.equal(rebuilt, sym, `round-trip broke for ${sym}`);
  }
});

test("malformed contract symbols return null rather than a plausible guess", () => {
  for (const junk of [
    "NVDA260821X00230000", // no such right
    "NVDA261321C00230000", // month 13
    "NVDA260832C00230000", // day 32
    "NVDA26082C00230000", // short date
    "NVDA260821C0023000", // 7-digit strike
    "NVDA260821C00000000", // zero strike
    "not a symbol",
    "",
  ]) {
    assert.equal(parseOccSymbol(junk), null, junk);
  }
});

test("buildOccSymbol refuses inputs it cannot represent", () => {
  assert.equal(buildOccSymbol({ ticker: "NVDA", expiry: "2026-8-21", right: "C", strike: 230 }), null);
  assert.equal(buildOccSymbol({ ticker: "", expiry: "2026-08-21", right: "C", strike: 230 }), null);
  assert.equal(buildOccSymbol({ ticker: "NVDA", expiry: "2026-08-21", right: "C", strike: 0 }), null);
  assert.equal(buildOccSymbol({ ticker: "NVDA", expiry: "2026-08-21", right: "C", strike: NaN }), null);
  // 8 digits caps the strike at 99,999.999 — above that there is no valid symbol to return.
  assert.equal(buildOccSymbol({ ticker: "NVDA", expiry: "2026-08-21", right: "C", strike: 200_000 }), null);
});

test("sessions key on the ET calendar date in either common spelling", () => {
  assert.equal(canonicalSession("2026-08-10"), "2026-08-10");
  assert.equal(canonicalSession("2026-08-10T14:31:00Z"), "2026-08-10");
  assert.equal(canonicalSession("8/10/2026"), "2026-08-10");
  assert.equal(canonicalSession("08/09/2026"), "2026-08-09");
  assert.equal(canonicalSession("yesterday"), null, "a relative word is the timeframe layer's job");
  assert.equal(canonicalSession(null), null);
});

const KNOWN = new Set(["SPX", "SPY", "NVDA", "TSLA", "AMD", "VIX", "META"]);

test("extractTickers finds what the member named", () => {
  const found = extractTickers("compare NVDA and TSLA flow against SPX", KNOWN).map((t) => t.key);
  assert.deepEqual(found.sort(), ["NVDA", "SPX", "TSLA"]);
});

test("extractTickers does NOT invent entities out of English", () => {
  // The failure this guards: "IS SPX BULLISH" yielding IS, then a tool firing at a symbol the
  // member never mentioned and the result reported as if they had.
  assert.deepEqual(extractTickers("IS SPX BULLISH", KNOWN).map((t) => t.key), ["SPX"]);
  assert.deepEqual(extractTickers("what is the market doing", KNOWN), []);
  assert.deepEqual(extractTickers("A CEO said something", KNOWN), []);
});

test("a $-prefix is an explicit entity even outside the known set", () => {
  // The member typed a dollar sign; that is unambiguous intent. Whether it trades is answered by
  // trying to fetch it, not by this layer's list.
  assert.deepEqual(extractTickers("what about $ZZQQXX", KNOWN).map((t) => t.key), ["ZZQQXX"]);
});

test("extractTickers dedupes to one entity per instrument", () => {
  const found = extractTickers("SPX vs $SPX and SPXW", KNOWN);
  assert.equal(found.length, 1, "three spellings, one instrument");
  assert.equal(found[0]!.key, "SPX");
});

test("extraction is total — no input throws", () => {
  assert.doesNotThrow(() => extractTickers("", KNOWN));
  assert.doesNotThrow(() => extractTickers("x".repeat(10_000), KNOWN));
  assert.doesNotThrow(() => extractTickers("$$$ ??? ///", KNOWN));
});

test("the entity block is silent when the question names no instrument", () => {
  // Every character of system prompt is paid for on every turn. A question with no ticker gets
  // no block at all rather than a header with an empty list under it.
  assert.equal(formatEntityBlock([]), "");
  assert.equal(formatEntityBlock(extractTickers("how does the platform work", KNOWN)), "");
});

test("the entity block states the two facts the model cannot infer", () => {
  const block = formatEntityBlock(extractTickers("what is SPXW doing", KNOWN));
  assert.match(block, /SPX \(index/);
  assert.match(block, /polygon I:SPX/, "an index needs the I: prefix to price");
  assert.match(block, /same underlying as SPX for joins/, "SPXW must not read as a second instrument");
  assert.match(block, /asked as "SPXW"/, "the member's own word is echoed, not normalised away");
});

test("the entity block is a hint, never a limit", () => {
  // Same lesson as the deleted intent allowlist: anything that reads as a restriction eventually
  // becomes one.
  assert.match(formatEntityBlock(extractTickers("NVDA vs AMD", KNOWN)), /HINTS, not limits/);
});

test("the entity block is bounded", () => {
  const many = extractTickers(
    "$SPX $SPY $QQQ $IWM $NVDA $TSLA $AMD $META $AAPL $MSFT $AMZN $GOOG",
    KNOWN
  );
  assert.ok(many.length > 8, "the fixture must actually exceed the cap");
  const lines = formatEntityBlock(many).split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 8);
  assert.equal(formatEntityBlock(many, 0), "", "a zero limit yields no block");
});
