"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { EmptyState, Skeleton } from "@/components/ui";
import { etDateTimeShort } from "@/lib/et-clock";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { VectorBoardCalendar } from "@/features/nighthawk/components/VectorBoardCalendar";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import { VectorBoardToolbar } from "@/features/nighthawk/components/VectorBoardToolbar";
import { VectorPlayDetailPanel } from "@/features/nighthawk/components/VectorPlayDetailPanel";
import type { VectorBoardRowKind, VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  buildVectorBoardRows,
  formatPremiumPct,
  premiumPctTone,
  vectorBoardCalendarBuckets,
  vectorBoardMeter,
  vectorBoardSummary,
} from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  filterVectorBoardRowsAdvanced,
  parseVectorBoardSort,
  sortVectorBoardRows,
  vectorBoardSessionPnl,
  type VectorBoardSort,
  type VectorBoardStatusFilter,
  type VectorBoardTierFilter,
} from "@/features/nighthawk/lib/vector-board-filters";
import { filterVectorRunnerLeaders, preferredVectorBoardSection } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type { VectorPickBoardResponse } from "@/features/nighthawk/components/VectorPickLogBoard.types";

type BoardTab = "all" | VectorBoardRowKind;

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

function preferredTab(
  winnersCount: number,
  runnersCount: number,
  leadersCount: number
): BoardTab {
  const legacy = preferredVectorBoardSection(winnersCount, runnersCount, leadersCount);
  if (legacy === "runners") return "runner";
  if (legacy === "leaders") return "live";
  if (legacy === "winners") return "winner";
  return "all";
}

function ariaSort(active: boolean, dir: "asc" | "desc"): "none" | "ascending" | "descending" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

/**
 * Night Hawk Vector tab — X Ads Manager table with filters, sorts, P&L column, and inspector rail.
 * Pass `fixtureData` on /vector-board-preview (dev only) to review UI without DB/Clerk.
 */
