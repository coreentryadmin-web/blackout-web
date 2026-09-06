import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { bookContextSection } from "./play-brief-intel";
import type { PortfolioPosition } from "./portfolio";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "140C · 20DTE",
    score: 75,
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    factors: [],
    gates: [],
    ...overrides,
  };
}

test("bookContextSection: null when openBook is undefined or empty", () => {
  assert.equal(bookContextSection(fixturePlay(), undefined), null);
  assert.equal(bookContextSection(fixturePlay(), []), null);
});

test("bookContextSection: null when the book has no theme overlap with the candidate", () => {
  const book: PortfolioPosition[] = [{ ticker: "KO", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay(), book), null);
});

test("bookContextSection: flags CONCENTRATION when an existing same-theme same-direction position is held", () => {
  const book: PortfolioPosition[] = [
    { ticker: "AMD", direction: "LONG" },
    { ticker: "SMH", direction: "LONG" },
  ];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.equal(section?.title, "Book context");
  assert.match(section?.body ?? "", /Concentration/i);
  assert.match(section?.body ?? "", /AMD LONG/);
  assert.match(section?.body ?? "", /SMH LONG/);
});

test("bookContextSection: flags INTERNAL CONFLICT when an existing same-theme opposed-direction position is held", () => {
  const book: PortfolioPosition[] = [{ ticker: "AMD", direction: "SHORT" }];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.match(section?.body ?? "", /Internal conflict/i);
  assert.match(section?.body ?? "", /AMD SHORT/);
});

test("bookContextSection: a duplicate/rolled row on the SAME ticker+direction is not reported as overlap", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book), null);
});
