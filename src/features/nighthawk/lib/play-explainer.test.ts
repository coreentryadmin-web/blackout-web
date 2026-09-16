import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroundedPlayExplanationFallback,
  factorBreakdownLines,
  playRiskLines,
} from "./play-explainer-fallback";
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

// 2026-09-16 finding: factor_breakdown is a real, already-computed per-component composite-score
// breakdown (flow/tech/positioning/etc.) that PlaybookBriefingPanel.tsx already shows members as
// "Score components" chips — but it was never surfaced into either the LLM data block or the
// no-LLM fallback's "Why ranked #N" section, even though that section explicitly exists to answer
// exactly this question. Same defect class as the 2026-09-13 fix above.
test("factorBreakdownLines: no factor_breakdown reports nothing", () => {
  assert.deepEqual(factorBreakdownLines({ factor_breakdown: undefined }), []);
});

test("factorBreakdownLines: zero-contribution entries are dropped, non-zero sorted by magnitude descending", () => {
  const lines = factorBreakdownLines({
    factor_breakdown: { flow: 14, tech: -3, positioning: 0, news: 9 },
  });
  assert.deepEqual(lines, ["flow: +14", "news: +9", "tech: -3"]);
});

test("factorBreakdownLines: negative contributions keep their sign, positive get an explicit +", () => {
  const lines = factorBreakdownLines({ factor_breakdown: { smart_money: -5 } });
  assert.deepEqual(lines, ["smart_money: -5"]);
});

test("fallback briefing's Why ranked section includes score drivers when factor_breakdown is present", () => {
  const text = buildGroundedPlayExplanationFallback({
    play: { ...play, factor_breakdown: { flow: 14, positioning: 9, tech: 6 } },
  });
  assert.match(text, /Score drivers \(largest impact first\): flow: \+14, positioning: \+9, tech: \+6/);
});

test("fallback briefing omits the score-drivers line entirely when factor_breakdown is absent", () => {
  const text = buildGroundedPlayExplanationFallback({ play });
  assert.doesNotMatch(text, /Score drivers/);
});
