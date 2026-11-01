import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWeightedConflicts } from "./spx-play-conflicts";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxSignalFactor } from "./spx-signals";

const baseDesk = (): SpxDeskPayload =>
  ({
    price: 7400,
    market_open: true,
    tide_bias: "bullish",
    gamma_regime: "mean_revert",
    above_gamma_flip: true,
    gex_walls: [{ kind: "resistance", strike: 7450, gex: 1e9, distance: 50 }],
    news_headlines: [{ title: "Market rally continues on dovish Fed tone" }],
    vix: 26,
  }) as SpxDeskPayload;

describe("computeWeightedConflicts", () => {
  it("does not double-count news when News risk factor is already scored", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "News risk", weight: -6, detail: "bearish headline" },
      { label: "TRIN", weight: -6, detail: "selling" },
    ];
    const { weighted_conflicts } = computeWeightedConflicts(baseDesk(), 50, factors);
    // 2 soft opposing (News + TRIN) = 2 — no extra +2 news desk penalty
    assert.equal(weighted_conflicts, 2);
  });

  it("does not inflate with max(raw opposing factor count) when desk bonuses are absent", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "TRIN", weight: -6, detail: "selling" },
      { label: "EMA 20", weight: -5, detail: "below" },
    ];
    const { conflicts, weighted_conflicts } = computeWeightedConflicts(baseDesk(), 55, factors);
    assert.equal(conflicts, 2);
    assert.equal(weighted_conflicts, 2);
  });

  it("counts hard opposing factors at 2x in weighted score", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "Market tide", weight: -10, detail: "bearish tide" },
    ];
    const { weighted_conflicts } = computeWeightedConflicts(baseDesk(), 40, factors);
    assert.equal(weighted_conflicts, 2);
  });

  it("still counts a nearby opposing GEX wall when the mutually-exclusive nearer wall was scored", () => {
    // Root cause (live-reachable): computeSpxConfluence's mutual-exclusivity fix (ISSUE-01)
    // scores ONLY the nearer of two in-range GEX walls when price sits between a support wall
    // and a resistance wall both within 12pts — the farther wall is dropped entirely, never
    // pushed into `factors`. Here price (7400) sits 4pts above a support wall (7396, nearer —
    // the one computeSpxConfluence would score, +18, agreeing with a long) and 10pts below a
    // resistance wall (7410, farther — dropped, never scored, but genuinely opposing a long).
    // The guard below used to suppress the +2 conflict bonus whenever ANY GEX-labeled factor
    // was present in `factors` — including the unrelated AGREEING "GEX support" factor — so the
    // real, unscored resistance-wall conflict was silently dropped from weighted_conflicts,
    // letting a setup with a genuine nearby opposing wall pass gates as if it had none.
    const desk: SpxDeskPayload = {
      ...baseDesk(),
      gex_walls: [
        { kind: "support", strike: 7396, gex: 1e9, distance: 4 },
        { kind: "resistance", strike: 7410, gex: 1e9, distance: 10 },
      ],
      tide_bias: "neutral",
      news_headlines: [],
      vix: 20,
    } as SpxDeskPayload;
    const factors: SpxSignalFactor[] = [
      { label: "GEX support", weight: 18, detail: "At 0DTE support node 7396" },
      { label: "0DTE flow", weight: 14, detail: "Call premium leading 0DTE tape" },
    ];
    const { weighted_conflicts } = computeWeightedConflicts(desk, 32, factors);
    assert.equal(weighted_conflicts, 2);
  });

  it("does not treat a null gamma_flip's stale sticky gamma_regime as a live GEX conflict", () => {
    // Live-observed shape (2026-10-17): gamma_flip resolves honestly null for the cycle, but
    // gamma_regime is still carrying a prior cycle's sticky "amplification" label (spx-desk.ts
    // falls back to lastGoodGammaRegime whenever the live regime computes "unknown"). above_gamma_flip
    // correctly defaults to false when flip is null — gexOpposed must not treat that combination as
    // a real GEX conflict, same as spx-signals.ts's own γ-regime factor already guards on
    // `gamma_flip != null` before reading the regime at all.
    const desk: SpxDeskPayload = {
      ...baseDesk(),
      gamma_flip: null,
      gamma_regime: "amplification",
      above_gamma_flip: false,
    } as SpxDeskPayload;
    const factors: SpxSignalFactor[] = [{ label: "Live tape", weight: 12, detail: "calls" }];
    const { weighted_conflicts } = computeWeightedConflicts(desk, 50, factors);
    assert.equal(weighted_conflicts, 0);
  });

  it("does not count a bull keyword immediately reversed by a stall/fade phrase as opposing news (live headline, 2026-11-01 audit)", () => {
    // Live repro: BEAR_NEWS/BULL_NEWS classified sentiment by testing for the literal presence
    // of a keyword ANYWHERE in the title, with no check for an adjacent negating/reversal
    // phrase. "S&P 500 Index Rally Hits a Wall Amid AI Jitters as Key Valuation Metric Dips"
    // matched BULL_NEWS on "Rally" and read "bullish" even though the headline's actual content
    // ("Rally Hits a Wall... Jitters... Dips") is a stalling/cautionary read, not a confirming
    // rally. Pre-fix: newsSentiment() misread this as bullish news opposing the short below,
    // adding a false +2 "opposing bullish news" bonus to weighted_conflicts. Post-fix: the "Hits
    // a Wall" reversal phrase immediately after "Rally" voids that match -> neutral -> no bonus.
    const desk: SpxDeskPayload = {
      ...baseDesk(),
      tide_bias: "neutral",
      gex_walls: [],
      news_headlines: [
        { title: "S&P 500 Index Rally Hits a Wall Amid AI Jitters as Key Valuation Metric Dips" },
      ],
      vix: 20,
    } as SpxDeskPayload;
    // weight<0 does not oppose a short direction (factorOpposes requires weight>0 for short),
    // so this factor contributes nothing — isolating the news-sentiment behavior under test.
    const factors: SpxSignalFactor[] = [{ label: "Live tape", weight: -12, detail: "puts" }];
    const { weighted_conflicts } = computeWeightedConflicts(desk, -40, factors);
    assert.equal(weighted_conflicts, 0);
  });

  it("still counts a genuine, non-reversed bullish headline as opposing news for a short (no regression)", () => {
    // Same setup as above, but the headline ("Market rally continues on dovish Fed tone") carries
    // no reversal phrase after its BULL_NEWS match — this must still trip the +2 opposing-news
    // bonus exactly as before the fix.
    const desk: SpxDeskPayload = {
      ...baseDesk(),
      tide_bias: "neutral",
      gex_walls: [],
      news_headlines: [{ title: "Market rally continues on dovish Fed tone" }],
      vix: 20,
    } as SpxDeskPayload;
    const factors: SpxSignalFactor[] = [{ label: "Live tape", weight: -12, detail: "puts" }];
    const { weighted_conflicts } = computeWeightedConflicts(desk, -40, factors);
    assert.equal(weighted_conflicts, 2);
  });
});
