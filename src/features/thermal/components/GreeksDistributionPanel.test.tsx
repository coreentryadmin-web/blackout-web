import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GreeksDistributionPanel } from "./GreeksDistributionPanel";
import type { GexCells } from "@/features/thermal/lib/gex-heatmap/per-expiry-levels";

(globalThis as unknown as { React: typeof React }).React = React;

function panelText(cells: GexCells | null, spot: number | null, ticker = "SPY") {
  const html = renderToStaticMarkup(
    React.createElement(GreeksDistributionPanel, { cells, spot, ticker })
  );
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("GreeksDistributionPanel", () => {
  it("renders empty state when cells are null", () => {
    const text = panelText(null, 5550);
    assert.ok(text.includes("No exposure data available"));
  });

  it("renders empty state when spot is null", () => {
    const cells: GexCells = { "5550": { "2026-09-19": 1000 } };
    const text = panelText(cells, null);
    assert.ok(text.includes("No exposure data available"));
  });

  it("renders empty state when cells are empty", () => {
    const text = panelText({}, 5550);
    assert.ok(text.includes("No exposure data available"));
  });

  it("renders Greeks Distribution title", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1000 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Greeks Distribution"));
  });

  it("renders top 5 strikes", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1500 },
      "5560": { "2026-09-19": 500 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("5550"));
    assert.ok(text.includes("5545"));
    assert.ok(text.includes("Top 5 Strikes"));
  });

  it("detects concentration risk", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 500 },
      "5550": { "2026-09-19": 9000 },
      "5555": { "2026-09-19": 500 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.toLowerCase().includes("concentration"));
  });

  it("detects gaps in exposure", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 1000 },
      "5560": { "2026-09-19": 1000 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Gap"));
  });

  it("shows risk assessment metrics", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 800 },
      "5545": { "2026-09-19": 700 },
      "5550": { "2026-09-19": 600 },
      "5555": { "2026-09-19": 500 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Clusters"));
    assert.ok(text.includes("Spread"));
    assert.ok(text.includes("Max Gap"));
    assert.ok(text.includes("Total Strikes"));
  });

  it("shows Peak badge for highest gamma strike", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1000 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Peak"));
  });

  it("renders exposure percentages", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 8000 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("%"));
  });

  it("provides insights for well-distributed exposure", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 2000 },
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 2000 },
      "5555": { "2026-09-19": 2000 },
      "5560": { "2026-09-19": 2000 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Insights"));
  });

  it("handles mixed positive and negative gamma", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": -1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": -500 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Greeks Distribution"));
  });

  it("handles multiple expirations per strike", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 500, "2026-10-17": 300 },
      "5550": { "2026-09-19": 3000, "2026-10-17": 2000 },
      "5555": { "2026-09-19": 500, "2026-10-17": 400 },
    };
    const text = panelText(cells, 5550);
    assert.ok(text.includes("Greeks Distribution"));
  });
});
