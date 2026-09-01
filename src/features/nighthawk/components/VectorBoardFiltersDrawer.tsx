"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  VECTOR_BOARD_REASON_OPTIONS,
  type VectorBoardStatusFilter,
  type VectorBoardTierFilter,
} from "@/features/nighthawk/lib/vector-board-filters";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";

const STATUS_OPTIONS: { id: VectorBoardStatusFilter; label: string }[] = [
  { id: "all", label: "All status" },
  { id: "open", label: "Open" },
  { id: "winner", label: "Winners" },
  { id: "runner", label: "Runners" },
  { id: "caution", label: "Caution" },
  { id: "closed", label: "Closed" },
  { id: "invalidated", label: "Stressed" },
];

const TIER_OPTIONS: { id: VectorBoardTierFilter; label: string }[] = [
  { id: "all", label: "All tiers" },
  { id: "elite", label: "Elite" },
  { id: "standard", label: "Standard" },
];

export function VectorBoardFiltersDrawer({
  open,
  onOpenChange,
  activeCount,
  statusFilter,
  onStatusFilterChange,
  tierFilter,
  onTierFilterChange,
  reasonFilter,
  onReasonFilterChange,
  showReasonFilter,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCount: number;
  statusFilter: VectorBoardStatusFilter;
  onStatusFilterChange: (f: VectorBoardStatusFilter) => void;
  tierFilter: VectorBoardTierFilter;
  onTierFilterChange: (f: VectorBoardTierFilter) => void;
  reasonFilter: VectorClosureReasonFilter;
  onReasonFilterChange: (f: VectorClosureReasonFilter) => void;
  showReasonFilter: boolean;
  onClear: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="vector-board-filters" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-board-filters-trigger", open && "is-open", activeCount > 0 && "has-active")}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Filters
        {activeCount > 0 ? <span className="vector-board-filters-badge tabular-nums">{activeCount}</span> : null}
      </button>
      {open ? (
        <div className="vector-board-filters-panel" role="dialog" aria-label="Vector board filters">
          <div className="vector-board-filters-section">
            <span className="vector-board-filters-heading">Status</span>
            <div className="vector-board-filters-grid">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={clsx("vector-board-filter-chip", statusFilter === opt.id && "is-active")}
                  onClick={() => onStatusFilterChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="vector-board-filters-section">
            <span className="vector-board-filters-heading">Tier</span>
            <div className="vector-board-filters-grid">
              {TIER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={clsx("vector-board-filter-chip", tierFilter === opt.id && "is-active")}
                  onClick={() => onTierFilterChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {showReasonFilter ? (
            <div className="vector-board-filters-section">
              <span className="vector-board-filters-heading">Close reason</span>
              <div className="vector-board-filters-grid">
                {VECTOR_BOARD_REASON_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={clsx("vector-board-filter-chip", reasonFilter === opt.id && "is-active")}
                    onClick={() => onReasonFilterChange(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {activeCount > 0 ? (
            <button type="button" className="vector-board-filters-clear" onClick={onClear}>
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
