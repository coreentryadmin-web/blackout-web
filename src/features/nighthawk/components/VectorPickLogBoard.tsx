"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { etDateTimeShort } from "@/lib/et-clock";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { VectorBoardCalendar } from "@/features/nighthawk/components/VectorBoardCalendar";
import { VectorBoardCompareBar } from "@/features/nighthawk/components/VectorBoardCompareBar";
import { VectorBoardEmptyState } from "@/features/nighthawk/components/VectorBoardEmptyState";
import { VectorBoardLoadingSkeleton } from "@/features/nighthawk/components/VectorBoardLoadingSkeleton";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import { VectorBoardScorecard } from "@/features/nighthawk/components/VectorBoardScorecard";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import { VectorBoardToolbar } from "@/features/nighthawk/components/VectorBoardToolbar";
import { VectorPlayDetailPanel } from "@/features/nighthawk/components/VectorPlayDetailPanel";
import type { VectorBoardTableRow, VectorBoardTab } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  buildVectorBoardRows,
  formatPremiumPct,
  premiumPctTone,
  vectorBoardCalendarBuckets,
  vectorBoardMeter,
} from "@/features/nighthawk/lib/vector-board-table-utils";
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
  type VectorBoardColumnId,
  type VectorBoardPreferences,
  type VectorBoardSavedView,
} from "@/features/nighthawk/lib/vector-board-preferences";
import {
  vectorBoardCalendarSlice,
  vectorBoardExportCsv,
  vectorBoardRowAtRisk,
  vectorBoardRowIsLive,
  vectorBoardScorecard,
} from "@/features/nighthawk/lib/vector-board-row-utils";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type { VectorPickBoardResponse } from "@/features/nighthawk/components/VectorPickLogBoard.types";

const EM = "—";

async function fetchVectorBoard(url: string): Promise<VectorPickBoardResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`vector board fetch failed: ${res.status}`);
  return res.json();
}

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

function ariaSort(active: boolean, dir: "asc" | "desc"): "none" | "ascending" | "descending" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function emptyTitle(tab: VectorBoardTab): string {
  if (tab === "open") return "No open Vector picks";
  if (tab === "closed") return "No closed Vector picks match";
  return "No Vector picks match";
}

/**
 * Night Hawk Vector tab — X Ads Manager table with filters, sorts, premium column, and inspector rail.
 * Pass `fixtureData` on /vector-board-preview (dev only) to review UI without DB/Clerk.
 */
