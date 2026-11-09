import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoConcreteAnswer } from "./LargoConcreteAnswer";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX: `envelope.tradeDecision` carries "non-negotiable honesty flags" — per its own type
 * comment in `decision-read.ts`: "integrity badges and board context ONLY... non-negotiable
 * honesty flags (spot hold, not on board, edition vs ledger) without replacing what the model
 * wrote for this specific question." `notOnBoardWarning` specifically fires when a member asks
 * about a play that is NOT committed on the live 0DTE board, so they don't mistake a speculative
 * read for a real, tracked position.
 *
 * `LargoDeskRead.tsx` (the Deep-dive renderer) builds and renders these notes
 * (`integrityNotes`, `trade.notOnBoardWarning` / `boardPlay` / `existingPlay`). But
 * `LargoConcreteAnswer` — the renderer for Concrete mode, which `LargoAnswerMessage` defaults
 * `answerMode` to — never reads `envelope.tradeDecision` at all. Concrete is the mode every
 * member sees unless they explicitly switch to Deep dive, so for the overwhelming majority of
 * real answers this "non-negotiable" warning was in practice fully negotiable: it only rendered
 * if the member (a) switched to Deep dive AND (b) the envelope cleared its own unrelated
 * `richEnough` bar. `BieAnswer.tsx` (the other fallback renderer) doesn't render it either.
 */

function envelopeWithWarning(): BieAnswerEnvelope {
  return {
    version: 1,
    headline: "AAPL is not committed on today's 0DTE board",
    bias: "neutral",
    sections: [],
    evidence: [],
    levels: [],
    asOf: new Date("2026-11-09T12:00:00Z").toISOString(),
    markdown: "AAPL is not committed on today's 0DTE board",
    tradeDecision: {
      ticker: "AAPL",
      actionLabel: "Speculative",
      notOnBoardWarning: "AAPL is not on today's 0DTE board — this read is speculative, not a tracked play.",
      isSpeculative: true,
      signalRows: [],
    },
  };
}

test("LargoConcreteAnswer renders the tradeDecision not-on-board integrity warning", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoConcreteAnswer, {
      content: "AAPL is not committed on today's 0DTE board. Flow is mixed intraday.",
      envelope: envelopeWithWarning(),
    }),
  );
  assert.match(
    html,
    /not on today(?:&#x27;|')s 0DTE board — this read is speculative/,
    `expected the non-negotiable board warning to render in Concrete mode, got: ${html}`,
  );
});

test("LargoConcreteAnswer renders the boardPlay/existingPlay integrity notes when present", () => {
  const envelope: BieAnswerEnvelope = {
    ...envelopeWithWarning(),
    tradeDecision: {
      ticker: "AAPL",
      isSpeculative: false,
      signalRows: [],
      boardPlay: { contract: "AAPL 250C 11/09", status: "open", note: "Entered 10:14 ET" },
      existingPlay: { contract: "AAPL 250C 11/08", originalEntry: "248", note: "Edition pick from yesterday" },
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(LargoConcreteAnswer, {
      content: "AAPL 250C is already working on the board.",
      envelope,
    }),
  );
  assert.match(html, /Board: AAPL 250C 11\/09 \(open\)/);
  assert.match(html, /Edition: AAPL 250C 11\/08/);
});

test("LargoConcreteAnswer renders nothing extra when there is no tradeDecision", () => {
  const envelope: BieAnswerEnvelope = { ...envelopeWithWarning(), tradeDecision: undefined };
  const html = renderToStaticMarkup(
    React.createElement(LargoConcreteAnswer, {
      content: "Spot is holding above the flip.",
      envelope,
    }),
  );
  assert.doesNotMatch(html, /largo-read-integrity/);
});
