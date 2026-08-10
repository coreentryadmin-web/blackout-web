import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildDrillDowns, formatDrillDownBlock, DESK_ROUTES } from "./drilldown";
import { canonicalTicker } from "./entities";

const REPO = path.resolve(import.meta.dirname, "../../../..");

test("every advertised route is a REAL page in the app router", () => {
  // The whole point. A model composes plausible URLs — it has seen `/night-hawk` and `/swings` in
  // this repo's own prose and neither resolves. This turns "the link works" from a hope into a
  // build-time fact: renaming or deleting a page fails here instead of shipping a 404 into a
  // member-facing answer.
  for (const [key, route] of Object.entries(DESK_ROUTES)) {
    const page = path.join(REPO, "src/app/(site)", route.path.replace(/^\//, ""), "page.tsx");
    assert.ok(existsSync(page), `${key} -> ${route.path} has no page at ${page}`);
  }
});

test("the routes that do NOT exist are not advertised", () => {
  // Named explicitly because these two specific wrong paths are the ones that actually appear in
  // this codebase's prose, so they are the ones a model is most likely to reproduce.
  const paths = Object.values(DESK_ROUTES).map((r) => r.path);
  assert.ok(!paths.includes("/night-hawk" as never), "/night-hawk is a 404 — the real path is /nighthawk");
  assert.ok(!paths.includes("/swings" as never), "there is no swings page");
});

test("a ticker question gets ticker-scoped links", () => {
  const links = buildDrillDowns([canonicalTicker("NVDA")!]);
  assert.ok(links.some((l) => l.href === "/flows?ticker=NVDA"));
  assert.ok(links.some((l) => l.href === "/heatmap?ticker=NVDA"));
  assert.ok(links.every((l) => l.href.startsWith("/")), "always same-origin paths, never absolute URLs");
});

test("a question with no instrument still offers the unscoped desks", () => {
  const links = buildDrillDowns([]);
  assert.ok(links.length > 0);
  assert.ok(links.every((l) => !l.href.includes("ticker=")), "no ticker means no ticker param");
  assert.ok(links.some((l) => l.href === "/nighthawk"));
});

test("SPXW links to SPX — the canonical key, not the raw spelling", () => {
  // A `?ticker=SPXW` link would land on a desk that keys on SPX and show nothing, which reads as
  // "the desk has no data" rather than "the link was wrong".
  const links = buildDrillDowns([canonicalTicker("SPXW")!]);
  assert.ok(links.some((l) => l.href === "/heatmap?ticker=SPX"));
  assert.ok(!links.some((l) => l.href.includes("SPXW")));
});

test("the ticker is URL-encoded", () => {
  const links = buildDrillDowns([{ key: "BRK.B", polygon: "BRK.B", kind: "equity", weeklyVariant: false, raw: "BRK.B" }]);
  assert.ok(links.some((l) => l.href.includes("ticker=BRK.B") || l.href.includes("ticker=BRK%2EB")));
});

test("only ONE instrument gets links", () => {
  // Two tickers x four desks is eight links nobody clicks. Choosing which ticker matters is the
  // model's job; this function takes the first.
  const links = buildDrillDowns([canonicalTicker("NVDA")!, canonicalTicker("TSLA")!]);
  assert.ok(!links.some((l) => l.href.includes("TSLA")));
});

test("the list is capped", () => {
  assert.ok(buildDrillDowns([canonicalTicker("NVDA")!], 3).length === 3);
  assert.deepEqual(buildDrillDowns([canonicalTicker("NVDA")!], 0), []);
  assert.ok(buildDrillDowns([canonicalTicker("NVDA")!]).length <= 6);
});

test("the block tells the model it is a CLOSED set", () => {
  // An invitation to link is an invitation to invent a path.
  const block = formatDrillDownBlock(buildDrillDowns([canonicalTicker("SPX")!]));
  assert.match(block, /EXACT hrefs, or none/);
  assert.match(block, /do not compose a URL/i);
  assert.match(block, /Never invent a path/);
  assert.match(block, /\[Thermal — SPX\]\(\/heatmap\?ticker=SPX\)/);
});

test("no links means no block", () => {
  assert.equal(formatDrillDownBlock([]), "");
});
