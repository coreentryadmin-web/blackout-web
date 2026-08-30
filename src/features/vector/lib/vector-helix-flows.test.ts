import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLiveHelixByPremium,
  filterByMaxDte,
  filterFlowsSinceSessionOpen,
  filterVectorHelixFlows,
  hoursSinceSessionOpen,
  isFlowSinceSessionOpen,
  pickVectorLiveHelixLayout,
  prepareVectorLiveHelixTape,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_HELIX_RANKED_MAX_DTE,
  VECTOR_HELIX_RECENT_MAX_DTE,
  VECTOR_HELIX_WHALE_PREMIUM,
  VECTOR_LIVE_HELIX_RANKED_DISPLAY_N,
  VECTOR_LIVE_HELIX_RECENT_N,
  VECTOR_LIVE_HELIX_TAPE_CAP,
  vectorLiveHelixSubtitle,
} from "./vector-helix-flows";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";
import type { FlowAlert } from "@/lib/api";
import { sessionOpenMs } from "@/lib/largo/temporal/timeframe";

function flow(partial: Partial<FlowAlert> & Pick<FlowAlert, "premium">): FlowAlert {
  return {
    ticker: "NVDA",
    premium: partial.premium,
    option_type: partial.option_type ?? "CALL",
    expiry: partial.expiry ?? "2026-08-15",
    strike: partial.strike ?? 900,
    direction: "BUY",
    score: partial.score ?? 7,
    route: "whale",
    alerted_at: partial.alerted_at ?? "2026-08-15T14:00:00Z",
    ...partial,
  };
}

const defaultFilters = {
  typeFilter: "ALL" as const,
  whalesOnly: false,
  dteOnly: false,
  minPremium: VECTOR_HELIX_MIN_PREMIUM,
};

const midday = Date.parse("2026-08-15T14:00:00-04:00");
const sessionOpen = sessionOpenMs(midday);

test("filterVectorHelixFlows: whales + side + 0DTE", () => {
  const rows = [
    flow({ premium: 1_500_000, option_type: "CALL", dte: 0 }),
    flow({ premium: 900_000, option_type: "PUT", dte: 0 }),
    flow({ premium: 2_000_000, option_type: "CALL", dte: 5 }),
  ];
  const whales = filterVectorHelixFlows(rows, {
    typeFilter: "ALL",
    whalesOnly: true,
    dteOnly: false,
    minPremium: 200_000,
  });
  assert.equal(whales.length, 2);
  assert.ok(whales.every((r) => r.premium >= VECTOR_HELIX_WHALE_PREMIUM));

  const dte0 = filterVectorHelixFlows(rows, {
    typeFilter: "ALL",
    whalesOnly: false,
    dteOnly: true,
    minPremium: 200_000,
  });
  assert.equal(dte0.length, 2);
});

test("isFlowSinceSessionOpen: rejects pre-open prints", () => {
  const preOpen = flow({ premium: 500_000, alerted_at: "2026-08-15T13:00:00Z" });
  const afterOpen = flow({ premium: 500_000, alerted_at: "2026-08-15T14:00:00Z" });
  assert.equal(isFlowSinceSessionOpen(preOpen, sessionOpen), false);
  assert.equal(isFlowSinceSessionOpen(afterOpen, sessionOpen), true);
});

test("prepareVectorLiveHelixTape: early session leader stays #1 all day", () => {
  const openLeader = flow({
    premium: 500_000,
    alerted_at: "2026-08-15T13:35:00Z",
    strike: 900,
  });
  const laterSmaller = Array.from({ length: 8 }, (_, i) =>
    flow({
      premium: 220_000 + i * 10_000,
      alerted_at: `2026-08-15T1${5 + Math.floor(i / 6)}:${String((i * 7) % 60).padStart(2, "0")}:00Z`,
      strike: 901 + i,
    })
  );
  const tape = prepareVectorLiveHelixTape([openLeader, ...laterSmaller], defaultFilters);
  assert.equal(tape[0]!.premium, 500_000);
  assert.equal(tape[0]!.strike, 900);
});

