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

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieAnswer` is the renderer
 * `LargoAnswerMessage` falls back to whenever an envelope doesn't clear its own `richEnough` bar
 * (headline/bias + at least one of levels/sections/tradeDecision — a check `gexShifts`/
 * `systemReads` never factor into, since both are extracted independently off the turn's own
 * tool results in `answer-contract.ts`, not off section/level text) and for the no-envelope
 * markdown-shim path. The sibling "Deep dive, rich enough" renderer (`LargoDeskRead.tsx`) already
 * renders both fields; `BieAnswer` never read either one at all, so a turn that called
 * `get_gex_matrix_changes` or consulted >=2 systems but wrote no canonical section/level prose
 * lost that real, already-fetched structured data outright the moment the answer fell one rung
 * short of `richEnough`.
 */
test("BieAnswer renders envelope.gexShifts even when the envelope has no sections/levels", () => {
  const envelope = makeEnvelope({
    headline: "SPX holding the flip",
    bias: "neutral",
    sections: [],
    evidence: [],
    gexShifts: [{ strike: 5800, change: -177_800_000, direction: "weaker" }],
  });

  const html = renderToStaticMarkup(React.createElement(BieAnswer, { envelope }));
  assert.match(html, /GEX shift/);
  assert.match(html, /5,800/);
  assert.match(html, /weaker/);
});

test("BieAnswer renders envelope.systemReads even when the envelope has no sections/levels", () => {
  const envelope = makeEnvelope({
    headline: "SPX holding the flip",
    bias: "neutral",
    sections: [],
    evidence: [],
    systemReads: {
      reads: [
        { system: "Helix", kind: "directional", stance: "bullish", strength: 0.6, basis: "net call flow" },
        { system: "Thermal", kind: "regime", stance: "bearish", strength: 0.4, basis: "dealer short gamma" },
      ],
      agreement: { voting: 2, bullish: 1, bearish: 1, neutral: 0, verdict: "split", direction: null },
    },
  });

  const html = renderToStaticMarkup(React.createElement(BieAnswer, { envelope }));
  assert.match(html, /System reads/);
  assert.match(html, /Helix/);
  assert.match(html, /net call flow/);
  assert.match(html, /Thermal/);
});

test("BieAnswer renders neither GEX shift nor System reads blocks when both fields are absent", () => {
  const envelope = makeEnvelope({
    headline: "Quick read",
    bias: "neutral",
    sections: [{ title: "Read", body: "A plain one-line answer." }],
    evidence: [],
  });

  const html = renderToStaticMarkup(React.createElement(BieAnswer, { envelope }));
  assert.doesNotMatch(html, /GEX shift/);
  assert.doesNotMatch(html, /System reads/);
});
