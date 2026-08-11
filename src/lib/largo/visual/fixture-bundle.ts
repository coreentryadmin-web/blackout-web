import type { VisualBundle } from "./types";

/**
 * A DENSE, TYPE-CHECKED BUNDLE FOR MEASURING THE COMPOSER.
 *
 * WHY IT LIVES IN `src/` RATHER THAN NEXT TO THE HARNESS THAT USES IT. Every extractor bug found
 * in this work traced back to a fixture whose shape was INVENTED — a key name or nesting the
 * emitting code does not actually produce, which then made the test agree with the bug. A fixture
 * declared `VisualBundle` cannot drift from the real shape without `tsc` saying so, and the first
 * draft of this one (written outside the type) was already wrong: its playbook rows omitted
 * `direction`, which the template dereferences.
 *
 * IT IS DELIBERATELY OVER-FULL. The packer's interesting behaviour is what it does when the
 * evidence exceeds the canvas — which blocks it drops and how much canvas it leaves blank doing
 * it. A bundle that fits tells you nothing about either.
 */
export const FIXTURE_QUESTION = "Generate how NVDA looks today";

export function richFixtureBundle(): VisualBundle {
  return {
    systemsQueried: ["THERMAL", "HELIX", "VECTOR"],
    asOf: "2026-08-11T15:42:00Z",
    ticker: "NVDA",
    headline: "NVDA is bullish intraday with long gamma support and a 225 call wall holding resistance",
    summary: "Dealers are long gamma into the 225 wall; flow is call-heavy but concentrated in one expiry.",
    bias: "bull",
    spot: { value: 221.4, display: "221.40", source: "THERMAL" },
    regime: { label: "LONG GAMMA", detail: "flip at 219.50", source: "THERMAL" },
    systemReads: [
      { system: "HELIX", stance: "bullish", detail: "+$41.2M net premium" },
      { system: "THERMAL", stance: "neutral", detail: "long gamma, pinned" },
      { system: "VECTOR", stance: "bullish", detail: "holding above the open range" },
    ],
    levels: [
      { label: "Call wall", price: 225, display: "225.00", kind: "resistance", source: "THERMAL" },
      { label: "Gamma flip", price: 219.5, display: "219.50", kind: "pivot", source: "THERMAL" },
      { label: "Put wall", price: 215, display: "215.00", kind: "support", source: "THERMAL" },
    ],
    flow: {
      windowLabel: "last 60 min",
      netDisplay: "+$41.2M",
      grossDisplay: "$88.6M",
      callShare: 0.68,
      printCount: 122,
      rows: [
        { ticker: "NVDA", side: "call", premiumDisplay: "$12.4M", detail: "225C 08/15" },
        { ticker: "NVDA", side: "call", premiumDisplay: "$9.1M", detail: "230C 08/22" },
        { ticker: "NVDA", side: "put", premiumDisplay: "$4.8M", detail: "215P 08/15" },
        { ticker: "NVDA", side: "call", premiumDisplay: "$3.3M", detail: "222.5C 08/15" },
      ],
    },
    gammaProfile: {
      rows: [
        { strike: 215, gamma: -0.6e9, display: "-$0.6B" },
        { strike: 220, gamma: 0.9e9, display: "+$0.9B" },
        { strike: 225, gamma: 1.4e9, display: "+$1.4B" },
      ],
      flipStrike: 219.5,
      expiryLabel: "08/15",
      source: "THERMAL",
    },
    playbook: {
      editionFor: "2026-08-12",
      publishedAt: "2026-08-11T21:05:00Z",
      totalPlays: 3,
      rows: [
        {
          rank: 1,
          ticker: "NVDA",
          direction: "long",
          conviction: "HIGH",
          entryRange: "220.80–221.60",
          target: "226.40",
          stop: "218.90",
          optionsPlay: "225C 08/15",
          entryPremium: 3.15,
          entryPremiumDisplay: "$3.15",
          thesis: "Long gamma floor under the flip with call-heavy tape into the 225 wall.",
          keySignal: "call wall holding",
          rrRatio: 2.4,
          targetAtrMultiple: 1.3,
        },
        {
          rank: 2,
          ticker: "AMD",
          direction: "long",
          conviction: "MEDIUM",
          entryRange: "178.10–178.90",
          target: "183.00",
          stop: "176.20",
          optionsPlay: "180C 08/15",
          entryPremium: 2.4,
          entryPremiumDisplay: "$2.40",
          thesis: "Sympathy continuation with its own flip reclaimed.",
          keySignal: "sector follow-through",
          rrRatio: 2.1,
          targetAtrMultiple: 1.1,
        },
      ],
      source: "NIGHT HAWK",
    },
    metrics: [
      { label: "IV rank", value: "34", source: "THERMAL" },
      { label: "Net GEX", value: "+$1.8B", source: "THERMAL" },
      { label: "Call share", value: "68%", source: "HELIX" },
      { label: "Prints", value: "122", source: "HELIX" },
    ],
  };
}