test("prepareVectorLiveHelixTape: larger live print later takes #1", () => {
  const rows = [
    flow({ premium: 500_000, alerted_at: "2026-08-15T13:35:00Z", strike: 900 }),
    flow({ premium: 800_000, alerted_at: "2026-08-15T18:00:00Z", strike: 901 }),
    flow({ premium: 300_000, alerted_at: "2026-08-15T17:00:00Z", strike: 902 }),
  ];
  const tape = prepareVectorLiveHelixTape(rows, defaultFilters);
  assert.equal(tape[0]!.premium, 800_000);
  assert.equal(tape[1]!.premium, 500_000);
});

test("prepareVectorLiveHelixTape: thin tickers surface without major floor", () => {
  const asts = Array.from({ length: 4 }, (_, i) =>
    flow({
      ticker: "ASTS",
      premium: 210_000 + i * 15_000,
      strike: 20 + i,
      alerted_at: `2026-08-15T14:${String(10 + i).padStart(2, "0")}:00Z`,
    })
  );
  const tape = prepareVectorLiveHelixTape(asts, defaultFilters);
  assert.equal(tape.length, 4);
  assert.ok(tape.every((r) => r.premium >= VECTOR_HELIX_MIN_PREMIUM));
});

test("filterFlowsSinceSessionOpen: mid-day fetch excludes prior days", () => {
  const openMs = sessionOpenMs(midday);
  const rows = [
    flow({ premium: 500_000, alerted_at: "2026-08-14T14:00:00Z" }),
    flow({ premium: 500_000, alerted_at: "2026-08-15T14:00:00Z" }),
  ];
  const today = filterFlowsSinceSessionOpen(rows, openMs);
  assert.equal(today.length, 1);
  assert.ok(isFlowSinceSessionOpen(today[0]!, openMs));
});

test("hoursSinceSessionOpen: scales with clock", () => {
  const elevenEt = Date.parse("2026-08-15T11:00:00-04:00");
  assert.ok(hoursSinceSessionOpen(elevenEt) >= 1);
  assert.ok(hoursSinceSessionOpen(elevenEt) <= 24);
});

test("prepareVectorLiveHelixTape: mid-day join still ranks morning leader #1", () => {
  const morning = flow({
    premium: 500_000,
    alerted_at: "2026-08-15T13:35:00Z",
    strike: 900,
  });
  const midDay = Array.from({ length: 5 }, (_, i) =>
    flow({
      premium: 220_000 + i * 10_000,
      alerted_at: `2026-08-15T1${5 + i}:00:00Z`,
      strike: 901 + i,
    })
  );
  const tape = prepareVectorLiveHelixTape([morning, ...midDay], defaultFilters);
  assert.equal(tape[0]!.premium, 500_000);
});

test("pickVectorLiveHelixLayout: recent strip shows newest, ranked keeps session #1", () => {
  const morningLeader = flow({
    premium: 500_000,
    alerted_at: "2026-08-15T13:35:00Z",
    strike: 900,
  });
  const newestSmall = flow({
    premium: 250_000,
    alerted_at: "2026-08-15T20:00:00Z",
    strike: 901,
  });
  const mid = flow({
    premium: 280_000,
    alerted_at: "2026-08-15T18:00:00Z",
    strike: 902,
  });
  const layout = pickVectorLiveHelixLayout([morningLeader, newestSmall, mid], defaultFilters);
  assert.equal(layout.recent.length, 2);
  assert.equal(layout.recent[0]!.strike, 901);
  assert.equal(layout.ranked.length, 1);
  assert.equal(layout.ranked[0]!.premium, 500_000);
});

