import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoAnswerMessage } from "./LargoAnswerMessage";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { StructureLadder } from "@/lib/swing/play-brief-ladder";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `envelope.structureLadder` reaches the HTTP
 * envelope (swing play-brief composers populate it for every OPEN/WATCH position — see
 * `play-brief-ladder.ts`'s own header) and `BieAnswer.tsx` already renders it via
 * `<BieStructureLadder>` — but `LargoAnswerMessage`'s "Deep dive" rendering branch (taken whenever
 * the envelope clears its own `richEnough` bar, which every swing play-brief envelope with
 * sections/levels does) rendered `<LargoDeskRead>` instead and never rendered the ladder at all.
 * `LargoDeskRead`'s own "ladder" block is a DIFFERENT, generic ladder built from `envelope.levels`
 * (`ladderFromLevels`) with no reward:risk, cross-desk agreement, or archetype/sub-lane track
 * record — it does not carry the same information and is not a substitute. A member only ever saw
 * the real Structure Ladder by staying on "Concrete" mode or by asking a question whose envelope
 * happened to miss the `richEnough` bar; switching to Deep dive silently dropped the widget.
 */

function ladder(): StructureLadder {
  return {
    spot: 150,
    direction: "LONG",
    stop: 140,
    stopIsCommitted: true,
    atr: 2,
    positionState: "open",
    rungs: [
      {
        kind: "call_wall",
        label: "Call wall",
        price: 160,
        distancePct: 6.7,
        role: "resistance",
        target: { rewardRisk: 1.8, horizon: "swing", gatekeeper: false },
      },
    ],
    asOf: "2026-11-09 10:00 ET",
  };
}

function richEnvelope(): BieAnswerEnvelope {
  return {
    version: 1,
    headline: "AAPL long setup still intact",
    bias: "bullish",
    sections: [{ title: "Interpretation", body: "Spot is holding above the gamma flip." }],
    evidence: [],
    levels: [],
    asOf: new Date("2026-11-09T12:00:00Z").toISOString(),
    markdown: "AAPL long setup still intact",
    structureLadder: ladder(),
  };
}

test("LargoAnswerMessage Deep dive mode renders the Structure Ladder when the envelope carries one", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "AAPL long setup still intact",
      envelope: richEnvelope(),
      answerMode: "deep",
    }),
  );
  // Confirms this test actually exercised the LargoDeskRead ("Deep dive") branch, not some other
  // fallback — otherwise a refactor that stops using LargoDeskRead could still pass vacuously.
  assert.match(html, /largo-read/);
  assert.match(html, /Structure ladder/);
  assert.match(html, /Call wall/);
});

test("LargoAnswerMessage Concrete mode (unaffected) still renders through LargoConcreteAnswer", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "AAPL long setup still intact",
      envelope: richEnvelope(),
      answerMode: "concrete",
    }),
  );
  assert.doesNotMatch(html, /largo-read-head/);
});

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `actions` (desk deep-links such as
 * "Open Thermal at <flip>" or "Add <ticker> to watchlist", built server-side by
 * `buildLargoActions()` in `largo-terminal.ts` for EVERY answer regardless of `answerMode`)
 * were only ever rendered through `<LargoActionsBar>` inside the "Deep dive" + `richEnough`
 * branch of `LargoAnswerMessage`. "Concrete" is the product's documented DEFAULT answer mode
 * (see `LargoConcreteAnswer.tsx`'s own header comment, and `largo-depth-mode.ts`), so for the
 * overwhelming majority of real answers these desk actions were computed on the server and
 * then silently dropped before ever reaching the member.
 */
test("LargoAnswerMessage Concrete mode (the default) still renders desk actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "AAPL long setup still intact",
      envelope: richEnvelope(),
      answerMode: "concrete",
      actions: [{ id: "thermal-flip", label: "Open Thermal at 150", href: "/heatmap?ticker=AAPL&strike=150" }],
    }),
  );
  assert.match(html, /largo-actions-bar/);
  assert.match(html, /Open Thermal at 150/);
});

test("LargoAnswerMessage Deep dive, not-rich-enough envelope still renders desk actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "Flat read, nothing notable right now.",
      envelope: {
        version: 1,
        headline: null,
        bias: null,
        sections: [],
        evidence: [],
        levels: [],
        asOf: new Date("2026-11-09T12:00:00Z").toISOString(),
        markdown: "Flat read, nothing notable right now.",
      } as unknown as BieAnswerEnvelope,
      answerMode: "deep",
      actions: [{ id: "watchlist", label: "Add AAPL to watchlist", href: "#watchlist:AAPL" }],
    }),
  );
  assert.match(html, /largo-actions-bar/);
  assert.match(html, /Add AAPL to watchlist/);
});

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `envelope.followups` — the situational,
 * answer-specific "ask next" suggestions a BIE answer builder derives from the exact read it just
 * gave (e.g. swing play-brief's `followupsFor()`: "Should I trim more?" for a TAKE_PARTIAL play) —
 * reached the same `richEnough` envelope the Structure Ladder test above exercises, and
 * `BieAnswer.tsx` already renders them via its own "Ask next" chip row, but `LargoAnswerMessage`'s
 * "Deep dive" branch rendered `<LargoDeskRead>` (which never reads `envelope.followups` either)
 * and dropped them — the same shape of gap as the Structure Ladder bug just above, on a different
 * field. The separate `followups` PROP (not passed here, matching a real turn where the caller's
 * own independently-computed chip list is empty/absent) is NOT a substitute: it is computed by
 * `largo-terminal.ts`'s `contextualFollowupsFromAnswer`/`generateLargoFollowups`, which never
 * reads `envelope.followups`, so the envelope's own situational suggestions must be rendered on
 * their own merit, not assumed to be duplicated elsewhere.
 */
test("LargoAnswerMessage Deep dive mode renders envelope.followups when the envelope carries them", () => {
  const envelope = richEnvelope();
  envelope.followups = ["Should I trim more?", "Why exit the runner now?"];
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "AAPL long setup still intact",
      envelope,
      answerMode: "deep",
      onFollowup: () => {},
    }),
  );
  // Confirms this test actually exercised the LargoDeskRead ("Deep dive") branch.
  assert.match(html, /largo-read/);
  assert.match(html, /Should I trim more\?/);
  assert.match(html, /Why exit the runner now\?/);
});

test("LargoAnswerMessage Deep dive mode without onFollowup renders nothing for envelope.followups (no dead click target)", () => {
  const envelope = richEnvelope();
  envelope.followups = ["Should I trim more?"];
  const html = renderToStaticMarkup(
    React.createElement(LargoAnswerMessage, {
      content: "AAPL long setup still intact",
      envelope,
      answerMode: "deep",
    }),
  );
  assert.doesNotMatch(html, /Should I trim more\?/);
});
