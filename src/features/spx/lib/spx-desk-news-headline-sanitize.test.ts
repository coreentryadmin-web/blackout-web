import { test } from "node:test";
import assert from "node:assert/strict";

// spx-desk.ts's import chain reaches `import "server-only"` transitively (via
// gex-positioning.ts) -- same boundary edition-builder-after-hours-sanitize.test.ts hits for its
// own module. Must register BEFORE spx-desk.ts is ever imported, and ESM static imports
// evaluate before any module-body statement runs -- so spx-desk.ts is loaded with a dynamic
// `await import()` inside each test, after this mock is registered.
import { mock } from "node:test";
mock.module("server-only", { namedExports: {} });

function article(title: string, tickers: string[] = ["SPY"]) {
  return { title, published: "2026-11-02T04:00:00Z", tickers };
}

test("sanitizedNewsHeadlineBase decodes HTML entities in title so raw &amp; / &#39; never reach the API/model", async () => {
  const { sanitizedNewsHeadlineBase } = await import("./spx-desk");
  const raw = [
    article("JP Morgan Maintains Neutral on Floor &amp; Decor Hldgs"),
    article("Here&#39;s How Much $1000 Invested In W.W. Grainger"),
  ];
  const out = sanitizedNewsHeadlineBase(raw);
  assert.equal(out[0]!.title, "JP Morgan Maintains Neutral on Floor & Decor Hldgs");
  assert.equal(out[1]!.title, "Here's How Much $1000 Invested In W.W. Grainger");
  assert.doesNotMatch(out[0]!.title, /&amp;/);
  assert.doesNotMatch(out[1]!.title, /&#39;/);
});

test("sanitizedNewsHeadlineBase preserves published/tickers untouched", async () => {
  const { sanitizedNewsHeadlineBase } = await import("./spx-desk");
  const raw = [article("Clean headline", ["SPX", "VIX"])];
  const out = sanitizedNewsHeadlineBase(raw);
  assert.equal(out[0]!.published, raw[0]!.published);
  assert.deepEqual(out[0]!.tickers, ["SPX", "VIX"]);
});

test("sanitizedNewsHeadlineBase filters out empty titles and handles undefined/missing tickers", async () => {
  const { sanitizedNewsHeadlineBase } = await import("./spx-desk");
  const out = sanitizedNewsHeadlineBase([
    article(""),
    { title: "No tickers field", published: "2026-11-02T04:00:00Z" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "No tickers field");
  assert.deepEqual(out[0]!.tickers, []);
  assert.deepEqual(sanitizedNewsHeadlineBase(undefined), []);
});
