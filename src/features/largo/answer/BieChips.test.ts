import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SourceStamp } from "./BieChips";
import type { BieProvenance } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieProvenance.market_session_note` (the
 * "compute is fresh but the market is CLOSED" disclosure) reaches every GEX/Vector-sourced level
 * and evidence item's provenance in the HTTP response, but `SourceStamp` — the only shared
 * renderer of `BieProvenance`, used by `BieKeyLevelsTable`, `BieEvidencePanel`, and
 * `BieSectionCard` — never read it. A snapshot-based read computed off a closed market's last
 * tape showed only a plain "live" freshness badge with no caveat.
 */

function provenance(overrides: Partial<BieProvenance> = {}): BieProvenance {
  return { source: "Vector GEX", freshness: "live", asOf: new Date().toISOString(), ...overrides };
}

test("renders market_session_note when present, alongside (not replacing) the existing freshness badge", () => {
  const html = renderToStaticMarkup(
    React.createElement(SourceStamp, {
      provenance: provenance({
        market_session_note:
          "Computed 42s ago, but the market is CLOSED as of this read — this reflects the last session's tape, not a live tick, however fresh the compute looks.",
      }),
    }),
  );
  assert.match(html, /market is CLOSED/);
  // The existing freshness/source rendering must still be present — additive, not replaced.
  assert.match(html, /Vector GEX/);
  assert.match(html, /bie-fresh-live/);
});

test("renders nothing extra when market_session_note is absent — no empty caveat line", () => {
  const html = renderToStaticMarkup(React.createElement(SourceStamp, { provenance: provenance() }));
  assert.doesNotMatch(html, /bie-source-note/);
});

test("renders nothing extra when market_session_note is explicitly null", () => {
  const html = renderToStaticMarkup(
    React.createElement(SourceStamp, { provenance: provenance({ market_session_note: null }) }),
  );
  assert.doesNotMatch(html, /bie-source-note/);
});
