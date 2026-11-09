import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoDeskRead } from "./LargoDeskRead";
import { makeEnvelope, type BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `LargoDeskRead` is the "Deep dive" renderer
 * `LargoAnswerMessage` actually picks whenever an envelope is `richEnough` (headline/bias present
 * plus at least one of levels/sections/tradeDecision) — which, because every contract-conforming
 * chat answer carries at least one section, is effectively always. Its "sections" block renders
 * ONLY `sec.body` (via `renderInlineMarkdown`) — it never reads `sec.table`, `sec.evidence`,
 * `sec.levels` or `sec.confidence` at all, unlike `BieSectionCard` (the sibling renderer `BieAnswer`
 * uses for the rarer non-rich-enough/fallback path), which was just fixed (#7702) to render
 * `section.table` via the new `BieSectionTable` component.
 *
 * `BieSection.table` is populated by swing's `archetypeTrackRecordSection`/`tickerTrackRecordSection`
 * (play-brief-intel.ts, forwarded by `buildRichEnvelope`) with a real prose `body` ALONGSIDE the
 * table — so it survives both `buildRichEnvelope`'s own blank-body filter and this component's
 * `proseSections` filter, reaches the "sections" render block intact, and then silently loses the
 * table: the member sees the prose paragraph but never the structured win-rate/Wilson-LB/edge rows
 * a consumer is meant to be able to cite or join against (Largo product-contract C10). Any future
 * composer whose section carries both prose and a table hits the same silent drop in THIS, the more
 * commonly rendered of the two branches — the exact "reaches the wire but the shared renderer never
 * read it" shape #7702's own write-up names, just in the renderer #7702 didn't touch.
 *
 * Fix: render `sec.table` via the same `BieSectionTable` component `BieSectionCard` already uses,
 * right alongside the existing prose body — additive, no existing field's rendering changes.
 */

function envelopeWithTableSection(): BieAnswerEnvelope {
  return makeEnvelope({
    headline: "CRWD breakout-long — archetype track record attached",
    bias: "bullish",
    sections: [
      {
        title: "Track record",
        body: "The desk has run this archetype 21 times before this play.",
        table: {
          headers: ["Scope", "Record", "N", "Win rate"],
          rows: [["Breakout-long", "12W / 9L", "21", "57%"]],
        },
      },
    ],
    evidence: [],
  });
}

test("LargoDeskRead renders section.table's header and row text", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoDeskRead, { envelope: envelopeWithTableSection() }),
  );
  assert.match(html, /Win rate/);
  assert.match(html, /Breakout-long/);
  assert.match(html, />12</);
  // Additive — the existing prose body must still render too.
  assert.match(html, /The desk has run this archetype/);
});

test("LargoDeskRead renders nothing extra when a section carries no table", () => {
  const envelope = envelopeWithTableSection();
  envelope.sections[0]!.table = undefined;
  const html = renderToStaticMarkup(React.createElement(LargoDeskRead, { envelope }));
  assert.doesNotMatch(html, /bie-section-table/);
});