test("pickVectorLiveHelixLayout: dedupes recent from ranked", () => {
  const only = flow({ premium: 500_000, alerted_at: "2026-08-15T20:00:00Z", strike: 900 });
  const layout = pickVectorLiveHelixLayout([only], defaultFilters);
  assert.equal(layout.recent.length, 0);
  assert.equal(layout.ranked.length, 1);
  assert.equal(layout.ranked[0]!.premium, 500_000);
});

test("pickVectorLiveHelixLayout: newest session leader stays ranked #1 not recent", () => {
  const leader = flow({ premium: 800_000, alerted_at: "2026-08-15T20:00:00Z", strike: 900 });
  const older = flow({ premium: 500_000, alerted_at: "2026-08-15T13:35:00Z", strike: 901 });
  const layout = pickVectorLiveHelixLayout([leader, older], defaultFilters);
  assert.equal(layout.ranked[0]!.premium, 800_000);
  assert.equal(layout.recent.length, 1);
  assert.equal(layout.recent[0]!.premium, 500_000);
});

test("vectorLiveHelixSubtitle: mentions Recent when strip populated", () => {
  assert.match(
    vectorLiveHelixSubtitle({ recent: [flow({ premium: 300_000 })], ranked: [] }, true),
    /Recent/i
  );
  assert.match(vectorLiveHelixSubtitle({ recent: [], ranked: [] }, false), /session closed/i);
});

test("trimVectorHelixFlowPool: keeps largest prints not newest", () => {
  const rows = [
    flow({ premium: 250_000, alerted_at: "2026-08-15T20:00:00Z" }),
    flow({ premium: 500_000, alerted_at: "2026-08-15T13:35:00Z" }),
    flow({ premium: 300_000, alerted_at: "2026-08-15T18:00:00Z" }),
  ];
  const trimmed = trimVectorHelixFlowPool(rows, 2);
  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[0]!.premium, 500_000);
  assert.equal(trimmed[1]!.premium, 300_000);
});

test("compareLiveHelixByPremium: premium beats time", () => {
  const early = flow({ premium: 500_000, alerted_at: "2026-08-15T13:35:00Z" });
  const late = flow({ premium: 250_000, alerted_at: "2026-08-15T20:00:00Z" });
  assert.ok(compareLiveHelixByPremium(early, late) < 0);
});

// ── DTE filter + fallback (operator feedback 2026-08-27: "we show flows that expire 500 days
// from now, who cares?? we need to show nearby expiry flows") ──────────────────────────────────

test("filterByMaxDte: keeps only flows within the ceiling", () => {
  const rows = [
    flow({ premium: 300_000, dte: 5, strike: 100 }),
    flow({ premium: 300_000, dte: 30, strike: 101 }),
    flow({ premium: 300_000, dte: 31, strike: 102 }),
    flow({ premium: 300_000, dte: 477, strike: 103 }),
  ];
  const within30 = filterByMaxDte(rows, 30, 10);
  assert.deepEqual(
    within30.map((f) => f.strike),
    [100, 101]
  );
});

test("filterByMaxDte: honest fallback to nearest-DTE flows when the window matches nothing", () => {
  // Reproduces the live ASTS finding (2026-08-27 audit run): every real print that day was
  // far-dated (141d, 568d, 50d) — a strict ceiling with no fallback would blank the section
  // entirely even though real data exists.
  const rows = [
    flow({ premium: 435_134, dte: 141, strike: 1 }),
    flow({ premium: 251_000, dte: 568, strike: 2 }),
    flow({ premium: 247_000, dte: 50, strike: 3 }),
  ];
  const result = filterByMaxDte(rows, 45, 2);
  assert.equal(result.length, 2, "must not blank the section when real data exists");
  // Nearest-DTE first: 50d, then 141d (568d is furthest, excluded by fallbackN=2).
  assert.deepEqual(
    result.map((f) => f.strike),
    [3, 1]
  );
});

test("filterByMaxDte: empty input stays empty (no fabricated fallback rows)", () => {
  assert.deepEqual(filterByMaxDte([], 30, 5), []);
});

