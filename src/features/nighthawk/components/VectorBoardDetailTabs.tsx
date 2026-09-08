"use client";

import { useState } from "react";
import { clsx } from "clsx";

export type VectorBoardDetailTab = "overview" | "path" | "timeline" | "desk";

const TABS: { id: VectorBoardDetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "path", label: "Path" },
  { id: "timeline", label: "Timeline" },
  { id: "desk", label: "Desk" },
];

export function VectorBoardDetailTabs({
  active,
  onChange,
}: {
  active: VectorBoardDetailTab;
  onChange: (tab: VectorBoardDetailTab) => void;
}) {
  return (
    <nav className="vector-board-detail-tabs" role="tablist" aria-label="Detail sections">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={clsx("vector-board-detail-tab", active === id && "is-active")}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export function useVectorBoardDetailTab(defaultTab: VectorBoardDetailTab = "overview") {
  return useState<VectorBoardDetailTab>(defaultTab);
}