export function VectorPickLogBoard({ fixtureData }: { fixtureData?: VectorPickBoardResponse }) {
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [sessionScope, setSessionScope] = useState<"current" | "all">(fixtureData ? "all" : "current");
  const [tab, setTab] = useState<BoardTab>("all");
  const tabUserPicked = useRef(Boolean(fixtureData));
  const [tickerQuery, setTickerQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<VectorBoardTableRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<VectorBoardStatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<VectorBoardTierFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<VectorClosureReasonFilter>("all");
  const [sort, setSort] = useState<VectorBoardSort>("updated_desc");

  const apiUrl =
    fixtureData != null
      ? null
      : sessionScope === "current" && todaySession
        ? `/api/market/vector/pick-closures/board?limit=500&session_date=${todaySession}`
        : "/api/market/vector/pick-closures/board?limit=500";

  const { data: swrData, error, isLoading } = useSWR<VectorPickBoardResponse>(
    apiUrl,
    fetchVectorBoard,
    { refreshInterval: fixtureData ? 0 : 30_000 }
  );

  const data = fixtureData ?? swrData;

  const winners = data?.winners ?? [];
  const leaders = data?.leaders ?? [];
  const closed = data?.closed ?? [];
  const runners = useMemo(() => filterVectorRunnerLeaders(leaders), [leaders]);
  const winnerKeys = useMemo(
    () => new Set(winners.map((w) => `${w.ticker}-${w.contract.occ}`)),
    [winners]
  );
  const liveCount = useMemo(
    () =>
      leaders.filter(
        (r) =>
          !winnerKeys.has(`${r.ticker}-${r.contract.occ}`) &&
          !runners.some((x) => x.id === r.id && x.contract.occ === r.contract.occ)
      ).length,
    [leaders, winnerKeys, runners]
  );

  const tabCounts = useMemo(
    () => ({
      all: buildVectorBoardRows({ winners, leaders, closed, section: "all" }).length,
      winner: winners.length,
      runner: runners.length,
      live: liveCount,
      closed: closed.length,
    }),
    [winners, leaders, closed, runners.length, liveCount]
  );

  useEffect(() => {
    if (fixtureData || tabUserPicked.current || !data) return;
    const next = preferredTab(winners.length, runners.length, leaders.length);
    setTab((cur) => (cur === next ? cur : next));
  }, [fixtureData, data, winners.length, runners.length, leaders.length]);

  const sectionRows = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: tab }),
    [winners, leaders, closed, tab]
  );

  const calendarSource = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: "all" }),
    [winners, leaders, closed]
  );

  const calendarBuckets = useMemo(() => vectorBoardCalendarBuckets(calendarSource), [calendarSource]);

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

  const summary = useMemo(() => vectorBoardSummary(visibleRows), [visibleRows]);
  const sessionPnl = useMemo(
    () => vectorBoardSessionPnl(sectionRows, sessionDateFilter),
    [sectionRows, sessionDateFilter]
  );

  useEffect(() => {
    if (!selectedRow) return;
    const stillVisible = visibleRows.some((r) => r.key === selectedRow.key);
    if (!stillVisible) setSelectedRow(null);
  }, [visibleRows, selectedRow]);

  const clearFilters = () => {
    setStatusFilter("all");
    setTierFilter("all");
    setReasonFilter("all");
    setSelectedDate(null);
    setTickerQuery("");
  };

  if (!fixtureData && isLoading && !data) {
    return (
      <div className="vector-board-shell">
        <Skeleton className="h-10 w-full shrink-0" />
        <Skeleton className="h-14 w-full shrink-0" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  if (error || data?.degraded) {
    return (
      <EmptyState
        title="Vector board unavailable"
        description="The Vector leaders log could not load right now — it will retry automatically."
      />
    );
  }

  return (
    <div className="vector-board-shell">
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
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
        reasonFilter={reasonFilter}
        onReasonFilterChange={setReasonFilter}
        sort={sort}
        onSortChange={setSort}
        selectedDate={selectedDate}
        onClearFilters={clearFilters}
        sessionPnl={sessionPnl}
        netPnl={summary.netPnl}
        totalVisible={visibleRows.length}
      />

      {data?.note ? <p className="vector-board-note vector-board-note--inline">{data.note}</p> : null}

      {calendarBuckets.length > 0 ? (
        <div className="vector-board-cal-wrap">
          <VectorBoardCalendar
            buckets={calendarBuckets}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          {selectedDate ? (
            <button type="button" className="vector-board-cal-clear" onClick={() => setSelectedDate(null)}>
              Clear day
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="vector-board-body">
        <div className="vector-board-table-pane">
          <div className="vector-board-panel">
            {!visibleRows.length ? (
              <div className="vector-board-empty">
                <EmptyState
                  title={
                    tab === "winner"
                      ? "No winning Vector picks yet"
                      : tab === "runner"
                        ? "No +15% runners yet"
                        : tab === "live"
                          ? "No live Vector leaders"
                          : tab === "closed"
                            ? "No closed Vector picks match"
                            : "No Vector picks match"
                  }
                  description="Try All sessions, clear filters, or change the sort."
                />
              </div>
            ) : (
              <div className="vector-board-tablewrap">
                <table className="vector-board-table">
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th>Status</th>
                      <th
                        className="vector-board-col-num vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "pnl", sortDir)}
                        onClick={() => setSort(sortKey === "pnl" && sortDir === "desc" ? "pnl_asc" : "pnl_desc")}
                      >
                        P&amp;L % {sortKey === "pnl" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                      <th className="vector-board-col-num">Entry → mark</th>
                      <th
                        className="vector-board-col-num vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "peak", sortDir)}
                        onClick={() => setSort(sortKey === "peak" && sortDir === "desc" ? "peak_asc" : "peak_desc")}
                      >
                        Peak {sortKey === "peak" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                      <th className="vector-board-col-num">Premium path</th>
                      <th
                        className="vector-board-th-sortable"
                        aria-sort={ariaSort(sortKey === "updated", sortDir)}
                        onClick={() =>
                          setSort(sortKey === "updated" && sortDir === "desc" ? "updated_asc" : "updated_desc")
                        }
                      >
                        Updated {sortKey === "updated" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="vector-board-summary-row">
                      <td colSpan={2}>
                        <span className="vector-board-summary-label">Total for {summary.total} picks</span>
                      </td>
                      <td
                        className={clsx(
                          "vector-board-col-num vector-board-pnl vector-board-pnl-hero tabular-nums",
                          pnlClass(summary.netPnl)
                        )}
                        title="Equal-weight sum of premium % vs pick entry"
                      >
                        {summary.netPnl != null ? `${summary.netPnl >= 0 ? "+" : ""}${summary.netPnl}%` : EM}
                      </td>
                      <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                        Avg <strong>{summary.avgPct != null ? `${summary.avgPct >= 0 ? "+" : ""}${summary.avgPct}%` : EM}</strong>
                      </td>
                      <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                        <strong>{summary.winners}</strong> winners
                      </td>
                      <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                        <strong>{summary.open}</strong> open
                      </td>
                      <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                        <strong>{summary.closed}</strong> closed
                      </td>
                    </tr>

                    {visibleRows.map((row) => {
                      const selected = selectedRow?.key === row.key;
                      return (
                        <tr
                          key={row.key}
                          className={clsx("vector-board-row", selected && "is-selected")}
                          onClick={() => setSelectedRow(row)}
                        >
                          <td className="vector-board-col-pick">
                            <div className="vector-board-pick-name">{row.ticker}</div>
                            <div className="vector-board-pick-sub">{row.contractLabel}</div>
                            <div className="vector-board-pick-id">
                              {row.tier === "elite" ? "Elite · " : ""}
                              ID: {row.occ.slice(-8)}
                            </div>
                          </td>
                          <td>
                            <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
                          </td>
                          <td
                            className={clsx(
                              "vector-board-col-num vector-board-pnl vector-board-pnl-hero tabular-nums",
                              pnlClass(row.premiumPct)
                            )}
                            title="Premium vs pick entry — Vector desk P&L"
                          >
                            {formatPremiumPct(row.premiumPct)}
                          </td>
                          <td className="vector-board-col-num vector-board-mid tabular-nums">
                            {fmtPrice(row.entryMid)} → {fmtPrice(row.markMid)}
                          </td>
                          <td className={clsx("vector-board-col-num tabular-nums", pnlClass(row.peakPct))}>
                            {formatPremiumPct(row.peakPct)}
                          </td>
                          <td className="vector-board-col-num">
                            <VectorBoardMeter meter={vectorBoardMeter(row)} />
                          </td>
                          <td className="vector-board-col-time tabular-nums">{fmtTimestamp(row.timestamp)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <VectorPlayDetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
      </div>
    </div>
  );
}
