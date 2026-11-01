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
  pruneStaleTickerEntries,
  pruneStaleTickerMapEntries,
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

test("fmtCompareSpot via compare-format: pins the en-US locale rather than deferring to the viewer's browser locale", async () => {
  const { fmtCompareSpot } = await import("./vector-compare-format");
  const original = Number.prototype.toLocaleString;
  let capturedLocale: unknown = "not-called";
  Number.prototype.toLocaleString = function (locale?: unknown, options?: unknown) {
    capturedLocale = locale;
    return original.call(this, locale as never, options as never);
  };
  try {
    fmtCompareSpot(5432.1, "SPX");
  } finally {
    Number.prototype.toLocaleString = original;
  }
  // `undefined` here would mean "use the viewer's browser locale" (de-DE etc. flip the
  // grouping/decimal separator meaning for a price figure) — must be pinned to "en-US".
  assert.equal(capturedLocale, "en-US");
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

test("pruneStaleTickerEntries: drops entries whose ticker left the active set", () => {
  // THE BUG (member-visible, VectorCompareDesk): metaByTicker (drives the compare summary
  // footer's long-γ/short-γ chip) had no general cleanup when the whole seeds array was swapped
  // (applyPreset) — only removeTicker's own targeted delete. A ticker that left via a preset swap
  // and later came back could render a real but STALE posture left over from its earlier mount.
  const entries = { NVDA: "long", TSLA: "short", META: "unknown" };
  const active = new Set(["NVDA", "META"]);
  const next = pruneStaleTickerEntries(entries, active);
  assert.deepEqual(next, { NVDA: "long", META: "unknown" });
  assert.ok(!("TSLA" in next));
});

test("pruneStaleTickerEntries: returns the SAME reference when nothing is stale", () => {
  const entries = { NVDA: "long", META: "unknown" };
  const active = new Set(["NVDA", "META", "AMD"]); // AMD not present yet — not a reason to prune
  const next = pruneStaleTickerEntries(entries, active);
  assert.strictEqual(next, entries, "unchanged input must not force a new object (avoids an extra re-render)");
});

test("pruneStaleTickerEntries: an empty active set clears every entry", () => {
  const entries = { NVDA: "long", TSLA: "short" };
  const next = pruneStaleTickerEntries(entries, new Set());
  assert.deepEqual(next, {});
});

test("pruneStaleTickerEntries: does not mutate the input record", () => {
  const entries = { NVDA: "long", TSLA: "short" };
  const snapshot = { ...entries };
  pruneStaleTickerEntries(entries, new Set(["NVDA"]));
  assert.deepEqual(entries, snapshot);
});

// Regression for VectorCompareDesk's `timelinesRef`: removing a pane (removeTicker / a preset
// swap) did not itself prune the departed ticker's entry out of the Map — only the NEXT call to
// handleReplayTimeline for some OTHER ticker did, as an unrelated side effect. This is
// pruneStaleTickerEntries's exact same contract, just for the Map-keyed timelinesRef instead of a
// plain Record — see pruneStaleTickerMapEntries's own doc comment for the full account.
test("pruneStaleTickerMapEntries: drops entries whose ticker left the active set", () => {
  const entries = new Map([
    ["NVDA", [1, 2, 3]],
    ["TSLA", [4, 5, 6]],
    ["META", [7, 8, 9]],
  ]);
  const active = new Set(["NVDA", "META"]);
  const next = pruneStaleTickerMapEntries(entries, active);
  assert.deepEqual([...next.keys()], ["NVDA", "META"]);
  assert.ok(!next.has("TSLA"), "a removed ticker's stale replay timeline must not survive");
});

test("pruneStaleTickerMapEntries: returns the SAME reference when nothing is stale", () => {
  const entries = new Map([
    ["NVDA", [1, 2, 3]],
    ["META", [7, 8, 9]],
  ]);
  const active = new Set(["NVDA", "META", "AMD"]); // AMD not present yet — not a reason to prune
  const next = pruneStaleTickerMapEntries(entries, active);
  assert.strictEqual(next, entries, "unchanged input must not force a new Map (avoids a redundant unionTimeline recompute)");
});

test("pruneStaleTickerMapEntries: an empty active set clears every entry", () => {
  const entries = new Map([
    ["NVDA", [1, 2, 3]],
    ["TSLA", [4, 5, 6]],
  ]);
  const next = pruneStaleTickerMapEntries(entries, new Set());
  assert.deepEqual([...next.keys()], []);
});

test("pruneStaleTickerMapEntries: does not mutate the input Map", () => {
  const entries = new Map([
    ["NVDA", [1, 2, 3]],
    ["TSLA", [4, 5, 6]],
  ]);
  const snapshot = new Map(entries);
  pruneStaleTickerMapEntries(entries, new Set(["NVDA"]));
  assert.deepEqual(entries, snapshot);
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
