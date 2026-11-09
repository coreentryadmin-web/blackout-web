import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BieAnswer } from "./BieAnswer";
import { makeEnvelope } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `isCompact()` routed a single-section
 * envelope with no top-level evidence/levels/scenarios through the plain-prose branch
 * (`envelope.sections[0].body` via `LargoMessageBody`), which NEVER renders `BieSectionCard` —
 * the only component that reads `section.table`. A single-section answer whose only structure is
 * a table (the shape `tickerTrackRecordSection`/`archetypeTrackRecordSection` produce when they
 * are the sole populated section) was therefore "compact" by every existing check and its table
 * was dropped before `BieSectionCard`'s own table-rendering fix could ever run.
 */

test("BieAnswer: a single section whose only structure is a table is NOT compact — its table renders", () => {
  const envelope = makeEnvelope({
    headline: "SQQQ track record",
    bias: "neutral",
    sections: [
      {
        title: "Track record",
        body: "The desk has run this archetype before.",
        table: {
          headers: ["Scope", "Record", "N", "Win rate"],
          rows: [["Breakout-long", "12W / 9L", "21", "57%"]],
        },
      },
    ],
    evidence: [],
  });

  const html = renderToStaticMarkup(React.createElement(BieAnswer, { envelope }));
  assert.match(html, /Win rate/);
  assert.match(html, /Breakout-long/);
});

test("BieAnswer: a genuinely shallow single section (no table, no evidence, no levels) stays compact prose", () => {
  const envelope = makeEnvelope({
    headline: "Quick read",
    bias: "neutral",
    sections: [{ title: "Read", body: "A plain one-line answer." }],
    evidence: [],
  });

  const html = renderToStaticMarkup(React.createElement(BieAnswer, { envelope }));
  assert.match(html, /bie-answer-compact/);
  assert.match(html, /A plain one-line answer/);
});
