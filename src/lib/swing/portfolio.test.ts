import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio.ts";

const long = (ticker: string): PortfolioPosition => ({ ticker, direction: "LONG" });
const short = (ticker: string): PortfolioPosition => ({ ticker, direction: "SHORT" });

test("same-theme same-direction is flagged as concentration", () => {
  const o = checkPortfolioOverlap(long("NVDA"), [long("AMD"), long("SMH")]);
  assert.equal(o.hasOverlap, true);
  assert.equal(o.theme, "semis");
  assert.equal(o.sameThemeSameDirection.length, 2);
  assert.equal(o.sameThemeOpposedDirection.length, 0);
});

test("same-theme opposed-direction is flagged as internal conflict (incl. QQQ proxy)", () => {
  const o = checkPortfolioOverlap(long("NVDA"), [short("QQQ")]);
  assert.equal(o.hasOverlap, true);
  assert.equal(o.sameThemeOpposedDirection.length, 1);
  assert.equal(o.sameThemeSameDirection.length, 0);
});

test("no overlap against an unrelated / unmapped book", () => {
  const o = checkPortfolioOverlap(long("NVDA"), [long("XOM"), long("ZZZZ")]);
  assert.equal(o.hasOverlap, false);
  assert.equal(o.sameThemeSameDirection.length, 0);
  assert.equal(o.sameThemeOpposedDirection.length, 0);
});

test("empty book is a valid no-overlap case", () => {
  const o = checkPortfolioOverlap(long("NVDA"), []);
  assert.equal(o.hasOverlap, false);
});

test("the candidate's own identical position does not overlap itself", () => {
  const o = checkPortfolioOverlap(long("NVDA"), [long("NVDA")]);
  assert.equal(o.hasOverlap, false);
  // but the SAME ticker in the OPPOSED direction IS a conflict
  const o2 = checkPortfolioOverlap(long("NVDA"), [short("NVDA")]);
  assert.equal(o2.hasOverlap, true);
  assert.equal(o2.sameThemeOpposedDirection.length, 1);
});
