import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketEvidence,
  buildSpotConsensus,
  classifyOptionHorizon,
  computeTrendStack,
  extractNightHawkState,
  mergeEvidenceIssues,
  validateProseAgainstEvidence,
  applyEvidenceIntegrityCaveat,
  PRECISE_REC_BLOCK_SPREAD_PCT,
} from "./market-evidence";
import { extractSystemReads } from "./system-reads-extract";

/** NVDA regression fixture — measured live 2026-08-11 options-play question. */
const NVDA_SESSION = "2026-08-11";

const NVDA_TOOL_RESULTS = [
  { ticker: "NVDA", spot: 216.7, change_pct: -2.26 },
  { ticker: "NVDA", spot_price: 223.52 },
  { ticker: "NVDA", last_price: 216.65 },
  {
    available: true,
    edition_for: "2026-08-11",
    published_at: "2026-08-10T21:35:40Z",
    plays: [
      {
        rank: 1,
        ticker: "NVDA",
        direction: "long",
        conviction: "B",
        options_play: "Aug 12 $217.5 call @ $2.42",
        entry_premium: 2.42,
        score: 86,
      },
    ],
  },
  {
    plays: [],
    fresh_finds: [{ ticker: "TSLA", status: "WATCH" }],
  },
  {
    gamma_posture: "short",
    spot: 216.7,
    flip: 219.43,
    call_wall: 225,
    put_wall: 190,
    magnet: 225.62,
  },
  {
    play: { bias: "short", grade: "A", conviction: 76 },
    spot: 216.7,
    emas: { ema20: 209.57, ema50: 206.68, ema200: 193.22 },
    rsi14: 37.79,
    vwap: 218.92,
    trend_stack: "bullish",
  },
  {
    recent: [
      { ticker: "NVDA", strike: 217.5, expiry: "2026-08-24", premium: 2_500_000, option_type: "CALL" },
      { ticker: "NVDA", strike: 220, expiry: "2026-12-17", premium: 9_600_000, option_type: "CALL" },
      { ticker: "NVDA", strike: 212.5, expiry: "2026-08-21", premium: 2_200_000, option_type: "PUT" },
    ],
  },
];

test("classifyOptionHorizon: Aug 24 on Aug 11 is SWING, not 0DTE", () => {
  assert.equal(classifyOptionHorizon("2026-08-24", NVDA_SESSION), "SWING");
  assert.equal(classifyOptionHorizon("2026-08-12", NVDA_SESSION), "1DTE");
  assert.equal(classifyOptionHorizon("2026-08-11", NVDA_SESSION), "0DTE");
  assert.equal(classifyOptionHorizon("2026-12-17", NVDA_SESSION), "LEAP");
});

test("computeTrendStack: spot above rising EMAs is bullish, not bearish", () => {
  assert.equal(computeTrendStack(216.7, 209.57, 206.68), "bullish");
  assert.equal(computeTrendStack(200, 209.57, 206.68), "mixed");
});

test("extractNightHawkState: edition pick present while zerodte board empty for NVDA", () => {
  const nh = extractNightHawkState(NVDA_TOOL_RESULTS, "NVDA")!;
  assert.equal(nh.edition.length, 1);
  assert.equal(nh.zerodte.length, 0);
  assert.equal(nh.forTicker.length, 1);
  assert.equal(nh.forTicker[0]!.product, "edition");
  assert.equal(nh.forTicker[0]!.direction, "long");
});

test("system reads: Night Hawk row cites evening edition, not 'no plays'", () => {
  const block = extractSystemReads(NVDA_TOOL_RESULTS, "NVDA")!;
  const nh = block.reads.find((r) => r.system === "NIGHT HAWK")!;
  assert.equal(nh.stance, "bullish");
  assert.match(nh.basis, /evening edition/);
  assert.notEqual(nh.basis, "no plays");
});

test("buildSpotConsensus: material disagreement blocks precise recommendations", () => {
  const spot = buildSpotConsensus(NVDA_TOOL_RESULTS, "NVDA")!;
  assert.ok(spot.conflict);
  assert.ok(spot.conflict!.spreadPct >= PRECISE_REC_BLOCK_SPREAD_PCT);
  assert.equal(spot.preciseRecommendationsBlocked, true);
});

test("buildMarketEvidence: put wall is 190, flow put strike is separate", () => {
  const ev = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  assert.equal(ev.walls.putWall, 190);
  assert.equal(ev.walls.callWall, 225);
  assert.equal(ev.walls.gammaFlip, 219.43);
  assert.ok(ev.flowContracts.some((f) => f.strike === 212.5 && f.right === "P"));
  assert.ok(ev.levels.some((l) => l.type === "PUT_WALL" && l.price === 190));
  assert.ok(ev.levels.some((l) => l.type === "FLOW_STRIKE" && l.price === 212.5));
  assert.equal(ev.preciseRecommendationsBlocked, true);
});

test("validateProseAgainstEvidence: catches EMA stack down when computed bullish", () => {
  const ev = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const prose =
    "Structure conflicts: EMA stack down, RSI oversold. Put wall at 212.5. Aug 24 0DTE flow stack.";
  const issues = validateProseAgainstEvidence(prose, ev);
  assert.ok(issues.some((i) => i.code === "technical_mismatch"));
  assert.ok(issues.some((i) => i.code === "entity_type_confusion"));
  assert.ok(issues.some((i) => i.code === "spot_disagreement"));
});

test("applyEvidenceIntegrityCaveat: fail-closed message when spot disagrees", () => {
  const ev = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const merged = mergeEvidenceIssues(ev, "Entry $2.42 stop 215.50");
  const out = applyEvidenceIntegrityCaveat("answer body", merged);
  assert.match(out, /Data integrity hold/);
  assert.match(out, /withheld/);
});