test("trimVectorHelixFlowPool: a far-dated whale cannot crowd out near-dated prints from the pool", () => {
  // Reproduces the live SPX finding (2026-08-27 audit run): the top 40-by-premium prints out of
  // a 200-row session fetch were ALL >45 DTE, so a plain premium sort discarded every near-dated
  // print before any section-level DTE filter could run at all.
  const farWhale = flow({ premium: 31_400_000, dte: 85, strike: 1 });
  const nearDated = Array.from({ length: 5 }, (_, i) =>
    flow({ premium: 300_000 + i * 10_000, dte: 5 + i, strike: 100 + i })
  );
  const pool = trimVectorHelixFlowPool([farWhale, ...nearDated], 3);
  assert.equal(pool.length, 3);
  assert.ok(
    pool.every((f) => f.strike !== 1),
    "the 85-DTE whale must not occupy a pool slot ahead of near-dated prints"
  );
});

test("trimVectorHelixFlowPool: honest fallback when the whole pool is genuinely far-dated", () => {
  const rows = [flow({ premium: 500_000, dte: 200, strike: 1 })];
  const pool = trimVectorHelixFlowPool(rows, 5);
  assert.equal(pool.length, 1, "a genuinely far-dated-only pool must still surface its one print");
});

test("pickVectorLiveHelixLayout: excludes far-dated LEAPS from Recent and Top-by-premium", () => {
  const leapsWhale = flow({ premium: 19_900_000, dte: 477, alerted_at: "2026-08-15T19:00:00Z", strike: 1 });
  const nearDated = Array.from({ length: 5 }, (_, i) =>
    flow({
      premium: 250_000 + i * 5_000,
      dte: 3 + i,
      alerted_at: `2026-08-15T1${4 + i}:00:00Z`,
      strike: 100 + i,
    })
  );
  const layout = pickVectorLiveHelixLayout([leapsWhale, ...nearDated], defaultFilters);
  assert.ok(
    layout.ranked.every((f) => f.strike !== 1),
    "a 477-DTE print must never rank #1 by premium ahead of near-dated prints"
  );
  assert.ok(layout.recent.every((f) => f.strike !== 1));
  assert.ok(layout.ranked.every((f) => (f.dte ?? 999) <= VECTOR_HELIX_RANKED_MAX_DTE));
  assert.ok(layout.recent.every((f) => (f.dte ?? 999) <= VECTOR_HELIX_RECENT_MAX_DTE));
});

test("pickVectorLiveHelixLayout: default caps raised to ~15 per section", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    flow({
      premium: 250_000 + i * 1_000,
      dte: i % 20, // stay within both DTE ceilings
      alerted_at: `2026-08-15T${String(10 + Math.floor(i / 6)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00Z`,
      strike: 200 + i,
    })
  );
  const layout = pickVectorLiveHelixLayout(rows, defaultFilters);
  assert.equal(layout.recent.length, VECTOR_LIVE_HELIX_RECENT_N);
  assert.equal(layout.ranked.length, VECTOR_LIVE_HELIX_RANKED_DISPLAY_N);
  assert.equal(VECTOR_LIVE_HELIX_RECENT_N, 15);
  assert.equal(VECTOR_LIVE_HELIX_RANKED_DISPLAY_N, 15);
});

test("prepareVectorLiveHelixTape: respects tape cap", () => {
  const rows = Array.from({ length: VECTOR_LIVE_HELIX_TAPE_CAP + 5 }, (_, i) =>
    flow({
      premium: 300_000 + i * 10_000,
      strike: 900 + i,
      alerted_at: `2026-08-15T14:${String(i).padStart(2, "0")}:00Z`,
    })
  );
  assert.equal(prepareVectorLiveHelixTape(rows, defaultFilters).length, VECTOR_LIVE_HELIX_TAPE_CAP);
});
