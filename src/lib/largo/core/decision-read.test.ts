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

test("assessZerodteBoardState: empty ledger, WATCH fresh find is not on board", () => {
  const ev = buildMarketEvidence(TSLA_EMPTY_BOARD, "TSLA", NVDA_SESSION, Date.now())!;
  const board = assessZerodteBoardState(ev);
  assert.equal(board.consulted, true);
  assert.equal(board.hasOpenPlay, false);
});

test("buildTradeDecisionRead: 0DTE ask with no board play → speculative warning", () => {
  const evidence = buildMarketEvidence(TSLA_EMPTY_BOARD, "TSLA", NVDA_SESSION, Date.now())!;
  const systemReads = extractSystemReads(TSLA_EMPTY_BOARD, "TSLA")!;
  const envelope = makeEnvelope({
    headline: "TSLA scanning",
    levels: evidenceLevelsForEnvelope(evidence),
    systemReads,
    sections: [],
    evidence: [],
  });

  const q = "What could be a good 0DTE play on TSLA?";
  const decision = buildTradeDecisionRead(q, envelope, evidence)!;

  assert.ok(decision);
  assert.equal(decision.isSpeculative, true);
  assert.equal(decision.headlineGlyph, "⚠️");
  assert.match(decision.headline, /NOT ON 0DTE BOARD/);
  assert.equal(decision.actionLabel, "⚠️ SYNTHESIS ONLY — NOT ON BOARD");
  assert.ok(decision.speculativeThesis);
  assert.match(decision.speculativeThesis!.warning, /NOT ON 0DTE BOARD/);
  assert.ok(decision.speculativeThesis!.factors.length >= 2);
});

test("buildTradeDecisionRead: NVDA options-play → withheld levels + existing thesis", () => {
  const evidence = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const systemReads = extractSystemReads(NVDA_TOOL_RESULTS, "NVDA")!;
  const envelope = makeEnvelope({
    headline: "NVDA long call thesis",
    levels: evidenceLevelsForEnvelope(evidence),
    systemReads,
    sections: [],
    evidence: [],
  });

  const q = "What is a good options play to take on NVDA today?";
  const decision = buildTradeDecisionRead(q, envelope, evidence)!;

  assert.ok(decision);
  assert.match(decision.headline, /LEVELS WITHHELD|NO CLEAN FRESH ENTRY/);
  assert.equal(decision.actionLabel, "HOLD — SPOT DISAGREES");
  assert.ok(decision.existingPlay);
  assert.match(decision.approach, /reclaim|wait/i);
  assert.ok(decision.signalRows.some((r) => r.signal === "Helix Flow" || r.signal === "Night Hawk"));
  assert.match(decision.overall, /Overall:/);
});

test("buildTradeDecisionRead returns null for non-trade questions", () => {
  const evidence = buildMarketEvidence(NVDA_TOOL_RESULTS, "NVDA", NVDA_SESSION, Date.now())!;
  const envelope = makeEnvelope({ headline: "NVDA", sections: [], evidence: [] });
  assert.equal(buildTradeDecisionRead("Why is NVDA down?", envelope, evidence), null);
});
