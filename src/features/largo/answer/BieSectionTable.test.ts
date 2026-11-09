import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BieSectionTable } from "./BieSectionTable";
import type { BieTable } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieSection.table` — the structured track-
 * record table `archetypeTrackRecordSection`/`tickerTrackRecordSection` attach to swing play-brief
 * answers — reached the HTTP envelope but had NO renderer anywhere in the member-facing UI.
 */

function table(): BieTable {
  return {
    headers: ["Scope", "Record", "N", "Win rate", "Wilson LB", "Edge"],
    rows: [["Breakout-long (all-time)", "12W / 9L", "21", "57%", "38%", "+6pp"]],
  };
}

test("BieSectionTable renders every header and every cell of a populated table", () => {
  const html = renderToStaticMarkup(React.createElement(BieSectionTable, { table: table() }));
  assert.match(html, /<table/);
  for (const h of table().headers) assert.match(html, new RegExp(h));
  assert.match(html, /Breakout-long \(all-time\)/);
  assert.match(html, /57%/);
  assert.match(html, /Wilson LB/);
});

test("BieSectionTable renders nothing when table is absent", () => {
  const html = renderToStaticMarkup(React.createElement(BieSectionTable, { table: undefined }));
  assert.equal(html, "");
});

test("BieSectionTable renders nothing when table is explicitly null", () => {
  const html = renderToStaticMarkup(React.createElement(BieSectionTable, { table: null }));
  assert.equal(html, "");
});

test("BieSectionTable renders nothing for a table with no headers", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieSectionTable, { table: { headers: [], rows: [] } }),
  );
  assert.equal(html, "");
});
