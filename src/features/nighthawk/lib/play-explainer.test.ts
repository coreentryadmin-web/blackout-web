import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundedPlayExplanationFallback, playRiskLines } from "./play-explainer-fallback";
import { checkNumbersGrounded, extractNumbersFromText } from "@/lib/grounding-guard";
import type { PlaybookPlay } from "./types";

const play: PlaybookPlay = {
  rank: 1,
  ticker: "NBIS",
  direction: "LONG",
  conviction: "A",
  play_type: "stock",
  thesis: "NBIS call setup",
  key_signal: "NBIS call setup",
  entry_range: "Breakout above $300",
  target: "$330",
  stop: "$285",
  options_play: "NBIS $300 Call 2026-09-18 entry prem ~$45.10",
  entry_premium: 45.1,
  entry_cost_per_contract: 4510,
  premium_cap_ok: false,
  score: 90,
};

test("grounded play explanation fallback is card-only and does not disclose providers", () => {
  const text = buildGroundedPlayExplanationFallback({ play });

  assert.match(text, /NBIS \$300 Call 2026-09-18/);
  assert.match(text, /\$45\.1\/share/);
  assert.doesNotMatch(text, /Claude|Anthropic|API_KEY|provider/i);
});

// generatePlayExplanation's grounding check runs extractNumbersFromText over the same
// play-card text the prompt is built from. buildGroundedPlayExplanationFallback (above) is a
// server-only-free stand-in with the same numeric content (entry/target/stop/premium), so
// these tests exercise the exact same mechanism without pulling in play-explainer.ts's
// transitive "server-only" import chain (via fetchTickerDossier) into the test runner.
test("grounding guard: a briefing citing only play-card numbers passes", () => {
  const known = extractNumbersFromText(buildGroundedPlayExplanationFallback({ play }));
  const briefing = "Entry above 300 targets 330 with a stop at 285; premium runs 45.1/share.";
  const result = checkNumbersGrounded(briefing, known);
  assert.equal(result.grounded, true);
});

test("grounding guard: a briefing citing a hallucinated level fails", () => {
  const known = extractNumbersFromText(buildGroundedPlayExplanationFallback({ play }));
  const briefing = "Watch for a breakout continuation toward 415, a level not on the card.";
  const result = checkNumbersGrounded(briefing, known);
  assert.equal(result.grounded, false);
  assert.equal(result.ungroundedValue, 415);
});

// 2026-09-13 finding: earnings_risk and gate_promoted/gate_warnings are real, already-computed
// risk signals on the play object that used to be silently dropped from the "Risks &
// invalidation" section of both the LLM data block (play-explainer.ts's formatPlayBlock) and
// this no-LLM fallback, even though that section explicitly promises risk/invalidation coverage.
test("playRiskLines: plain risk_note-only play reports just the risk note", () => {
  const lines = playRiskLines(play);
  assert.deepEqual(lines, []);
});

test("playRiskLines: earnings_risk surfaces as an explicit risk line", () => {
  const lines = playRiskLines({ ...play, earnings_risk: true });
  assert.ok(lines.some((l) => /earnings risk/i.test(l) && /hold window/i.test(l)));
});

test("playRiskLines: gate_promoted surfaces the promotion warning plus every gate_warnings entry", () => {
  const lines = playRiskLines({
    ...play,
    gate_promoted: true,
    gate_warnings: ["Did not clear the score floor", "Target distance exceeds the reachability band"],
  });
  assert.ok(lines.some((l) => /gate-promoted/i.test(l)));
  assert.ok(lines.some((l) => l.includes("Did not clear the score floor")));
  assert.ok(lines.some((l) => l.includes("Target distance exceeds the reachability band")));
});

test("fallback briefing's Risks & invalidation section includes earnings_risk and gate_promoted warnings when present", () => {
  const text = buildGroundedPlayExplanationFallback({
    play: {
      ...play,
      earnings_risk: true,
      gate_promoted: true,
      gate_warnings: ["Play did not pass the critic's quality review — use extra caution"],
    },
  });
  assert.match(text, /Earnings risk: this name reports earnings within the play's hold window\./);
  assert.match(text, /Gate-promoted:/);
  assert.match(text, /Play did not pass the critic's quality review/);
});

test("fallback briefing omits risk_note fallback text once a real risk signal exists, but keeps a real risk_note alongside it", () => {
  const text = buildGroundedPlayExplanationFallback({
    play: { ...play, risk_note: "Watch the $310 gap fill", earnings_risk: true },
  });
  assert.match(text, /Watch the \$310 gap fill/);
  assert.match(text, /Earnings risk:/);
  assert.doesNotMatch(text, /no additional risk note was generated/);
});
