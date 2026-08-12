import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketEvidence,
  assessZerodteBoardState,
  evidenceLevelsForEnvelope,
} from "./market-evidence";
import { extractSystemReads } from "./system-reads-extract";
import { buildTradeDecisionRead } from "./decision-read";
import { makeEnvelope } from "@/lib/bie/answer-envelope";

const NVDA_SESSION = "2026-08-11";
const NVDA_TOOL_RESULTS = [
  { ticker: "NVDA", spot: 216.7 },
  { ticker: "NVDA", spot_price: 223.52 },
  { ticker: "NVDA", last_price: 216.65 },
  {
    available: true,
    edition_for: "2026-08-11",
    plays: [
      {
        rank: 1,
        ticker: "NVDA",
        direction: "long",
        options_play: "Aug 12 $217.5 call @ $2.42",
        entry_premium: 2.42,
      },
    ],
  },
  { plays: [], fresh_finds: [] },
  { gamma_posture: "short", flip: 219.43, put_wall: 190, vwap: 218.92 },
  {
    play: { bias: "short" },
    emas: { ema20: 209.57, ema50: 206.68 },
    vwap: 218.92,
    trend_stack: "bullish",
  },
  { recent: [{ ticker: "NVDA", strike: 212.5, expiry: "2026-08-21", option_type: "PUT" }] },
];

const TSLA_EMPTY_BOARD = [
  { ticker: "TSLA", spot: 180.5 },
  { plays: [], fresh_finds: [{ ticker: "TSLA", status: "WATCH", direction: "long" }] },
  { gamma_posture: "short", flip: 182, vwap: 181.2 },
  { play: { bias: "long" }, emas: { ema20: 178, ema50: 175 }, vwap: 181.2 },
];

test("assessZerodteBoardState: WATCH fresh find is not on board", () => {
  const ev = buildMarketEvidence(TSLA_EMPTY_BOARD, "TSLA", NVDA_SESSION, Date.now())!;
  const board = assessZerodteBoardState(ev);
  assert.equal(board.consulted, true);
  assert.equal(board.hasOpenPlay, false);
});

test("buildTradeDecisionRead: 0DTE empty board → warning badge, no canned headline", () => {
  const evidence = buildMarketEvidence(TSLA_EMPTY_BOARD, "TSLA", NVDA_SESSION, Date.now())!;
  const systemReads = extractSystemReads(TSLA_EMPTY_BOARD, "TSLA")!;
  const envelope = makeEnvelope({
    headline: "TSLA could work on a reclaim above 182 if flow confirms — not on the board yet.",
    levels: evidenceLevelsForEnvelope(evidence),
    systemReads,
    sections: [],
    evidence: [],
  });

  const decision = buildTradeDecisionRead(
    "What could be a good 0DTE play on TSLA?",
    envelope,
    evidence
  )!;

  assert.ok(decision);
  assert.equal(decision.isSpeculative, true);
  assert.equal(decision.actionLabel, "NOT ON 0DTE BOARD");
  assert.ok(decision.notOnBoardWarning);
  assert.equal(decision.approach, undefined);
  assert.equal(decision.overall, undefined);
  assert.ok(decision.signalRows.length >= 1);
});

test("buildTradeDecisionRead: skips fallback signals when model wrote comparison block", () => {
  const evidence = buildMarketEvidence(TSLA_EMPTY_BOARD, "TSLA", NVDA_SESSION, Date.now())!;
  const envelope = makeEnvelope({ headline: "TSLA wait", sections: [], evidence: [] });
  const decision = buildTradeDecisionRead("0DTE play on TSLA?", envelope, evidence, {
    hasComparisonBlock: true,
  })!;
  assert.deepEqual(decision.signalRows, []);
});

test("buildTradeDecisionRead: spot hold badge only", () => {
  const evidence = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const envelope = makeEnvelope({
    headline: "NVDA — wait for spot to reconcile before sizing.",
    sections: [],
    evidence: [],
  });
  const decision = buildTradeDecisionRead(
    "What is a good options play to take on NVDA today?",
    envelope,
    evidence
  )!;
  assert.equal(decision.actionLabel, "SPOT SOURCES DISAGREE");
  assert.ok(decision.existingPlay);
});

test("buildTradeDecisionRead returns null for non-trade questions", () => {
  const evidence = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const envelope = makeEnvelope({ headline: "NVDA", sections: [], evidence: [] });
  assert.equal(buildTradeDecisionRead("Why is NVDA down?", envelope, evidence), null);
});
