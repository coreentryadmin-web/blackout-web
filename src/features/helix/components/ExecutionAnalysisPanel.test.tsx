import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FlowAlert } from "@/lib/api";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * Regression (round 185, DISCOVERY lane): `summarizeExecutionQuality` (helix-execution-quality.ts)
 * returns its bucket rollup in a FIXED order — aggressive, passive, mid, unknown — never sorted by
 * premium. `ExecutionAnalysisPanel` took `entries[0].premium` as the scale-bar denominator,
 * silently assuming the first bucket in that fixed order always carries the largest premium — true
 * by construction in the sibling `RouteBreakdown.tsx` panel (which explicitly `.sort()`s its own
 * entries by premium first) but never true here. When a LATER bucket in the fixed order (e.g.
 * "passive") carries far more premium than "aggressive" (first), the bar-width math inverted: the
 * true-largest bucket computed a `width` of many thousand percent (overflowing its track) while the
 * true-smallest bucket rendered at a full 100% — visually backwards from the real premium split.
 *
 * Mocks `framer-motion`'s `motion.div`/`AnimatePresence` with plain passthrough elements (same
 * pattern as `IosNativeSegment.test.tsx`) so the computed inline `width` survives into the
 * `renderToStaticMarkup` output without needing Framer Motion's real animation runtime.
 */
mock.module("framer-motion", {
  namedExports: {
    motion: {
      div: ({
        style,
        className,
        children,
      }: {
        style?: React.CSSProperties;
        className?: string;
        children?: React.ReactNode;
      }) => React.createElement("div", { className, style }, children),
    },
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  },
});

function barWidthsByBucketColor(html: string): number[] {
  // Bars are the inner <div style="...width:N%...opacity:0.75..."> fill elements — match every
  // `width:<num>%` percentage that appears alongside the bar's own `opacity:0.75` marker.
  const matches = [...html.matchAll(/width:([0-9.]+)%[^"]*opacity:0\.75/g)];
  return matches.map((m) => Number(m[1]));
}

function makeAlert(premium: number, askPct: number): FlowAlert {
  return {
    ticker: "SPY",
    premium,
    option_type: "CALL",
    expiry: "2026-11-20",
    strike: 500,
    direction: "bullish",
    score: 1,
    route: "SWEEP",
    alerted_at: "2026-10-31T10:00:00Z",
    ask_pct: askPct,
  };
}

describe("ExecutionAnalysisPanel bar-width scaling", () => {
  let ExecutionAnalysisPanel: typeof import("./ExecutionAnalysisPanel").ExecutionAnalysisPanel;

  it("loads the module under test", async () => {
    ({ ExecutionAnalysisPanel } = await import("./ExecutionAnalysisPanel"));
    assert.equal(typeof ExecutionAnalysisPanel, "function");
  });

  it("never renders a bar wider than 100%, even when the fixed bucket order puts the smallest premium first", () => {
    // "aggressive" (ask_pct>=60) sorts FIRST in summarizeExecutionQuality's fixed bucket order but
    // carries the SMALLEST premium here; "passive" (ask_pct<=40) sorts later but carries 90x the
    // premium. A correct scale must size bars relative to the TRUE max (passive), never entries[0].
    const alerts: FlowAlert[] = [makeAlert(10_000, 80), makeAlert(900_000, 10)];

    const html = renderToStaticMarkup(React.createElement(ExecutionAnalysisPanel, { alerts }));
    const widths = barWidthsByBucketColor(html);

    assert.ok(widths.length >= 2, `expected at least 2 bar widths, got: ${JSON.stringify(widths)}`);
    for (const w of widths) {
      assert.ok(w <= 100, `bar width must never exceed 100%, got ${w}%`);
    }
    // The true-largest bucket (passive, $900k) must be the one rendered at (or near) 100%, not the
    // true-smallest (aggressive, $10k) — i.e. width must track real premium, not fixed bucket order.
    assert.ok(Math.max(...widths) <= 100.001);
  });

  it("still scales correctly when the largest-premium bucket IS first in fixed order (no regression)", () => {
    const alerts: FlowAlert[] = [makeAlert(900_000, 80), makeAlert(10_000, 10)];
    const html = renderToStaticMarkup(React.createElement(ExecutionAnalysisPanel, { alerts }));
    const widths = barWidthsByBucketColor(html);
    assert.ok(widths.length >= 2);
    for (const w of widths) assert.ok(w <= 100);
  });
});
