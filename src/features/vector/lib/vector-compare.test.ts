import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_COMPARE_MAX_PANES,
  VECTOR_COMPARE_PRESETS,
  buildCompareSearch,
  comparePath,
  deskPath,
  isCompareMode,
  parseCompareTickers,
} from "./vector-compare";

test("parseCompareTickers: normalizes, dedupes, caps at max panes", () => {
  const raw = "nvda, NVDA, tsla, meta, amd, coin";
  const out = parseCompareTickers(raw);
  assert.deepEqual(out, ["NVDA", "TSLA", "META", "AMD"]);
  assert.equal(out.length, VECTOR_COMPARE_MAX_PANES);
});

test("parseCompareTickers: drops invalid tickers", () => {
  assert.deepEqual(parseCompareTickers("NVDA,!!!,TSLA"), ["NVDA", "TSLA"]);
  assert.deepEqual(parseCompareTickers(""), []);
  assert.deepEqual(parseCompareTickers(null), []);
});

test("isCompareMode: true only when compare param is non-empty", () => {
  assert.equal(isCompareMode("NVDA,TSLA"), true);
  assert.equal(isCompareMode(""), false);
  assert.equal(isCompareMode(undefined), false);
});

test("buildCompareSearch + comparePath: round-trip tickers in URL", () => {
  const qs = buildCompareSearch(["NVDA", "TSLA"]);
  assert.match(qs, /\?compare=NVDA%2CTSLA/);
  assert.match(qs, /ticker=NVDA/);
  assert.equal(comparePath(["NVDA", "TSLA"]), `/vector${qs}`);
});

test("buildCompareSearch: SPX-only omits ticker param", () => {
  const qs = buildCompareSearch(["SPX", "SPY"]);
  assert.equal(qs, "?compare=SPX%2CSPY");
});

test("deskPath: SPX maps to bare /vector", () => {
  assert.equal(deskPath("SPX"), "/vector");
  assert.equal(deskPath("nvda"), "/vector?ticker=NVDA");
});

test("VECTOR_COMPARE_PRESETS: every preset respects max panes", () => {
  for (const preset of VECTOR_COMPARE_PRESETS) {
    assert.ok(preset.tickers.length <= VECTOR_COMPARE_MAX_PANES, preset.id);
    assert.ok(preset.label.length > 0);
  }
});

test("loadCompareSeedsBounded: preserves order with concurrency cap", async () => {
  const { loadCompareSeedsBounded } = await import("./vector-compare");
  let peak = 0;
  let active = 0;
  const loaded = await loadCompareSeedsBounded(["NVDA", "TSLA", "META", "AMD"], async (t) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return t;
  }, 2);
  assert.deepEqual(loaded, ["NVDA", "TSLA", "META", "AMD"]);
  assert.ok(peak <= 2, `peak concurrency ${peak} should be <= 2`);
});

test("fmtCompareSpot via compare-format: formats finite spot", async () => {
  const { fmtCompareSpot } = await import("./vector-compare-format");
  assert.equal(fmtCompareSpot(null, "NVDA"), "—");
  assert.equal(fmtCompareSpot(123.456, "NVDA"), "123.46");
  assert.match(fmtCompareSpot(5432.1, "SPX"), /5,432\.10/);
});

test("resolveCompareRaw: URL is the only source of truth for compare state", async () => {
  const { resolveCompareRaw, isCompareMode } = await import("./vector-compare");

  // In compare mode: the URL carries the param.
  assert.equal(resolveCompareRaw("SPX,NVDA"), "SPX,NVDA");
  assert.equal(isCompareMode(resolveCompareRaw("SPX,NVDA")), true);

  // Exit compare pushes `/vector` — the param is GONE, and that must win over whatever the page
  // was loaded with. This is the regression: a `?? initialCompareRaw` fallback here made the Exit
  // button (and every same-route nav out of compare) a no-op.
  assert.equal(resolveCompareRaw(null), null);
  assert.equal(isCompareMode(resolveCompareRaw(null)), false);
  assert.equal(resolveCompareRaw(undefined), null);
  assert.equal(isCompareMode(resolveCompareRaw(undefined)), false);

  // An explicitly empty param is also "not compare" — buildCompareSearch never emits one, but a
  // hand-typed `?compare=` must not trap the member either.
  assert.equal(isCompareMode(resolveCompareRaw("")), false);
});
