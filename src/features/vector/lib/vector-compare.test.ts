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

test("VECTOR_COMPARE_PRESETS: a preset's label never claims more tickers than it carries", () => {
  // Regression: the "mag7" preset (id kept stable — referenced by capture-catalog's `preset=mag7`
  // param) was labeled "Mag 7" while capped at 4 tickers by VECTOR_COMPARE_MAX_PANES, 3 short of
  // the real Magnificent Seven.
  for (const preset of VECTOR_COMPARE_PRESETS) {
    const numberClaim = preset.label.match(/\d+/);
    if (numberClaim) {
      assert.equal(
        Number(numberClaim[0]),
        preset.tickers.length,
        `${preset.id} label "${preset.label}" claims ${numberClaim[0]} tickers but carries ${preset.tickers.length}`
      );
    }
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

test("loadCompareSeedsBounded: ONE failing ticker must not sink the batch", async () => {
  const { loadCompareSeedsBounded } = await import("./vector-compare");
  // THE BUG (member-visible). A rejection used to propagate out of the worker, reject Promise.all,
  // and throw out of the caller's void-ed async effect — so setCompareSeeds was never called and
  // the grid sat on "Loading Vector Compare…" forever, with no error state and no retry. Asking for
  // four names and having one fail lost ALL four, including the primary already in hand.
  const loaded = await loadCompareSeedsBounded(
    ["NVDA", "META", "AMD", "TSLA"],
    async (t) => {
      if (t === "AMD") throw new Error("502 from upstream");
      return t;
    },
    2
  );
  assert.equal(loaded.length, 4, "every requested slot is still represented");
  assert.deepEqual(loaded, ["NVDA", "META", null, "TSLA"]);
  assert.equal(
    loaded.filter(Boolean).length,
    3,
    "the three healthy panes survive so the member sees a partial grid, not a spinner"
  );
});

test("loadCompareSeedsBounded: ALL failing still resolves — never rejects", async () => {
  const { loadCompareSeedsBounded } = await import("./vector-compare");
  const loaded = await loadCompareSeedsBounded(
    ["NVDA", "META"],
    async () => {
      throw new Error("everything is down");
    },
    2
  );
  // Resolving with all-nulls lets the caller fall back to the primary seed it already holds.
  // Rejecting here is what stranded the UI, so the loader must never do it.
  assert.deepEqual(loaded, [null, null]);
});

test("loadCompareSeedsBounded: a failure does not stall the concurrency window", async () => {
  const { loadCompareSeedsBounded } = await import("./vector-compare");
  let active = 0;
  let peak = 0;
  const loaded = await loadCompareSeedsBounded(
    ["NVDA", "META", "AMD", "TSLA"],
    async (t) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (t === "META") throw new Error("boom");
      return t;
    },
    2
  );
  assert.deepEqual(loaded, ["NVDA", null, "AMD", "TSLA"]);
  assert.ok(peak <= 2, `peak concurrency ${peak} should stay capped even with a thrower`);
});
