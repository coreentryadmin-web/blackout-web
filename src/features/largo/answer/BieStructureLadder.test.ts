import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BieStructureLadder } from "./BieStructureLadder";
import type { StructureLadder, StructureLadderRung } from "@/lib/swing/play-brief-ladder";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): two real fields computed and carried all the
 * way to the HTTP response's `envelope.structureLadder` were silently never rendered by this,
 * their only UI consumer — `subLaneTrackRecord` (the sibling of `archetypeTrackRecord`, same
 * shape, same gate) and each rung's `meta` (dark-pool print size/% context). Both are added here.
 */

function rung(overrides: Partial<StructureLadderRung> = {}): StructureLadderRung {
  return {
    kind: "support",
    label: "Dark pool",
    price: 100,
    distancePct: 2.5,
    role: "support",
    ...overrides,
  };
}

function ladder(overrides: Partial<StructureLadder> = {}): StructureLadder {
  return {
    spot: 102,
    direction: "LONG",
    stop: 95,
    stopIsCommitted: false,
    atr: 2,
    positionState: "open",
    rungs: [rung()],
    ...overrides,
  } as StructureLadder;
}

test("renders ladder.subLaneTrackRecord when present — the sibling of archetypeTrackRecord, same shape", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieStructureLadder, {
      ladder: ladder({
        subLaneTrackRecord: { subLaneLabel: "Tactical", winRatePct: 63, wilsonLbPct: 55, n: 8 },
      }),
    }),
  );
  assert.match(html, /Tactical/);
  assert.match(html, /63/);
  assert.match(html, /55/);
  assert.match(html, /n=8/);
});

test("does not render a sub-lane block at all when subLaneTrackRecord is absent (no ungraduated bucket)", () => {
  const html = renderToStaticMarkup(React.createElement(BieStructureLadder, { ladder: ladder() }));
  assert.doesNotMatch(html, /bie-ladder-track-record-sublane/);
});

test("renders both archetypeTrackRecord and subLaneTrackRecord together when both graduate independently", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieStructureLadder, {
      ladder: ladder({
        archetypeTrackRecord: { archetypeLabel: "Breakout", winRatePct: 60, wilsonLbPct: 52, n: 20 },
        subLaneTrackRecord: { subLaneLabel: "Tactical", winRatePct: 63, wilsonLbPct: 55, n: 8 },
      }),
    }),
  );
  assert.match(html, /Breakout/);
  assert.match(html, /Tactical/);
});

test("renders rung.meta (e.g. dark-pool print size/% context) when the source read carried one", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieStructureLadder, {
      ladder: ladder({ rungs: [rung({ meta: "42% of DP volume · $1.2M" })] }),
    }),
  );
  assert.match(html, /42% of DP volume/);
});

test("renders a rung with no meta the same as before — no empty placeholder", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieStructureLadder, { ladder: ladder({ rungs: [rung()] }) }),
  );
  assert.doesNotMatch(html, /bie-ladder-row-extra/);
});
