"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { etDateTimeShort } from "@/lib/et-clock";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { VectorBoardCalendar } from "@/features/nighthawk/components/VectorBoardCalendar";
import { VectorBoardCompareBar } from "@/features/nighthawk/components/VectorBoardCompareBar";
import { VectorBoardEmptyState } from "@/features/nighthawk/components/VectorBoardEmptyState";
import { VectorBoardDataTable } from "@/features/nighthawk/components/VectorBoardDataTable";
import { VectorBoardLoadingSkeleton } from "@/features/nighthawk/components/VectorBoardLoadingSkeleton";
import { VectorBoardScorecard } from "@/features/nighthawk/components/VectorBoardScorecard";
import { VectorBoardToolbar } from "@/features/nighthawk/components/VectorBoardToolbar";
import { LegacyPlayManageRail } from "@/features/nighthawk/components/LegacyPlayManageRail";
import { LegacyPlayTechnicalsRail } from "@/features/nighthawk/components/LegacyPlayTechnicalsRail";
import { buildLegacyBoardColumns } from "@/features/nighthawk/lib/legacy-board-columns";
import {
  buildLegacyBoardRows,
  legacyBoardCalendarBuckets,
  legacyBoardExportCsv,
  type LegacyBoardTableRow,
} from "@/features/nighthawk/lib/legacy-board-table-utils";
import type { VectorBoardTab } from "@/features/nighthawk/lib/vector-board-table-utils";
import { premiumPctTone } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  filterVectorBoardRowsAdvanced,
  parseVectorBoardSort,
  sortVectorBoardRows,
  type VectorBoardSort,
  type VectorBoardStatusFilter,
  type VectorBoardTierFilter,
} from "@/features/nighthawk/lib/vector-board-filters";
import {
  loadVectorBoardPreferences,
  saveVectorBoardPreferences,
  type VectorBoardPreferences,
  type VectorBoardSavedView,
} from "@/features/nighthawk/lib/vector-board-preferences";
import {
  vectorBoardCalendarSlice,
  vectorBoardRowAtRisk,
  vectorBoardRowIsLive,
  vectorBoardScorecard,
} from "@/features/nighthawk/lib/vector-board-row-utils";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import { useVectorBoardMobile } from "@/features/nighthawk/hooks/use-vector-board-mobile";

const EM = "—";

function fmtPrice(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : EM;
}

function fmtTimestamp(iso: string): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  return etDateTimeShort(d) ?? EM;
}

function pnlClass(pct: number | null): string {
  const tone = premiumPctTone(pct);
  if (tone === "bull") return "is-up";
  if (tone === "bear") return "is-down";
  return "is-flat";
}

function preferredTab(openCount: number, closedCount: number): VectorBoardTab {
  if (openCount > 0) return "open";
  if (closedCount > 0) return "closed";
  return "all";
}

function emptyTitle(tab: VectorBoardTab): string {
  if (tab === "open") return "No open Legacy plays";
  if (tab === "closed") return "No pulled or closed plays";
  return "No plays in this edition";
}

export type LegacyPickLogBoardProps = {
  plays: TerminalPlay[];
  loading?: boolean;
  degraded?: boolean;
  editionFor: string | null;
  editionLabel?: string | null;
  todaySession: string;
  selectedEditionDate: string | null;
  onSelectedEditionDateChange: (date: string | null) => void;
  calendarDates: string[];
  bannerSlot?: React.ReactNode;
  emptyDescription?: string | null;
};

/**
 * Legacy overnight playbook — X Ads Manager table (same shell as VectorPickLogBoard).
 */
