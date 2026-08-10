import test from "node:test";
import assert from "node:assert/strict";
import { routeVisual, TEMPLATES } from "./router";
import { consensusOf } from "./templates/system-comparison";
import type { VisualBundle, VisualSystemRead } from "./types";

/**
 * PHASE 3 — GAMMA_MAP · FLOW_RECAP · TRADE_LEADERBOARD · SYSTEM_COMPARISON · BEFORE_AFTER ·
 * SESSION_RECAP · SIGNAL_TIMELINE.
 *
 * These tests are mostly about what the router REFUSES, because for this batch the dangerous
 * failure is not a broken layout — it is a card that renders beautifully while overstating what
 * was measured. A leaderboard with a broken denominator, a "what changed" with one timestamp, and
 * a consensus verdict counting silence as agreement are all things that would look completely
 * normal in review.
 */

const base: VisualBundle = { systemsQueried: ["THERMAL"], asOf: "2026-08-10T19:55:00Z" };

// ── GAMMA_MAP ───────────────────────────────────────────────────────────────────────────────

const profile = (n: number): VisualBundle => ({
  ...base,
  gammaProfile: {
    source: "THERMAL",
    flipStrike: 7700,
    rows: Array.from({ length: n }, (_, i) => ({ strike: 7600 + i * 50, gamma: (i - 2) * 1e9, display: `$${i}B` })),
  },
});

test("a gamma PROFILE needs five strikes — three bars is not a distribution", () => {
  assert.notEqual(routeVisual("show the gamma profile", profile(4))?.template, "GAMMA_MAP");
  assert.equal(routeVisual("show the gamma profile", profile(5))!.template, "GAMMA_MAP");
});

test("gamma-map intent does not steal a plain level question", () => {
  // LEVEL_ANALYSIS sits earlier in the registry AND matches "gamma flip", so a level question on a
  // bundle carrying both must still land on the ladder.
  const both: VisualBundle = {
    ...profile(8),
    spot: { value: 7772, display: "7,772", source: "THERMAL" },
    levels: [{ label: "Call wall", price: 7800, display: "7,800", kind: "resistance", source: "THERMAL" }],
  };
  assert.equal(routeVisual("where is the gamma flip", both)!.template, "LEVEL_ANALYSIS");
});

// ── FLOW_RECAP ──────────────────────────────────────────────────────────────────────────────

const tape = (n: number, gross = "$318.7M"): VisualBundle => ({
  ...base,
  flow: {
    windowLabel: "13:00–16:00 ET",
    netDisplay: "+$41.2M",
    grossDisplay: gross,
    callShare: 0.63,
    printCount: 214,
    rows: Array.from({ length: n }, (_, i) => ({
      ticker: `T${i}`,
      side: (i % 2 ? "put" : "call") as "put" | "call",
      premiumDisplay: "+$1.0M",
    })),
  },
});

test("a tape without its window totals is a sample presented as the whole tape", () => {
  assert.notEqual(routeVisual("flow recap", tape(5, ""))?.template, "FLOW_RECAP");
  assert.equal(routeVisual("flow recap", tape(5))!.template, "FLOW_RECAP");
});

test("three prints minimum", () => {
  assert.notEqual(routeVisual("show me the sweeps", tape(2))?.template, "FLOW_RECAP");
  assert.equal(routeVisual("show me the sweeps", tape(3))!.template, "FLOW_RECAP");
});

// ── TRADE_LEADERBOARD ───────────────────────────────────────────────────────────────────────

const board = (over: Partial<NonNullable<VisualBundle["leaderboard"]>> = {}): VisualBundle => ({
  ...base,
  leaderboard: {
    source: "NIGHT HAWK",
    windowLabel: "Aug 4 – Aug 8",
    graded: 17,
    wins: 11,
    losses: 6,
    winRateDisplay: "64.7%",
    rows: [
      { ticker: "NVDA", returnValue: 112.4, returnDisplay: "+112.4%" },
      { ticker: "MU", returnValue: -50, returnDisplay: "−50.0%" },
    ],
    ...over,
  },
});

test("a leaderboard whose denominator is smaller than the rows it draws is refused", () => {
  // Would render "showing 2 of 1 graded trades" — a broken denominator on a performance claim.
  assert.notEqual(routeVisual("leaderboard", board({ graded: 1 }))?.template, "TRADE_LEADERBOARD");
  assert.equal(routeVisual("leaderboard", board())!.template, "TRADE_LEADERBOARD");
});

test("wins plus losses cannot exceed the graded count", () => {
  assert.notEqual(routeVisual("leaderboard", board({ wins: 12, losses: 9 }))?.template, "TRADE_LEADERBOARD");
});

test("one row is a trade recap, not a leaderboard", () => {
  assert.notEqual(
    routeVisual("leaderboard", board({ rows: [{ ticker: "NVDA", returnValue: 1, returnDisplay: "+1%" }] }))?.template,
    "TRADE_LEADERBOARD",
  );
});

// ── SYSTEM_COMPARISON ───────────────────────────────────────────────────────────────────────

const reads = (...r: VisualSystemRead[]): VisualBundle => ({ ...base, systemReads: r });
const R = (system: VisualSystemRead["system"], stance: VisualSystemRead["stance"]): VisualSystemRead => ({ system, stance });

test("silence is never counted as agreement", () => {
  // Three systems, one direction, two abstaining. Calling that AGREEMENT would manufacture
  // consensus out of no-reads — the exact thing system-reads.ts refuses in the answer layer.
  const v = consensusOf([R("HELIX", "bullish"), R("THERMAL", "regime"), R("VECTOR", "no-read")]);
  assert.equal(v.label, "SPLIT");
  assert.match(v.detail, /no directional read/);
});

