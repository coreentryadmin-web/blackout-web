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

// Regression — SWING-SYSTEM-CTO-AUDIT-2026-09-06 finding #10. commit.ts's own design
// (swingThesisKey(ticker, direction, archetype)) permits MULTIPLE independent open positions on
// the SAME ticker + SAME direction (a different archetype is a different thesis) — e.g. a real
// EWZ LONG position under a BREAKOUT thesis and a second, independent EWZ LONG position under a
// POST_EARNINGS_DRIFT thesis, both open simultaneously. The self-match exclusion must remove only
// the ONE row standing in for "the candidate's own position" (the play-brief always reviews a
// position that is itself part of the open book being scanned) — every ADDITIONAL row sharing
// ticker+direction is a genuinely separate position and must be reported as concentration, not
// silently dropped along with the true self-match.
test("a second, independent same-ticker/same-direction position is NOT swallowed by self-match exclusion", () => {
  // Two independent open EWZ LONG positions (different archetypes in reality; PortfolioPosition
  // carries no identity field, so they are indistinguishable input-wise — that's the point: the
  // function must still surface N-1 of them as overlap, not zero).
  const o = checkPortfolioOverlap(long("EWZ"), [long("EWZ"), long("EWZ")]);
  assert.equal(o.hasOverlap, true, "a second independent EWZ LONG position must be visible as overlap");
  assert.equal(o.sameThemeSameDirection.length, 1, "exactly one self-match excluded, the other counted");
  assert.equal(o.sameThemeOpposedDirection.length, 0);
});

test("three independent same-ticker/same-direction positions: one self-match excluded, two counted", () => {
  const o = checkPortfolioOverlap(long("WULF"), [long("WULF"), long("WULF"), long("WULF")]);
  assert.equal(o.hasOverlap, true);
  assert.equal(o.sameThemeSameDirection.length, 2);
});

test("excludeSelfMatch=false counts a lone pre-existing same-ticker row (gate candidate)", () => {
  const o = checkPortfolioOverlap(long("EWZ"), [long("EWZ")], { excludeSelfMatch: false });
  assert.equal(o.hasOverlap, true);
  assert.equal(o.sameThemeSameDirection.length, 1);
});

test("excludePositionId skips the reviewed row even when it is not first in the book", () => {
  const book: PortfolioPosition[] = [
    { ticker: "EWZ", direction: "LONG", positionId: 29 },
    { ticker: "EWZ", direction: "LONG", positionId: 26 },
  ];
  const o = checkPortfolioOverlap(long("EWZ"), book, { excludePositionId: 26 });
  assert.equal(o.hasOverlap, true);
  assert.equal(o.sameThemeSameDirection.length, 1);
  assert.equal(o.sameThemeSameDirection[0]?.positionId, 29);
});

test("excludePositionId: reviewing the first of two same-ticker rows excludes only that id", () => {
  const book: PortfolioPosition[] = [
    { ticker: "EWZ", direction: "LONG", positionId: 29 },
    { ticker: "EWZ", direction: "LONG", positionId: 26 },
  ];
  const o = checkPortfolioOverlap(long("EWZ"), book, { excludePositionId: 29 });
  assert.equal(o.hasOverlap, true);
  assert.equal(o.sameThemeSameDirection.length, 1);
  assert.equal(o.sameThemeSameDirection[0]?.positionId, 26);
});

test("excludePositionId: lone self row produces no overlap", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG", positionId: 12 }];
  const o = checkPortfolioOverlap(long("NVDA"), book, { excludePositionId: 12 });
  assert.equal(o.hasOverlap, false);
});
