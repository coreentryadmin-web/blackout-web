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

// Bug (found 2026-09-16, live audit): publish_context.tier is the RAW tier-engine assignment
// (assignNighthawkTier over the scored candidate), pinned independently of whether the play was
// later gate-promoted. capGatePromotedConviction (publish-gates.ts) caps a gate_promoted play's
// displayed conviction at "B" at BUILD time; this overlay runs on every live edition read and was
// unconditionally re-deriving conviction from the raw tier pin, silently re-inflating a capped "B"
// back to "A" on every read -- exactly the "mechanically blocked A reading as top-tier merit"
// publish-gates.ts's own cap exists to prevent.
test("applyEditionOutcomeOverlay does not undo the gate-promote conviction cap on a re-read", () => {
  const gatePromotedEdition: NightHawkEdition = {
    ...edition,
    plays: [
      {
        ...edition.plays[0]!,
        conviction: "B", // already capped at publish time by capGatePromotedConviction
        gate_promoted: true,
      },
    ],
  };

  const overlays = buildOutcomeOverlayMap([
    {
      ticker: "NVDA",
      publish_context: {
        context_version: 2,
        // The tier engine's RAW assignment is "A" -- what the play would have shown had it not
        // been a mechanically-rescued gate-promote.
        tier: { tier: "a", factors: [{ label: "Prime band", direction: "up", detail: "40-55 score band" }] },
      },
      morning_verdict: null,
    },
  ]);

  const merged = applyEditionOutcomeOverlay(gatePromotedEdition, overlays);
  const play = merged.plays[0] as {
    conviction?: string;
    gate_promoted?: boolean;
    tier?: { tier: string; factors: Array<{ label: string }> };
  };
  assert.equal(play.gate_promoted, true);
  assert.equal(play.conviction, "B", "gate-promoted play must stay capped at B, not re-inflate to the raw tier pin's A");
  // BUG FOUND (Ask Largo standing mandate, 2026-10-21, live repro MSTR): capGatePromotedConviction
  // only ever touched `conviction`/`key_signal` -- it never capped the full `tier` ASSIGNMENT object
  // this overlay also re-derives from the raw pin on every read. So a gate-promoted play correctly
  // showed `conviction: "B"` right next to `tier: { tier: "A", ... }` -- the exact self-contradiction
  // PR #6483's capGatePromotedTierAssignment() was built to prevent, reopened here because #6483
  // only wired that helper into publish-context.ts's BUILD-time pin, never into this READ-time
  // overlay, which independently sets `next.tier = overlay.tier` from whatever was pinned.
  assert.equal(
    play.tier?.tier,
    "B",
    "gate-promoted play's tier object must also stay capped at B, not re-inflate to the raw pin's A"
  );
  assert.ok(
    play.tier?.factors.some((f) => f.label === "Gate-promoted cap"),
    "capped tier must carry the honest gate-promoted disclosure factor, not silently truncate the raw factors"
  );
});
