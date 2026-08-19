import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { flowPriceSymbol, isIndexFlowTicker, KNOWN_INDEX_FLOW_ROOTS } from "./flow-price-symbol";

/**
 * Helix graded index signals against the EQUITY aggregates namespace, where they do not exist.
 *
 * UW's tape carries the option root, so SPX / SPXW / NDX / RUT / VIX arrive as bare symbols.
 * Polygon answers `/v2/aggs/ticker/SPX/...` with HTTP 200, status OK and ZERO results — a silent
 * empty success, not an error. Probed live 2026-08-19:
 *
 *   SPX    equity-ns 0 bars   I:SPX  2 bars
 *   SPXW   equity-ns 0 bars   I:SPX  2 bars   (I:SPXW itself: 0 — the weekly root is not an index)
 *   VIX    equity-ns 0 bars   I:VIX  2 bars
 *   AAPL   equity-ns 5 bars
 *
 * So `priceNearMs` returned null for every index row, forever. Those rows then sat at the head of
 * an oldest-first, fixed-LIMIT queue on every subsequent run — see the age bound added alongside
 * this in fetchPendingHelixSignalCheckpoints.
 */

test("index roots resolve to their Polygon I: symbol, not the equity namespace", () => {
  for (const [root, expected] of [
    ["SPX", "I:SPX"],
    ["NDX", "I:NDX"],
    ["RUT", "I:RUT"],
    ["VIX", "I:VIX"],
    ["XSP", "I:XSP"],
  ] as const) {
    const r = flowPriceSymbol(root);
    assert.deepEqual(r, { symbol: expected, isIndex: true }, root);
  }
});

test("WEEKLY roots map to their BASE index — `I:` + root does not exist for them", () => {
  // The naming pattern is a trap: I:SPXW, I:NDXP, I:RUTW and I:VIXW all return zero bars live.
  // A resolver built by string-concatenation would look right and silently grade nothing.
  assert.equal(flowPriceSymbol("SPXW")?.symbol, "I:SPX");
  assert.equal(flowPriceSymbol("NDXP")?.symbol, "I:NDX");
  assert.equal(flowPriceSymbol("RUTW")?.symbol, "I:RUT");
  assert.equal(flowPriceSymbol("VIXW")?.symbol, "I:VIX");
  for (const weekly of ["SPXW", "NDXP", "RUTW", "VIXW"]) {
    assert.notEqual(flowPriceSymbol(weekly)?.symbol, `I:${weekly}`, `${weekly} must not self-map`);
  }
});

test("equities pass through untouched on the equity path", () => {
  for (const t of ["AAPL", "NVDA", "SPY", "QQQ", "IWM", "BRK.B"]) {
    assert.deepEqual(flowPriceSymbol(t), { symbol: t, isIndex: false }, t);
  }
});

test("an UNKNOWN symbol stays on the equity path — it is never guessed into an I: form", () => {
  // This map only claims to know index roots. An unrecognised symbol is far more likely to be an
  // ordinary equity, and inventing `I:WHATEVER` would turn a working lookup into a silent empty one.
  assert.deepEqual(flowPriceSymbol("ZZZZ"), { symbol: "ZZZZ", isIndex: false });
  assert.equal(isIndexFlowTicker("ZZZZ"), false);
});

test("an unrecognised ticker is NEVER defaulted to SPX", () => {
  // The load-bearing reason this module exists instead of reusing vectorPolygonMinuteSymbol:
  // that helper routes through normalizeVectorTicker, which returns "SPX" for anything failing its
  // charset test. Here that would grade one instrument's signal against the S&P 500's price —
  // a confidently wrong number, which is strictly worse than no number.
  for (const junk of ["", "   ", "!!!", "a-very-long-nonsense-symbol", "../etc/passwd"]) {
    const r = flowPriceSymbol(junk);
    assert.notEqual(r?.symbol, "I:SPX", `${JSON.stringify(junk)} must not resolve to SPX`);
    assert.notEqual(r?.symbol, "SPX", `${JSON.stringify(junk)} must not resolve to SPX`);
  }
  assert.equal(flowPriceSymbol(null), null);
  assert.equal(flowPriceSymbol(undefined), null);
  assert.equal(flowPriceSymbol(""), null);
});

test("input is normalized, and an already-resolved I: symbol round-trips", () => {
  assert.equal(flowPriceSymbol("spx")?.symbol, "I:SPX");
  assert.equal(flowPriceSymbol("  vix  ")?.symbol, "I:VIX");
  assert.deepEqual(flowPriceSymbol("I:SPX"), { symbol: "I:SPX", isIndex: true });
  assert.deepEqual(flowPriceSymbol("i:ndx"), { symbol: "I:NDX", isIndex: true });
});

test("every claimed root maps to an I: symbol and none map to themselves", () => {
  assert.ok(KNOWN_INDEX_FLOW_ROOTS.length >= 10, "the map should cover the common index roots");
  for (const root of KNOWN_INDEX_FLOW_ROOTS) {
    const r = flowPriceSymbol(root);
    assert.ok(r?.isIndex, `${root} should be an index`);
    assert.ok(r!.symbol.startsWith("I:"), `${root} -> ${r!.symbol} should be an I: symbol`);
    assert.notEqual(r!.symbol, root, `${root} must not resolve to the bare equity symbol`);
  }
});

test("the grader routes index tickers to the INDEX bars endpoint", () => {
  // The resolver is only useful if the call site actually branches on it. Asserted on the source
  // because the alternative is standing up Polygon + Postgres to observe one endpoint choice.
  const src = readFileSync(join(process.cwd(), "src/lib/helix-signal-outcomes-job.ts"), "utf8");
  assert.match(src, /flowPriceSymbol\(ticker\)/, "priceNearMs must resolve the symbol");
  assert.match(src, /resolved\.isIndex[\s\S]{0,120}fetchIndexMinuteBars/, "index → fetchIndexMinuteBars");
  assert.doesNotMatch(
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " "),
    /fetchStockMinuteBars\(\s*ticker\s*,/,
    "the raw UW ticker must never go straight to the equity aggregates endpoint again"
  );
});

test("the pending-checkpoint queue is bounded so ungradeable rows cannot block it forever", () => {
  // The queue is ORDER BY fired_at ASC with a fixed LIMIT. A row that can never be graded keeps its
  // slot at the head on every run; enough of them and no live row is ever reached. Fixing the index
  // lookup removes today's cause — this bounds the class.
  const db = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
  assert.match(db, /HELIX_CHECKPOINT_MAX_AGE_DAYS\s*=\s*7/);
  assert.match(db, /fired_at >= NOW\(\) - \(\$3 \|\| ' days'\)::interval/);
});
