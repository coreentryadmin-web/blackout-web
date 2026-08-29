import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { render } from "@testing-library/react";
import { GreeksDistributionPanel } from "./GreeksDistributionPanel";
import type { GexCells } from "@/features/thermal/lib/gex-heatmap/per-expiry-levels";

describe("GreeksDistributionPanel", () => {
  it("renders empty state when cells are null", () => {
    const { container } = render(
      <GreeksDistributionPanel cells={null} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("No exposure data available"));
  });

  it("renders empty state when spot is null", () => {
    const cells: GexCells = { "5550": { "2026-09-19": 1000 } };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={null} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("No exposure data available"));
  });

  it("renders empty state when cells are empty", () => {
    const { container } = render(
      <GreeksDistributionPanel cells={{}} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("No exposure data available"));
  });

  it("renders Greeks Distribution title", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1000 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("Greeks Distribution"));
  });

  it("renders top 5 strikes", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1500 },
      "5560": { "2026-09-19": 500 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("5550"));
    assert.ok(text?.includes("5545"));
    assert.ok(text?.includes("Top 5 Strikes"));
  });

  it("detects concentration risk", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 500 },
      "5550": { "2026-09-19": 9000 }, // 90% of total
      "5555": { "2026-09-19": 500 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("concentration"));
  });

  it("detects gaps in exposure", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 1000 },
      "5545": { "2026-09-19": 1000 },
      "5560": { "2026-09-19": 1000 }, // 15 point gap
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("Gap"));
  });

  it("shows risk assessment metrics", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 800 },
      "5545": { "2026-09-19": 700 },
      "5550": { "2026-09-19": 600 },
      "5555": { "2026-09-19": 500 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("Clusters"));
    assert.ok(text?.includes("Spread"));
    assert.ok(text?.includes("Max Gap"));
    assert.ok(text?.includes("Total Strikes"));
  });

  it("shows Peak badge for highest gamma strike", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": 1000 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("Peak"));
  });

  it("renders exposure percentages", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 8000 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    // Should show percentage values
    assert.ok(text?.includes("%"));
  });

  it("provides insights for well-distributed exposure", () => {
    const cells: GexCells = {
      "5540": { "2026-09-19": 2000 },
      "5545": { "2026-09-19": 2000 },
      "5550": { "2026-09-19": 2000 },
      "5555": { "2026-09-19": 2000 },
      "5560": { "2026-09-19": 2000 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    assert.ok(text?.includes("Insights"));
  });

  it("handles mixed positive and negative gamma", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": -1000 },
      "5550": { "2026-09-19": 5000 },
      "5555": { "2026-09-19": -500 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    // Should render without crashing
    assert.ok(text?.includes("Greeks Distribution"));
  });

  it("handles multiple expirations per strike", () => {
    const cells: GexCells = {
      "5545": { "2026-09-19": 500, "2026-10-17": 300 },
      "5550": { "2026-09-19": 3000, "2026-10-17": 2000 },
      "5555": { "2026-09-19": 500, "2026-10-17": 400 },
    };
    const { container } = render(
      <GreeksDistributionPanel cells={cells} spot={5550} ticker="SPY" />
    );
    const text = container.textContent;
    // Should aggregate across expirations
    assert.ok(text?.includes("Greeks Distribution"));
  });
});