export function VectorPickLogBoard({ fixtureData }: { fixtureData?: VectorPickBoardResponse }) {
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [sessionScope, setSessionScope] = useState<"current" | "all">(fixtureData ? "all" : "current");
  const [tab, setTab] = useState<VectorBoardTab>(fixtureData ? "all" : "open");
  const tabUserPicked = useRef(Boolean(fixtureData));
  const [tickerQuery, setTickerQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<VectorBoardTableRow | null>(null);
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

  const persistPrefs = useCallback((next: VectorBoardPreferences) => {
    setPrefs(next);
    saveVectorBoardPreferences(next);
  }, []);

  // Always fetch the full board — calendar buckets need multi-day history. Client-side
  // sessionScope / selectedDate filters narrow the table without starving the calendar.
  const apiUrl = fixtureData != null ? null : "/api/market/vector/pick-closures/board?limit=500";

  const { data: swrData, error, isLoading } = useSWR<VectorPickBoardResponse>(
    apiUrl,
    fetchVectorBoard,
    { refreshInterval: fixtureData ? 0 : 30_000 }
  );

  const data = fixtureData ?? swrData;

  const winners = data?.winners ?? [];
  const leaders = data?.leaders ?? [];
  const closed = data?.closed ?? [];

  const tabCounts = useMemo(
    () => ({
      all: buildVectorBoardRows({ winners, leaders, closed, section: "all" }).length,
      open: buildVectorBoardRows({ winners, leaders, closed, section: "open" }).length,
      closed: closed.length,
    }),
    [winners, leaders, closed]
  );

  useEffect(() => {
    if (fixtureData || tabUserPicked.current || !data) return;
    const next = preferredTab(tabCounts.open, tabCounts.closed);
    setTab((cur) => (cur === next ? cur : next));
  }, [fixtureData, data, tabCounts.open, tabCounts.closed]);

  const sectionRows = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: tab }),
    [winners, leaders, closed, tab]
  );

  const calendarSource = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: "all" }),
    [winners, leaders, closed]
  );

  const calendarBuckets = useMemo(() => {
    const all = vectorBoardCalendarBuckets(calendarSource);
    return vectorBoardCalendarSlice(all, prefs.calendarRange) as typeof all;
  }, [calendarSource, prefs.calendarRange]);

  const sessionDateFilter = selectedDate ? selectedDate : sessionScope === "current" ? todaySession : null;

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

  const visibleRows = useMemo(
    () => sortVectorBoardRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir]
  );

  const compareRows = useMemo(
    () => visibleRows.filter((r) => compareKeys.has(r.key)),
    [visibleRows, compareKeys]
  );

  const col = (id: VectorBoardColumnId) => prefs.columns[id] !== false;

  const visibleColumnCount = useMemo(() => {
    let n = 0;
    if (col("pick")) n += 1;
    if (col("status")) n += 1;
    if (col("premium")) n += 1;
    if (col("entryMark")) n += 1;
    if (col("peak")) n += 1;
    if (col("path")) n += 1;
    if (col("updated")) n += 1;
    if (compareMode) n += 1;
    return Math.max(n, 1);
  }, [prefs.columns, compareMode]);

  const scorecardRows = useMemo(() => {
    if (sessionScope !== "current" || !todaySession) return [];
    const all = buildVectorBoardRows({ winners, leaders, closed, section: "all" });
    return filterVectorBoardRowsAdvanced(all, {
      sessionDate: todaySession,
      statusFilter: "all",
      tierFilter: "all",
      reasonFilter: "all",
      tickerQuery: "",
    });
  }, [winners, leaders, closed, sessionScope, todaySession]);

  const scorecard = useMemo(() => vectorBoardScorecard(scorecardRows), [scorecardRows]);

  useEffect(() => {
    if (!selectedRow) return;
    const stillVisible = visibleRows.some((r) => r.key === selectedRow.key);
    if (!stillVisible) setSelectedRow(null);
  }, [visibleRows, selectedRow]);

  useEffect(() => {
    if (!selectedRow || !tableRef.current) return;
    const row = tableRef.current.querySelector(".vector-board-row.is-selected");
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, selectedRow?.key]);

  useEffect(() => {
    if (!selectedRow) return;
    const idx = visibleRows.findIndex((r) => r.key === selectedRow.key);
    if (idx >= 0) setSelectedIndex(idx);
  }, [visibleRows, selectedRow]);

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
    setReasonFilter("all");
    setSelectedDate(null);
    setTickerQuery("");
  };

  const applyView = (view: VectorBoardSavedView) => {
    setStatusFilter(view.statusFilter);
    setTierFilter(view.tierFilter);
    setReasonFilter(view.reasonFilter);
    setSort(view.sort);
  };

  const exportCsv = () => {
    const csv = vectorBoardExportCsv(visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vector-board-${todaySession || "export"}.csv`;
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

  if (!fixtureData && isLoading && !data) {
    return <VectorBoardLoadingSkeleton />;
  }

  if (error || data?.degraded) {
    return (
      <div className="vector-board-shell">
        <VectorBoardEmptyState
          title="Vector board unavailable"
          description="The Vector leaders log could not load right now — it will retry automatically."
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "vector-board-shell",
        prefs.density === "compact" && "is-compact",
        prefs.focusMode && "is-focus"
      )}
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
          if (scope === "current") setSelectedDate(null);
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
        todaySession={todaySession}
        onSelectedDateChange={(date) => {
          if (!date) {
            setSelectedDate(null);
            setSessionScope("current");
            return;
          }
          if (date === todaySession) {
            setSessionScope("current");
            setSelectedDate(null);
          } else {
            setSessionScope("all");
            setSelectedDate(date);
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
      />

      {!prefs.focusMode && sessionScope === "current" && scorecardRows.length > 0 ? (
        <VectorBoardScorecard data={scorecard} sessionLabel={todaySession || "Today"} />
      ) : null}

      {data?.note && !prefs.focusMode ? (
        <p className="vector-board-note vector-board-note--inline">{data.note}</p>
      ) : null}

      {!prefs.focusMode && (calendarBuckets.length > 0 || selectedDate) ? (
        <div className="vector-board-cal-wrap">
          <VectorBoardCalendar
            buckets={calendarBuckets}
            selectedDate={selectedDate ?? (sessionScope === "current" ? todaySession : null)}
            onSelectDate={(date) => {
              if (!date) {
                setSelectedDate(null);
                return;
              }
              if (date === todaySession) {
                setSessionScope("current");
                setSelectedDate(null);
              } else {
                setSessionScope("all");
                setSelectedDate(date);
              }
            }}
          />
          {selectedDate ? (
            <button type="button" className="vector-board-cal-clear" onClick={() => setSelectedDate(null)}>
              Clear day
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="vector-board-body vector-board-body--split">
        <div className="vector-board-table-pane">
          <div className="vector-board-panel">
            <div className="vector-board-tablewrap" ref={tableRef}>
              <table className="vector-board-table">
                <thead>
                  <tr>
                    {compareMode ? <th className="vector-board-col-check" aria-label="Compare" /> : null}
                    {col("pick") ? <th className="vector-board-col-pick">Pick</th> : null}
                    {col("status") ? <th className="vector-board-col-status">Status</th> : null}
                    {col("premium") ? (
                      <th
                        className="vector-board-col-num vector-board-col-premium vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "pnl", sortDir)}
                        onClick={() => setSort(sortKey === "pnl" && sortDir === "desc" ? "pnl_asc" : "pnl_desc")}
                        title="Option premium vs pick entry — not managed 0DTE P&L"
                      >
                        Premium vs entry {sortKey === "pnl" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                    ) : null}
                    {col("entryMark") ? <th className="vector-board-col-num vector-board-col-entry">Entry → mark</th> : null}
                    {col("peak") ? (
                      <th
                        className="vector-board-col-num vector-board-col-peak vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "peak", sortDir)}
                        onClick={() => setSort(sortKey === "peak" && sortDir === "desc" ? "peak_asc" : "peak_desc")}
                      >
                        Peak {sortKey === "peak" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                    ) : null}
                    {col("path") ? <th className="vector-board-col-num vector-board-col-path">Premium path</th> : null}
                    {col("updated") ? (
                      <th
                        className="vector-board-col-updated vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "updated", sortDir)}
                        onClick={() =>
                          setSort(sortKey === "updated" && sortDir === "desc" ? "updated_asc" : "updated_desc")
                        }
                      >
                        Updated {sortKey === "updated" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {!visibleRows.length ? (
                    <tr className="vector-board-empty-row">
                      <td colSpan={visibleColumnCount}>
                        <div className="vector-board-empty">
                          <VectorBoardEmptyState
                            title={emptyTitle(tab)}
                            description="Try All sessions, clear filters, or change the sort."
                          />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => {
                      const selected = selectedRow?.key === row.key;
                      const live = vectorBoardRowIsLive(row);
                      const atRisk = vectorBoardRowAtRisk(row);
                      return (
                        <tr
                          key={row.key}
                          className={clsx(
                            "vector-board-row",
                            selected && "is-selected",
                            live && "is-live",
                            atRisk && "is-at-risk"
                          )}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => {
                            setSelectedRow(row);
                            setSelectedIndex(visibleRows.findIndex((r) => r.key === row.key));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedRow(row);
                              setSelectedIndex(visibleRows.findIndex((r) => r.key === row.key));
                            }
                          }}
                        >
                          {compareMode ? (
                            <td className="vector-board-col-check" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="vector-board-compare-check"
                                checked={compareKeys.has(row.key)}
                                onChange={() => toggleCompare(row.key)}
                                aria-label={`Compare ${row.ticker}`}
                              />
                            </td>
                          ) : null}
                          {col("pick") ? (
                            <td className="vector-board-col-pick">
                              <div className="vector-board-pick-name">
                                {live ? <span className="vector-board-live-dot" aria-label="Live" /> : null}
                                {row.ticker}
                              </div>
                              <div className="vector-board-pick-sub">{row.contractLabel}</div>
                              <div className="vector-board-pick-id">
                                {row.tier === "elite" ? "Elite · " : ""}
                                ID: {row.occ.slice(-8)}
                              </div>
                            </td>
                          ) : null}
                          {col("status") ? (
                            <td className="vector-board-col-status">
                              <div className="vector-board-status-cell">
                                <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
                                {atRisk ? <span className="vector-board-at-risk">At risk</span> : null}
                              </div>
                            </td>
                          ) : null}
                          {col("premium") ? (
                            <td
                              className={clsx(
                                "vector-board-col-num vector-board-col-premium vector-board-pnl vector-board-pnl-hero tabular-nums",
                                pnlClass(row.premiumPct)
                              )}
                              title="Premium vs pick entry"
                            >
                              {formatPremiumPct(row.premiumPct)}
                            </td>
                          ) : null}
                          {col("entryMark") ? (
                            <td className="vector-board-col-num vector-board-col-entry vector-board-mid tabular-nums">
                              {fmtPrice(row.entryMid)} → {fmtPrice(row.markMid)}
                            </td>
                          ) : null}
                          {col("peak") ? (
                            <td className={clsx("vector-board-col-num vector-board-col-peak tabular-nums", pnlClass(row.peakPct))}>
                              {formatPremiumPct(row.peakPct)}
                            </td>
                          ) : null}
                          {col("path") ? (
                            <td className="vector-board-col-num vector-board-col-path">
                              <VectorBoardMeter meter={vectorBoardMeter(row)} />
                            </td>
                          ) : null}
                          {col("updated") ? (
                            <td className="vector-board-col-updated vector-board-col-time tabular-nums">{fmtTimestamp(row.timestamp)}</td>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
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

        <VectorPlayDetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
      </div>
    </div>
  );
}