test("a genuine contradiction reads DIVIDED, not softened", () => {
  const v = consensusOf([R("HELIX", "bullish"), R("VECTOR", "bearish"), R("THERMAL", "regime")]);
  assert.equal(v.label, "DIVIDED");
  assert.match(v.detail, /1 bullish vs 1 bearish/);
});

test("unanimous directional reads with nobody abstaining is the only AGREEMENT", () => {
  assert.equal(consensusOf([R("HELIX", "bullish"), R("VECTOR", "bullish"), R("NIGHT HAWK", "bullish")]).label, "AGREEMENT");
});

test("no system taking a direction is SPLIT, never a verdict", () => {
  const v = consensusOf([R("HELIX", "neutral"), R("THERMAL", "regime"), R("VECTOR", "no-read")]);
  assert.equal(v.label, "SPLIT");
  assert.match(v.detail, /no system took a direction/);
});

test("two systems cannot establish a consensus", () => {
  assert.notEqual(routeVisual("do the systems agree", reads(R("HELIX", "bullish"), R("VECTOR", "bearish")))?.template, "SYSTEM_COMPARISON");
  assert.equal(
    routeVisual("do the systems agree", reads(R("HELIX", "bullish"), R("VECTOR", "bearish"), R("THERMAL", "regime")))!.template,
    "SYSTEM_COMPARISON",
  );
});

// ── BEFORE_AFTER ────────────────────────────────────────────────────────────────────────────

const changed = (over: Partial<NonNullable<VisualBundle["beforeAfter"]>> = {}): VisualBundle => ({
  ...base,
  beforeAfter: {
    windowLabel: "last 30 minutes",
    beforeLabel: "15:25 ET",
    afterLabel: "15:55 ET",
    rows: [
      { label: "Spot", beforeDisplay: "7,758.20", afterDisplay: "7,772.94", deltaDisplay: "+14.74", direction: "up", source: "VECTOR" },
      { label: "Put wall", beforeDisplay: "7,400", afterDisplay: "7,600", deltaDisplay: "+200", direction: "up", source: "THERMAL" },
    ],
    ...over,
  },
});

test("a change card with only one timestamp cannot be checked, so it is refused", () => {
  assert.notEqual(routeVisual("what changed", changed({ beforeLabel: "" }))?.template, "BEFORE_AFTER");
  assert.notEqual(routeVisual("what changed", changed({ afterLabel: "" }))?.template, "BEFORE_AFTER");
  assert.equal(routeVisual("what changed", changed())!.template, "BEFORE_AFTER");
});

// ── SESSION_RECAP ───────────────────────────────────────────────────────────────────────────

const session = (over: Partial<NonNullable<VisualBundle["session"]>> = {}): VisualBundle => ({
  ...base,
  session: {
    source: "VECTOR",
    dateLabel: "Mon 10 Aug",
    openDisplay: "7,712.40",
    highDisplay: "7,779.10",
    lowDisplay: "7,698.55",
    closeDisplay: "7,772.94",
    changeDisplay: "+0.78%",
    changeDirection: "up",
    rangeDisplay: "80.55 pts",
    stats: [],
    ...over,
  },
});

test("a recap without a settled close is a forecast, not a recap", () => {
  assert.notEqual(routeVisual("session recap", session({ closeDisplay: "" }))?.template, "SESSION_RECAP");
  assert.equal(routeVisual("session recap", session())!.template, "SESSION_RECAP");
});

test("a recap missing an extreme is refused — the card's geometry is the OHLC relationship", () => {
  assert.notEqual(routeVisual("session recap", session({ highDisplay: "" }))?.template, "SESSION_RECAP");
  assert.notEqual(routeVisual("session recap", session({ lowDisplay: "" }))?.template, "SESSION_RECAP");
});

// ── SIGNAL_TIMELINE ─────────────────────────────────────────────────────────────────────────

const steps = (n: number): VisualBundle => ({
  ...base,
  timeline: Array.from({ length: n }, (_, i) => ({ label: `Step ${i}`, time: `10:0${i}` })),
});

test("three events is a lifecycle — TRADE_RECAP draws it better, so the timeline needs four", () => {
  assert.notEqual(routeVisual("give me the timeline", steps(3))?.template, "SIGNAL_TIMELINE");
  assert.equal(routeVisual("give me the timeline", steps(4))!.template, "SIGNAL_TIMELINE");
});

test("a timeline question on a bundle with a trade still prefers TRADE_RECAP", () => {
  // TRADE_RECAP is earlier in the registry, and a recap that ends in a number answers more than a
  // bare sequence does when both are available.
  const withTrade: VisualBundle = {
    ...steps(6),
    trade: {
      ticker: "NVDA",
      direction: "long",
      entry: { value: 4.2, display: "$4.20", source: "NIGHT HAWK" },
      graded: true,
      source: "NIGHT HAWK",
    },
  };
  assert.equal(routeVisual("what was the entry", withTrade)!.template, "TRADE_RECAP");
});

// ── Registry invariants ─────────────────────────────────────────────────────────────────────

test("every registered template has a distinct id and a real sufficiency predicate", () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate template id");
  const empty: VisualBundle = { systemsQueried: [], asOf: base.asOf };
  for (const t of TEMPLATES) {
    // Nothing may be drawable from an empty bundle. A predicate that returns true here would let
    // a card render with no evidence at all.
    assert.equal(t.sufficient(empty), false, `${t.id} claims an empty bundle is sufficient`);
  }
});
