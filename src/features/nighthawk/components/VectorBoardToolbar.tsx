"use client";

import type { RefObject } from "react";
import { clsx } from "clsx";
import { VectorBoardFiltersDrawer } from "@/features/nighthawk/components/VectorBoardFiltersDrawer";
import { VectorBoardSortDropdown } from "@/features/nighthawk/components/VectorBoardSortDropdown";
import { VectorBoardViewMenu } from "@/features/nighthawk/components/VectorBoardViewMenu";
import type { VectorBoardTab } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  type VectorBoardSort,
  type VectorBoardStatusFilter,
  type VectorBoardTierFilter,
  vectorBoardActiveFilterCount,
} from "@/features/nighthawk/lib/vector-board-filters";
import type { VectorBoardPreferences, VectorBoardSavedView } from "@/features/nighthawk/lib/vector-board-preferences";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";

export function VectorBoardToolbar({
  tab,
  tabCounts,
  onTabChange,
  sessionScope,
  onSessionScopeChange,
  tickerQuery,
  onTickerQueryChange,
  searchInputRef,
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
  filtersOpen,
  onFiltersOpenChange,
  prefs,
  onPrefsChange,
  onApplyView,
  onExport,
  compareMode,
  onCompareModeChange,
}: {
  tab: VectorBoardTab;
  tabCounts: Record<VectorBoardTab, number>;
  onTabChange: (tab: VectorBoardTab) => void;
  sessionScope: "current" | "all";
  onSessionScopeChange: (scope: "current" | "all") => void;
  tickerQuery: string;
  onTickerQueryChange: (q: string) => void;
  searchInputRef?: RefObject<HTMLInputElement>;
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
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  prefs: VectorBoardPreferences;
  onPrefsChange: (next: VectorBoardPreferences) => void;
  onApplyView: (view: VectorBoardSavedView) => void;
  onExport: () => void;
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
}) {
  const tabs: { id: VectorBoardTab; label: string; hint?: string }[] = [
    { id: "all", label: "All" },
    { id: "open", label: "Open", hint: "Active desk picks — filter Winners/Runners in Filters" },
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
          {tabs.map(({ id, label, hint }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                title={hint}
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
              Today
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

      <div className="vector-board-controls">
        <VectorBoardSortDropdown value={sort} onChange={onSortChange} />
        <VectorBoardFiltersDrawer
          open={filtersOpen}
          onOpenChange={onFiltersOpenChange}
          activeCount={activeFilterCount}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          tierFilter={tierFilter}
          onTierFilterChange={onTierFilterChange}
          reasonFilter={reasonFilter}
          onReasonFilterChange={onReasonFilterChange}
          showReasonFilter={tab === "closed"}
          onClear={onClearFilters}
        />
        <VectorBoardViewMenu
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          onApplyView={onApplyView}
          onExport={onExport}
          compareMode={compareMode}
          onCompareModeChange={onCompareModeChange}
        />

        <div className="vector-board-search">
          <span className="vector-board-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchInputRef}
            value={tickerQuery}
            onChange={(e) => onTickerQueryChange(e.target.value.toUpperCase())}
            placeholder="Search ticker (/)"
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
            Clear ({activeFilterCount})
          </button>
        ) : null}
      </div>
    </header>
  );
}
