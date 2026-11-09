import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BieSectionCard } from "./BieSectionCard";
import type { BieSection } from "@/lib/bie/answer-envelope";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieSectionCard` is the only renderer of a
 * `BieSection` in the member-facing "Deep dive" answer UI. It read `body`, `evidence`, `levels`,
 * `confidence` and `provenance`, but never `table` — so a section carrying a structured table
 * (e.g. swing's archetype/ticker track-record sections, Largo product-contract C10) rendered its
 * prose and silently dropped the table a member could otherwise cite/join against. RED pre-fix
 * (confirmed via `git stash` isolating the BieSectionCard.tsx edit alone): the table's own cell
 * text never appears in the rendered HTML. GREEN post-fix: it does.
 */

function section(overrides: Partial<BieSection> = {}): BieSection {
  return {
    title: "Track record",
    body: "The desk has run this archetype 21 times before this play.",
    bias: "neutral",
    table: {
      headers: ["Scope", "Record", "N", "Win rate"],
      rows: [["Breakout-long", "12W / 9L", "21", "57%"]],
    },
    ...overrides,
  };
}

test("BieSectionCard renders section.table's header and row text", () => {
  const html = renderToStaticMarkup(React.createElement(BieSectionCard, { section: section() }));
  assert.match(html, /Win rate/);
  assert.match(html, /Breakout-long/);
  // `renderInlineMarkdown` wraps the leading digits in a highlight span, so match loosely
  // rather than asserting the exact "12W / 9L" substring.
  assert.match(html, /W \/ 9L/);
  assert.match(html, />12</);
  // Additive — the existing body/bias rendering must still be present.
  assert.match(html, /The desk has run this archetype/);
});

test("BieSectionCard renders nothing extra when table is absent", () => {
  const html = renderToStaticMarkup(
    React.createElement(BieSectionCard, { section: section({ table: undefined }) }),
  );
  assert.doesNotMatch(html, /bie-section-table/);
});
