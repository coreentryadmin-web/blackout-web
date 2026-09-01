"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { EmptyState, Skeleton } from "@/components/ui";
import { etDateTimeShort } from "@/lib/et-clock";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { VectorBoardCalendar } from "@/features/nighthawk/components/VectorBoardCalendar";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import { VectorPlayDetailPanel } from "@/features/nighthawk/components/VectorPlayDetailPanel";
import type { VectorBoardRowKind, VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  buildVectorBoardRows,
  filterVectorBoardRows,
  formatPremiumPct,
  premiumPctTone,
  vectorBoardCalendarBuckets,
  vectorBoardSummary,
} from "@/features/nighthawk/lib/vector-board-table-utils";
import { filterVectorRunnerLeaders, preferredVectorBoardSection } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type { VectorPickBoardResponse } from "@/features/nighthawk/components/VectorPickLogBoard.types";

type BoardTab = "all" | VectorBoardRowKind;

const EM = "—";

const TABS: { id: BoardTab; label: string }[] = [
  { id: "all", label: "All picks" },
  { id: "winner", label: "Winners" },
  { id: "runner", label: "Runners" },
  { id: "live", label: "Live" },
  { id: "closed", label: "Closed" },
];

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

function tabCount(
  tab: BoardTab,
  data: {
    all: number;
    winners: number;
    runners: number;
    live: number;
    closed: number;
  }
): number {
  if (tab === "all") return data.all;
  if (tab === "winner") return data.winners;
  if (tab === "runner") return data.runners;
  if (tab === "live") return data.live;
  return data.closed;
}

/**
 * Night Hawk Vector tab — X Ads Manager–style table board with underline tabs,
 * session calendar, summary row, and right-rail play inspector.
 */
