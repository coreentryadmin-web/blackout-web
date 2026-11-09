import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoConcreteAnswer } from "./LargoConcreteAnswer";
import { makeEnvelope, type BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `envelope.unavailableSources` is documented in
 * `answer-envelope.ts` as "Sources requested but unavailable this turn — always surfaced", and both
 * sibling renderers honor that (`BieAnswer.tsx` via `UnavailableChip`, `LargoDeskRead.tsx` via its
 * own "Could not read" section) — but `LargoConcreteAnswer`, the DEFAULT `answerMode` in
 * `LargoAnswerMessage.tsx`, never read the field at all, so a failed/missing upstream source
 * silently vanished from the overwhelming majority of real chat answers.
 */

function envelopeWithUnavailable(): BieAnswerEnvelope {
  return makeEnvelope({
    headline: "SPX gamma walls holding near 5900.",
    bias: "neutral",
    sections: [{ title: "Read", body: "SPX gamma walls holding near 5900. Dealer positioning is stable." }],
    evidence: [],
    unavailableSources: [{ source: "gex-walls", reason: "upstream timeout" }],
  });
}

test("LargoConcreteAnswer surfaces unavailableSources", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoConcreteAnswer, {
      content: "SPX gamma walls holding near 5900. Dealer positioning is stable.",
      envelope: envelopeWithUnavailable(),
    }),
  );
  assert.match(html, /Unavailable/);
  assert.match(html, /gex-walls/);
  assert.match(html, /upstream timeout/);
});

test("LargoConcreteAnswer renders nothing extra when unavailableSources is absent", () => {
  const envelope = envelopeWithUnavailable();
  envelope.unavailableSources = undefined;
  const html = renderToStaticMarkup(
    React.createElement(LargoConcreteAnswer, {
      content: "SPX gamma walls holding near 5900. Dealer positioning is stable.",
      envelope,
    }),
  );
  assert.doesNotMatch(html, /largo-concrete-unavailable/);
  assert.doesNotMatch(html, /Unavailable/);
});