export function LegacyPickLogBoard({
  plays,
  loading = false,
  degraded = false,
  editionFor,
  editionLabel,
  todaySession,
  selectedEditionDate,
  onSelectedEditionDateChange,
  calendarDates,
  bannerSlot,
  emptyDescription,
}: LegacyPickLogBoardProps) {
  const [sessionScope, setSessionScope] = useState<"current" | "all">("current");
  const [tab, setTab] = useState<VectorBoardTab>("open");
  const tabUserPicked = useRef(false);
  const [tickerQuery, setTickerQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(selectedEditionDate);
  const [selectedRow, setSelectedRow] = useState<LegacyBoardTableRow | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusFilter, setStatusFilter] = useState<VectorBoardStatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<VectorBoardTierFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<VectorClosureReasonFilter>("all");
  const [sort, setSort] = useState<VectorBoardSort>("updated_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefs, setPrefs] = useState<VectorBoardPreferences>(() => loadVectorBoardPreferences());
  const [compareMode, setCompareMode] = useState(false);
  const [compareKeys, setCompareKeys] = useState<Set<string>>(() => new Set());
  const [compareLimitHit, setCompareLimitHit] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useVectorBoardMobile();

  useEffect(() => {
    setSelectedDate(selectedEditionDate);
  }, [selectedEditionDate]);

  const persistPrefs = useCallback((next: VectorBoardPreferences) => {
    setPrefs(next);
    saveVectorBoardPreferences(next);
  }, []);

  const allRows = useMemo(
    () => buildLegacyBoardRows(plays, "all", editionFor),
    [plays, editionFor]
  );

  const tabCounts = useMemo(
    () => ({
      all: allRows.length,
      open: buildLegacyBoardRows(plays, "open", editionFor).length,
      closed: buildLegacyBoardRows(plays, "closed", editionFor).length,
    }),
    [plays, editionFor, allRows.length]
  );

  useEffect(() => {
    if (tabUserPicked.current || loading) return;
    const next = preferredTab(tabCounts.open, tabCounts.closed);
    setTab((cur) => (cur === next ? cur : next));
  }, [loading, tabCounts.open, tabCounts.closed]);

  const sectionRows = useMemo(
    () => buildLegacyBoardRows(plays, tab, editionFor),
    [plays, tab, editionFor]
  );

  const calendarBuckets = useMemo(() => {
    const all = legacyBoardCalendarBuckets(allRows, calendarDates);
    return vectorBoardCalendarSlice(all, prefs.calendarRange) as typeof all;
  }, [allRows, calendarDates, prefs.calendarRange]);

  const sessionDates = useMemo(
    () => calendarBuckets.map((b) => b.session_date),
    [calendarBuckets]
  );

  const sessionDateFilter = selectedDate
    ? selectedDate
    : sessionScope === "current"
      ? editionFor ?? todaySession
      : null;

  const filteredRows = useMemo(() => {
    return filterVectorBoardRowsAdvanced(sectionRows, {
      tickerQuery,
      sessionDate: sessionDateFilter,
      statusFilter,
      tierFilter,
      reasonFilter: tab === "closed" ? reasonFilter : "all",
    });
  }, [sectionRows, tickerQuery, sessionDateFilter, statusFilter, tierFilter, reasonFilter, tab]);

  const { key: sortKey, dir: sortDir } = parseVectorBoardSort(sort);

  const boardColumns = useMemo(
    () =>
      buildLegacyBoardColumns({
        prefs,
        compareMode,
        sortKey,
        sortDir,
        onSortPnl: () => setSort(sortKey === "pnl" && sortDir === "desc" ? "pnl_asc" : "pnl_desc"),
        onSortPeak: () => setSort(sortKey === "peak" && sortDir === "desc" ? "peak_asc" : "peak_desc"),
        onSortUpdated: () =>
          setSort(sortKey === "updated" && sortDir === "desc" ? "updated_asc" : "updated_desc"),
      }),
    [prefs, compareMode, sortKey, sortDir]
  );

  const visibleRows = useMemo(
    () => sortVectorBoardRows(filteredRows, sortKey, sortDir) as LegacyBoardTableRow[],
    [filteredRows, sortKey, sortDir]
  );

  const compareRows = useMemo(
    () => visibleRows.filter((r) => compareKeys.has(r.key)),
    [visibleRows, compareKeys]
  );

  const scorecardRows = useMemo(() => {
    if (!editionFor) return [];
    return filterVectorBoardRowsAdvanced(allRows, {
      sessionDate: editionFor,
      statusFilter: "all",
      tierFilter: "all",
      reasonFilter: "all",
      tickerQuery: "",
    });
  }, [allRows, editionFor]);

  const scorecard = useMemo(() => vectorBoardScorecard(scorecardRows), [scorecardRows]);

  useEffect(() => {
    if (!selectedRow) return;
    if (!visibleRows.some((r) => r.key === selectedRow.key)) setSelectedRow(null);
  }, [visibleRows, selectedRow]);

  useEffect(() => {
    if (!selectedRow || !tableRef.current) return;
    tableRef.current.querySelector(".vector-board-row.is-selected")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, selectedRow?.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(visibleRows.length - 1, selectedIndex + 1);
        setSelectedIndex(next);
        const row = visibleRows[next];
        if (row) setSelectedRow(row);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, selectedIndex - 1);
        setSelectedIndex(next);
        const row = visibleRows[next];
        if (row) setSelectedRow(row);
      }
      if (e.key === "Escape") {
        setSelectedRow(null);
        setFiltersOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleRows, selectedIndex]);

  const clearFilters = () => {
    setStatusFilter("all");
    setTierFilter("all");
    setSelectedDate(null);
    onSelectedEditionDateChange(null);
    setTickerQuery("");
  };

  const applyView = (view: VectorBoardSavedView) => {
    setStatusFilter(view.statusFilter);
    setTierFilter(view.tierFilter);
    setSort(view.sort);
  };

  const exportCsv = () => {
    const csv = legacyBoardExportCsv(visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `legacy-board-${editionFor ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleCompare = (key: string) => {
    setCompareKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setCompareLimitHit(false);
      } else if (next.size < 3) {
        next.add(key);
        setCompareLimitHit(false);
      } else {
        setCompareLimitHit(true);
        window.setTimeout(() => setCompareLimitHit(false), 2200);
      }
      return next;
    });
  };

  if (loading && plays.length === 0) {
    return <VectorBoardLoadingSkeleton />;
  }

  if (degraded && plays.length === 0) {
    return (
      <div className="vector-board-shell legacy-board-shell">
        <VectorBoardEmptyState
          title="Legacy playbook unavailable"
          description="Edition data could not load right now — it will retry automatically."
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "vector-board-shell legacy-board-shell",
        "legacy-board-xads",
        selectedRow && "legacy-board-shell--inspector",
        prefs.density === "compact" && "is-compact",
        prefs.focusMode && "is-focus"
      )}
      data-board="legacy-xads-table"
    >
      <VectorBoardToolbar
        tab={tab}
        tabCounts={tabCounts}
        onTabChange={(next) => {
          tabUserPicked.current = true;
          setTab(next);
        }}
        sessionScope={sessionScope}
        onSessionScopeChange={(scope) => {
          setSessionScope(scope);
          if (scope === "current") {
            setSelectedDate(null);
            onSelectedEditionDateChange(null);
          }
        }}
        tickerQuery={tickerQuery}
        onTickerQueryChange={setTickerQuery}
        searchInputRef={searchRef}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
        reasonFilter={reasonFilter}
        onReasonFilterChange={setReasonFilter}
        sort={sort}
        onSortChange={setSort}
        selectedDate={selectedDate}
        todaySession={editionFor ?? todaySession}
        onSelectedDateChange={(date) => {
          setSelectedDate(date);
          onSelectedEditionDateChange(date);
          if (!date) {
            setSessionScope("current");
            return;
          }
          if (date === (editionFor ?? todaySession)) {
            setSessionScope("current");
          } else {
            setSessionScope("all");
          }
        }}
        onClearFilters={clearFilters}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        prefs={prefs}
        onPrefsChange={persistPrefs}
        onApplyView={applyView}
        onExport={exportCsv}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        visibleCount={visibleRows.length}
        sectionCount={sectionRows.length}
        sessionDates={sessionDates}
      />

      {bannerSlot}

      {!prefs.focusMode && !selectedRow && scorecardRows.length > 0 ? (
        <VectorBoardScorecard data={scorecard} sessionLabel={editionLabel ?? editionFor ?? "Edition"} />
      ) : null}

      {!prefs.focusMode && !selectedRow && calendarBuckets.length > 0 ? (
        <div className="vector-board-cal-wrap">
          <VectorBoardCalendar
            buckets={calendarBuckets}
            selectedDate={selectedDate ?? editionFor ?? null}
            onSelectDate={(date) => {
              setSelectedDate(date);
              onSelectedEditionDateChange(date);
            }}
          />
          {selectedDate ? (
            <button
              type="button"
              className="vector-board-cal-clear"
              onClick={() => {
                setSelectedDate(null);
                onSelectedEditionDateChange(null);
              }}
            >
              Clear day
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={clsx(
          "vector-board-body legacy-board-body",
          selectedRow ? "legacy-board-body--inspector" : "vector-board-body--split",
          selectedRow && "has-detail-open",
          prefs.focusMode && !selectedRow && "is-focus-awaiting"
        )}
      >
        <div className="legacy-board-upper">
          <div className="vector-board-table-pane">
            <div className="vector-board-panel">
              <VectorBoardDataTable
                columns={boardColumns}
                rows={visibleRows}
                tableRef={tableRef}
                selectedKey={selectedRow?.key ?? null}
                onSelectRow={(row, index) => {
                  setSelectedRow(row);
                  setSelectedIndex(index);
                }}
                emptyTitle={emptyTitle(tab)}
                emptyDescription={
                  emptyDescription && plays.length === 0
                    ? emptyDescription
                    : "Try another tab, clear filters, or pick a different edition date."
                }
                getRowCtx={(row) => ({
                  live: vectorBoardRowIsLive(row),
                  atRisk: vectorBoardRowAtRisk(row),
                  compareChecked: compareKeys.has(row.key),
                  onToggleCompare: () => toggleCompare(row.key),
                  fmtPrice,
                  fmtTimestamp,
                  pnlClass,
                })}
                rowClassName={(row) =>
                  clsx(
                    vectorBoardRowIsLive(row) && "is-live",
                    vectorBoardRowAtRisk(row) && "is-at-risk"
                  )
                }
              />
            </div>
            <VectorBoardCompareBar
              rows={compareRows}
              onClear={() => {
                setCompareKeys(new Set());
                setCompareLimitHit(false);
              }}
              limitHit={compareLimitHit}
            />
          </div>

          {isMobile && selectedRow ? (
            <button
              type="button"
              className="vector-board-detail-backdrop"
              aria-label="Close detail"
              onClick={() => setSelectedRow(null)}
            />
          ) : null}

          <LegacyPlayManageRail
            row={selectedRow}
            onClose={() => setSelectedRow(null)}
            sheet={isMobile && !!selectedRow}
          />
        </div>

        <LegacyPlayTechnicalsRail row={selectedRow} />
      </div>
    </div>
  );
}
