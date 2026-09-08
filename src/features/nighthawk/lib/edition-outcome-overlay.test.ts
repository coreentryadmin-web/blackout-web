import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEditionOutcomeOverlay, buildOutcomeOverlayMap } from "./edition-outcome-overlay";
import type { NightHawkEdition } from "./types";

const edition: NightHawkEdition = {
  available: true,
  edition_for: "2026-08-07",
  published_at: "2026-08-06T21:30:00.000Z",
  recap_headline: null,
  recap_summary: null,
  plays: [
    {
      rank: 1,
      ticker: "NVDA",
      direction: "LONG",
      conviction: "B",
      play_type: "stock",
      thesis: "test",
      key_signal: "test",
      entry_range: "$100 – $102",
      target: "$110",
      stop: "$95",
      options_play: "—",
      score: 52,
    },
  ],
};

test("buildOutcomeOverlayMap + applyEditionOutcomeOverlay merge tier pins", () => {
  const overlays = buildOutcomeOverlayMap([
    {
      ticker: "NVDA",
      publish_context: {
        context_version: 2,
        tier: {
          tier: "b",
          factors: [{ label: "Prime band", direction: "up", detail: "40–55 score band" }],
        },
      },
      morning_verdict: {
        status: "CONFIRMED",
        checked_at: "2026-08-07T13:16:00.000Z",
        metrics: {},
      },
    },
  ]);

  const merged = applyEditionOutcomeOverlay(edition, overlays);
  const play = merged.plays[0] as { tier?: { tier: string; factors: unknown[] }; morning_checked_at?: string };
  assert.equal(play.tier?.tier, "B");
  assert.equal(play.conviction, "B");
  assert.equal(play.tier?.factors.length, 1);
  assert.equal(play.morning_checked_at, "2026-08-07T13:16:00.000Z");
});
