import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyMacroContext } from "@/features/nighthawk/lib/legacy-macro-types";

// Same idiom as PlaybookBoard.test.ts: a plain .test.ts (createElement, no JSX), classic JSX
// runtime expects a global `React` set before the component is imported.
(globalThis as unknown as { React: typeof React }).React = React;

const loadStrip = () => import("./LegacyMacroStrip");

function macro(overrides: Partial<LegacyMacroContext> = {}): LegacyMacroContext {
  return {
    spxPremarket: null,
    priorClose: null,
    overnightGapPts: null,
    regime: null,
    playbook: null,
    gexBias: null,
    callWall: null,
    putWall: null,
    summary: null,
    ...overrides,
  };
}

async function render(m: LegacyMacroContext | null): Promise<string> {
  const { LegacyMacroStrip } = await loadStrip();
  return renderToStaticMarkup(React.createElement(LegacyMacroStrip, { macro: m }));
}

test("LegacyMacroStrip renders nothing when macro is null", async () => {
  assert.equal(await render(null), "");
});

test("LegacyMacroStrip renders nothing when every field is empty (never a bare empty strip)", async () => {
  assert.equal(await render(macro()), "");
});

// Task #32 (Ask Largo x Night Hawk Legacy standing mandate, 2026-09-18): deriveComposite()'s
// authored regime strategy sentence was computed and reached the API (playbook on
// MorningConfirmResult/LegacyMacroContext) but nothing rendered it on the ACTUAL live board —
// PlaybookBoard.tsx (a prior, mistaken attempt) is confirmed dead code; LegacyMacroStrip is the
// real one.
test("LegacyMacroStrip renders the playbook sentence verbatim when present", async () => {
  const html = await render(
    macro({
      regime: "AMPLIFY_BREAKOUT",
      playbook: "Dealers short gamma — moves amplify. Trend up with breakout risk; calls favored; ride momentum, avoid fades.",
    })
  );
  assert.match(html, /Regime AMPLIFY_BREAKOUT/);
  assert.match(html, /Dealers short gamma/);
});

test("LegacyMacroStrip omits the playbook line when absent — never fabricated", async () => {
  const html = await render(macro({ regime: "AMPLIFY_BREAKOUT" }));
  assert.match(html, /Regime AMPLIFY_BREAKOUT/);
  assert.doesNotMatch(html, /Dealers short gamma/);
});