export function VectorPickLogBoard() {
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [sessionScope, setSessionScope] = useState<"current" | "all">("current");
  const [tab, setTab] = useState<BoardTab>("all");
  const tabUserPicked = useRef(false);
  const [tickerQuery, setTickerQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<VectorBoardTableRow | null>(null);

  const apiUrl =
    sessionScope === "current" && todaySession
      ? `/api/market/vector/pick-closures/board?limit=500&session_date=${todaySession}`
      : "/api/market/vector/pick-closures/board?limit=500";

  const { data, error, isLoading } = useSWR<VectorPickBoardResponse>(apiUrl, fetchVectorBoard, {
    refreshInterval: 30_000,
  });

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
      winners: winners.length,
      runners: runners.length,
      live: liveCount,
      closed: closed.length,
    }),
    [winners, leaders, closed, runners.length, liveCount]
  );

  useEffect(() => {
    if (tabUserPicked.current || !data) return;
    const next = preferredTab(winners.length, runners.length, leaders.length);
    setTab((cur) => (cur === next ? cur : next));
  }, [data, winners.length, runners.length, leaders.length]);

  const sectionRows = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: tab }),
    [winners, leaders, closed, tab]
  );

  const calendarSource = useMemo(
    () => buildVectorBoardRows({ winners, leaders, closed, section: "all" }),
    [winners, leaders, closed]
  );

  const calendarBuckets = useMemo(() => vectorBoardCalendarBuckets(calendarSource), [calendarSource]);

  const visibleRows = useMemo(() => {
    return filterVectorBoardRows(sectionRows, {
      tickerQuery,
      sessionDate: selectedDate ? selectedDate : sessionScope === "current" ? todaySession : null,
    });
  }, [sectionRows, tickerQuery, selectedDate, sessionScope, todaySession]);

  const summary = useMemo(() => vectorBoardSummary(visibleRows), [visibleRows]);

  useEffect(() => {
    if (!selectedRow) return;
    const stillVisible = visibleRows.some((r) => r.key === selectedRow.key);
    if (!stillVisible) setSelectedRow(null);
  }, [visibleRows, selectedRow]);

  if (isLoading && !data) {
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

  const coverage = data?.coverage;

  return (
    <div className="vector-board-shell">
      <header className="vector-board-toolbar">
        <div className="vector-board-toolbar-row">
          <nav className="vector-board-tabs" role="tablist" aria-label="Vector board views">
            {TABS.map(({ id, label }) => {
              const count = tabCount(id, tabCounts);
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={clsx("vector-board-tab", active && "is-active")}
                  onClick={() => {
                    tabUserPicked.current = true;
                    setTab(id);
                  }}
                >
                  {label}
                  <span className="vector-board-tab-count tabular-nums">({count})</span>
                </button>
              );
            })}
          </nav>

          <div className="vector-board-toolbar-actions">
            <div className="vector-board-scope" role="group" aria-label="Session scope">
              <button
                type="button"
                className={clsx("vector-board-scope-btn", sessionScope === "current" && "is-active")}
                onClick={() => {
                  setSessionScope("current");
                  setSelectedDate(null);
                }}
              >
                Current
              </button>
              <button
                type="button"
                className={clsx("vector-board-scope-btn", sessionScope === "all" && "is-active")}
                onClick={() => setSessionScope("all")}
              >
                All sessions
              </button>
            </div>

            <div className="vector-board-search">
              <span className="vector-board-search-icon" aria-hidden>
                ⌕
              </span>
              <input
                value={tickerQuery}
                onChange={(e) => setTickerQuery(e.target.value.toUpperCase())}
                placeholder="Search ticker"
                className="vector-board-search-input"
                aria-label="Search ticker"
              />
              {tickerQuery ? (
                <button
                  type="button"
                  className="vector-board-search-clear"
                  onClick={() => setTickerQuery("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {coverage || data?.note ? (
          <div className="vector-board-toolbar-meta">
            {coverage ? (
              <span className="vector-board-meta-stat tabular-nums">
                <strong>{coverage.winners}</strong> winner{coverage.winners === 1 ? "" : "s"} ·{" "}
                <strong>{runners.length}</strong> runner{runners.length === 1 ? "" : "s"} ·{" "}
                <strong>{coverage.leaders}</strong> live · <strong>{coverage.closed}</strong> closed
              </span>
            ) : null}
            {data?.note ? <p className="vector-board-note">{data.note}</p> : null}
          </div>
        ) : null}
      </header>

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
                description={
                  tab === "winner"
                    ? "Winners are +50% vs pick (or peak) from the universe sweep."
                    : tab === "runner"
                      ? "Runners are live names between +15% and +49% premium vs pick entry."
                      : tab === "live"
                        ? "Every Vector universe ticker is evaluated every ~2 min during RTH."
                        : "Try All sessions or clear filters."
                }
              />
            </div>
          ) : (
            <div className="vector-board-tablewrap">
              <table className="vector-board-table">
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Status</th>
                    <th className="vector-board-col-num">Premium</th>
                    <th className="vector-board-col-num">Entry → mark</th>
                    <th className="vector-board-col-num">Peak</th>
                    <th className="vector-board-col-num">Of peak</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="vector-board-summary-row">
                    <td colSpan={2}>
                      <span className="vector-board-summary-label">Summary</span>
                      <span className="vector-board-summary-sub tabular-nums">{summary.total} picks</span>
                    </td>
                    <td className={clsx("vector-board-col-num vector-board-pnl tabular-nums", pnlClass(summary.avgPct))}>
                      {summary.avgPct != null ? `${summary.avgPct >= 0 ? "+" : ""}${summary.avgPct}%` : EM}
                    </td>
                    <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                      <strong>{summary.open}</strong> open
                    </td>
                    <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                      <strong>{summary.winners}</strong> winners
                    </td>
                    <td className="vector-board-col-num vector-board-summary-metric tabular-nums">
                      <strong>{summary.closed}</strong> closed
                    </td>
                    <td />
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
                          <div className="vector-board-pick-id">ID: {row.occ.slice(-8)}</div>
                        </td>
                        <td>
                          <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
                        </td>
                        <td className={clsx("vector-board-col-num vector-board-pnl tabular-nums", pnlClass(row.premiumPct))}>
                          {formatPremiumPct(row.premiumPct)}
                        </td>
                        <td className="vector-board-col-num vector-board-mid tabular-nums">
                          {fmtPrice(row.entryMid)} → {fmtPrice(row.markMid)}
                        </td>
                        <td className={clsx("vector-board-col-num tabular-nums", pnlClass(row.peakPct))}>
                          {formatPremiumPct(row.peakPct)}
                        </td>
                        <td className="vector-board-col-num">
                          {row.progressPct != null ? (
                            <div className="vector-board-progress" title={`${row.progressPct}% of peak`}>
                              <div className="vector-board-progress-track">
                                <div
                                  className={clsx("vector-board-progress-fill", pnlClass(row.premiumPct))}
                                  style={{ width: `${row.progressPct}%` }}
                                />
                              </div>
                              <span className="vector-board-progress-label tabular-nums">{row.progressPct}%</span>
                            </div>
                          ) : (
                            <span className="vector-board-em">{EM}</span>
                          )}
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

        <VectorPlayDetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
      </div>
    </div>
  );
}
