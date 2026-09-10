import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";

// Same idiom as PlaybookBoard.test.ts: a .test.ts (createElement, no JSX) so CI's
// `src/**/*.test.ts` glob actually picks it up, with the classic-JSX-runtime global
// React polyfill set BEFORE the dynamic import.
(globalThis as unknown as { React: typeof React }).React = React;

const loadPanel = () => import("./PlaybookBriefingPanel");

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "FICO",
    direction: "SHORT",
    conviction: "A",
    play_type: "stock",
    thesis: "FICO showing prior day HOD break in bearish trend.",
    key_signal: "BEARISH — flow + technicals",
    entry_range: "$961.09-$1005.29",
    target: "885.00",
    stop: "1066.08",
    options_play: "FICO $980 PUT @ $32.25 — Sep 18",
    entry_premium: 32.25,
    entry_cost_per_contract: 3225,
    score: 42,
    ...overrides,
  };
}

type PanelProps = Parameters<Awaited<ReturnType<typeof loadPanel>>["PlaybookBriefingPanel"]>[0];

async function render(props: PanelProps): Promise<string> {
  const { PlaybookBriefingPanel } = await loadPanel();
  return renderToStaticMarkup(React.createElement(PlaybookBriefingPanel, props));
}

// ── Tier reasoning: the pinned merit-tier factors, computed server-side on every play
// (assignNighthawkTier, nighthawk-tiers.ts) but — before this fix — never rendered in
// any Legacy component, unlike the 0DTE board's own TierFactorsBlock (ZeroDteBoard.tsx)
// which has shown this exact data shape for the sibling lane all along. ──────────────

test("scoring mode renders the pinned tier factors — the WHY behind the conviction letter", async () => {
  const html = await render({
    mode: "scoring",
    play: play({
      tier: {
        tier: "A",
        factors: [
          { label: "Prime score band", direction: "up", detail: "Score 42 sits in 40-55 — the overnight sweet spot." },
          { label: "Strong signal breadth", direction: "up", detail: "4 of 9 dimensions confirming." },
        ],
      },
    }),
  });

  assert.match(html, /Why this tier/);
  assert.match(html, /Prime score band/);
  assert.match(html, /Score 42 sits in 40-55/);
  assert.match(html, /Strong signal breadth/);
  assert.match(html, /4 of 9 dimensions confirming/);
});

test("a down-direction factor renders with the bear tone, not fabricated as bullish", async () => {
  const html = await render({
    mode: "scoring",
    play: play({
      tier: {
        tier: "C",
        factors: [{ label: "Earnings risk", direction: "down", detail: "Binary event tomorrow." }],
      },
    }),
  });

  assert.match(html, /text-bear\/80/);
  // Scoped to the factor's own <span>, not the whole document — "text-bull" legitimately
  // appears later in the unrelated "Publish gates" section on every render.
  assert.match(html, /class="[^"]*text-bear\/80[^"]*">▼ Earnings risk/);
  assert.doesNotMatch(html, /▲ Earnings risk/);
});

test("no tier pinned (or no factors) → the section is absent, never an empty shell", async () => {
  const htmlNoTier = await render({ mode: "scoring", play: play({ tier: null }) });
  assert.doesNotMatch(htmlNoTier, /Why this tier/);

  const htmlEmptyFactors = await render({
    mode: "scoring",
    play: play({ tier: { tier: "B", factors: [] } }),
  });
  assert.doesNotMatch(htmlEmptyFactors, /Why this tier/);
});

test("overview mode never renders the tier-factors section — it belongs to the scoring drill-down only", async () => {
  const html = await render({
    mode: "overview",
    play: play({
      tier: { tier: "A", factors: [{ label: "Prime score band", direction: "up", detail: "detail" }] },
    }),
  });
  assert.doesNotMatch(html, /Why this tier/);
});
