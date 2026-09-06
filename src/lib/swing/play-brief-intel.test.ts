import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { bookContextSection, dealerTapeSection } from "./play-brief-intel";
import type { PortfolioPosition } from "./portfolio";
import type { SwingPlayBriefContext } from "./play-brief-types";

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

// ─── dealerTapeSection ──────────────────────────────────────────────────────

type CtxOverrides = {
  direction?: "LONG" | "SHORT";
  gex?: Record<string, unknown>;
  vec?: Record<string, unknown>;
};

function fixtureCtx({ direction = "LONG", gex, vec }: CtxOverrides = {}): SwingPlayBriefContext {
  return {
    play: fixturePlay({ direction }),
    asOf: "2026-09-06T20:00:00.000Z",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: gex ? ({ gex_positioning: gex } as unknown as SwingPlayBriefContext["ecosystem"]) : null,
    vector: vec ? (vec as unknown as SwingPlayBriefContext["vector"]) : null,
  };
}

test("dealerTapeSection: null when there is no GEX/dark-pool/wall data at all", () => {
  assert.equal(dealerTapeSection(fixtureCtx()), null);
});

test("dealerTapeSection: narrates long-gamma dealer posture", () => {
  const section = dealerTapeSection(fixtureCtx({ gex: { spot: 100, gamma_posture: "long" } }));
  assert.ok(section);
  assert.equal(section?.title, "Dealer & dark-pool read");
  assert.match(section!.body, /long gamma/i);
  assert.match(section!.body, /dips tend to get bought|stay contained/i);
});

test("dealerTapeSection: narrates short-gamma dealer posture differently", () => {
  const section = dealerTapeSection(fixtureCtx({ gex: { spot: 100, gamma_posture: "short" } }));
  assert.match(section!.body, /short gamma/i);
  assert.match(section!.body, /accelerate/i);
});

test("dealerTapeSection: king strike + confluent max pain called out as one magnet", () => {
  const section = dealerTapeSection(
    fixtureCtx({ gex: { spot: 100, gex_king_strike: 100 }, vec: { maxPain: 100.2 } }),
  );
  assert.match(section!.body, /GEX king strike sits at \*\*100\.00\*\*/);
  assert.match(section!.body, /two independent reads pointing at the same magnet/i);
});

test("dealerTapeSection: non-confluent max pain reported separately, no false confluence claim", () => {
  const section = dealerTapeSection(
    fixtureCtx({ gex: { spot: 100, gex_king_strike: 100 }, vec: { maxPain: 120 } }),
  );
  assert.match(section!.body, /max pain sits at \*\*120\.00\*\*/);
  assert.doesNotMatch(section!.body, /two independent reads pointing at the same magnet/i);
});

test("dealerTapeSection: LONG frames put wall as support to watch, call wall as the ceiling", () => {
  const section = dealerTapeSection(
    fixtureCtx({ direction: "LONG", gex: { spot: 100, call_wall: 110, put_wall: 90 } }),
  );
  assert.match(section!.body, /put wall\s*\n?\s*at \*\*90\.00\*\*/);
  assert.match(section!.body, /call wall at \*\*110\.00\*\*/);
  assert.match(section!.body, /Bottom line.*holds above \*\*90\.00\*\*/s);
});

test("dealerTapeSection: SHORT frames call wall as the level to watch, invalidation is above it", () => {
  const section = dealerTapeSection(
    fixtureCtx({ direction: "SHORT", gex: { spot: 100, call_wall: 110, put_wall: 90 } }),
  );
  assert.match(section!.body, /call wall\s*\n?\s*at \*\*110\.00\*\*/);
  assert.match(section!.body, /Bottom line.*holds below \*\*110\.00\*\*/s);
  assert.equal(section?.bias, "bearish");
});

test("dealerTapeSection: dark-pool print confluent with a GEX wall reads as a block trade agreeing with it", () => {
  const section = dealerTapeSection(
    fixtureCtx({
      gex: { spot: 100, call_wall: 110 },
      vec: { darkPoolLevels: [{ strike: 110.2, premium: 1_500_000, pct: 0.4 }] },
    }),
  );
  assert.match(section!.body, /real institutional size parked at \*\*110\.20\*\*/);
  assert.match(section!.body, /\$1\.5M/);
  assert.match(section!.body, /lines up with the \*\*110\.00\*\* level/);
});

test("dealerTapeSection: dark-pool print with no nearby wall is flagged as standalone, not falsely confluent", () => {
  const section = dealerTapeSection(
    fixtureCtx({
      gex: { spot: 100 },
      vec: { darkPoolLevels: [{ strike: 75, premium: 500_000, pct: 0.2 }] },
    }),
  );
  assert.match(section!.body, /doesn't line up with a GEX wall/);
});

test("dealerTapeSection: a building wall event reads as growing conviction", () => {
  const section = dealerTapeSection(
    fixtureCtx({
      gex: { spot: 100, call_wall: 110 },
      vec: { wallEvents: [{ kind: "call_wall_building", message: "Call wall at 110 is thickening" }] },
    }),
  );
  assert.match(section!.body, /building conviction, not losing it/);
});

test("dealerTapeSection: a fading wall event is flagged, not treated as reassuring", () => {
  const section = dealerTapeSection(
    fixtureCtx({
      gex: { spot: 100, call_wall: 110 },
      vec: { wallEvents: [{ kind: "call_wall_fading", message: "Call wall at 110 is thinning out" }] },
    }),
  );
  assert.match(section!.body, /don't lean on that level as hard/);
});
