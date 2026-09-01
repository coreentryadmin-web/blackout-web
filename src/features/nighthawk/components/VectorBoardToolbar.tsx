"use client";

import { clsx } from "clsx";
import { VectorBoardSortDropdown } from "@/features/nighthawk/components/VectorBoardSortDropdown";
import type { VectorBoardRowKind } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  VECTOR_BOARD_REASON_OPTIONS,
  type VectorBoardSort,
  type VectorBoardStatusFilter,
  type VectorBoardTierFilter,
  vectorBoardActiveFilterCount,
} from "@/features/nighthawk/lib/vector-board-filters";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";

type BoardTab = "all" | VectorBoardRowKind;

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

function fmtSignedPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v}%`;
}

function pnlTone(v: number | null): "is-up" | "is-down" | "is-flat" | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  if (v > 0) return "is-up";
  if (v < 0) return "is-down";
  return "is-flat";
}

export function VectorBoardToolbar({
  tab,
  tabCounts,
  onTabChange,
  sessionScope,
  onSessionScopeChange,
  tickerQuery,
  onTickerQueryChange,
  statusFilter,
  onStatusFilterChange,
  tierFilter,
  onTierFilterChange,
  reasonFilter,
  onReasonFilterChange,
  sort,
  onSortChange,
  selectedDate,
  onClearFilters,
  sessionPnl,
  netPnl,
  totalVisible,
}: {
  tab: BoardTab;
  tabCounts: Record<BoardTab, number>;
  onTabChange: (tab: BoardTab) => void;
  sessionScope: "current" | "all";
  onSessionScopeChange: (scope: "current" | "all") => void;
  tickerQuery: string;
  onTickerQueryChange: (q: string) => void;
  statusFilter: VectorBoardStatusFilter;
  onStatusFilterChange: (f: VectorBoardStatusFilter) => void;
  tierFilter: VectorBoardTierFilter;
  onTierFilterChange: (f: VectorBoardTierFilter) => void;
  reasonFilter: VectorClosureReasonFilter;
  onReasonFilterChange: (f: VectorClosureReasonFilter) => void;
  sort: VectorBoardSort;
  onSortChange: (s: VectorBoardSort) => void;
  selectedDate: string | null;
  onClearFilters: () => void;
  sessionPnl: number | null;
  netPnl: number | null;
  totalVisible: number;
}) {
  const tabs: { id: BoardTab; label: string }[] = [
    { id: "all", label: "All picks" },
    { id: "winner", label: "Winners" },
    { id: "runner", label: "Runners" },
    { id: "live", label: "Live" },
    { id: "closed", label: "Closed" },
  ];

  const activeFilterCount = vectorBoardActiveFilterCount({
    statusFilter,
    tierFilter,
    reasonFilter,
    selectedDate,
    tickerQuery,
  });

  return (
    <header className="vector-board-toolbar">
      <div className="vector-board-toolbar-row">
        <nav className="vector-board-tabs" role="tablist" aria-label="Vector board views">
          {tabs.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={clsx("vector-board-tab", active && "is-active")}
                onClick={() => onTabChange(id)}
              >
                {label}
                <span className="vector-board-tab-count tabular-nums">({tabCounts[id]})</span>
              </button>
            );
          })}
        </nav>

        <div className="vector-board-toolbar-actions">
          <div className="vector-board-scope" role="group" aria-label="Session scope">
            <button
              type="button"
              className={clsx("vector-board-scope-btn", sessionScope === "current" && "is-active")}
              onClick={() => onSessionScopeChange("current")}
            >
              Current
            </button>
            <button
              type="button"
              className={clsx("vector-board-scope-btn", sessionScope === "all" && "is-active")}
              onClick={() => onSessionScopeChange("all")}
            >
              All sessions
            </button>
          </div>
        </div>
      </div>

      <div className="vector-board-kpi-strip">
        <div className="vector-board-kpi">
          <span className="vector-board-kpi-label">Showing</span>
          <span className="vector-board-kpi-value tabular-nums">{totalVisible}</span>
        </div>
        {sessionPnl != null ? (
          <div className="vector-board-kpi">
            <span className="vector-board-kpi-label">Session P&amp;L</span>
            <span className={clsx("vector-board-kpi-value tabular-nums vector-board-pnl", pnlTone(sessionPnl))}>
              {fmtSignedPct(sessionPnl)}
            </span>
          </div>
        ) : null}
        {netPnl != null ? (
          <div className="vector-board-kpi">
            <span className="vector-board-kpi-label">Net P&amp;L</span>
            <span className={clsx("vector-board-kpi-value tabular-nums vector-board-pnl", pnlTone(netPnl))}>
              {fmtSignedPct(netPnl)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="vector-board-controls">
        <VectorBoardSortDropdown value={sort} onChange={onSortChange} />

        <div className="vector-board-filterbar" role="group" aria-label="Delivery status">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={clsx("vector-board-filter-btn", statusFilter === opt.id && "is-active")}
              onClick={() => onStatusFilterChange(opt.id)}
              aria-pressed={statusFilter === opt.id}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="vector-board-filterbar" role="group" aria-label="Tier">
          {TIER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={clsx("vector-board-filter-btn", tierFilter === opt.id && "is-active")}
              onClick={() => onTierFilterChange(opt.id)}
              aria-pressed={tierFilter === opt.id}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {tab === "closed" ? (
          <div className="vector-board-filterbar" role="group" aria-label="Close reason">
            {VECTOR_BOARD_REASON_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={clsx("vector-board-filter-btn", reasonFilter === opt.id && "is-active")}
                onClick={() => onReasonFilterChange(opt.id)}
                aria-pressed={reasonFilter === opt.id}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="vector-board-search">
          <span className="vector-board-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            value={tickerQuery}
            onChange={(e) => onTickerQueryChange(e.target.value.toUpperCase())}
            placeholder="Search ticker"
            className="vector-board-search-input"
            aria-label="Search ticker"
          />
          {tickerQuery ? (
            <button
              type="button"
              className="vector-board-search-clear"
              onClick={() => onTickerQueryChange("")}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        {activeFilterCount > 0 ? (
          <button type="button" className="vector-board-clear-btn" onClick={onClearFilters}>
            Clear filters ({activeFilterCount})
          </button>
        ) : null}
      </div>
    </header>
  );
}
