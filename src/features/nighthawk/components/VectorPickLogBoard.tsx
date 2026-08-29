"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Badge, EmptyState, Panel, Skeleton } from "@/components/ui";
import { etDateTimeShort } from "@/lib/et-clock";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import type {
  VectorClosureReasonFilter,
  VectorClosureSort,
} from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import {
  filterVectorClosureRows,
  filterVectorRunnerLeaders,
  formatPremiumPct,
  preferredVectorBoardSection,
  premiumPctTone,
  sortVectorClosureRows,
} from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type {
  VectorClosurePlay,
  VectorLeaderPlay,
  VectorPickBoardResponse,
} from "@/features/nighthawk/components/VectorPickLogBoard.types";

type BoardSection = "winners" | "runners" | "leaders" | "closed";

async function fetchVectorBoard(url: string): Promise<VectorPickBoardResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`vector board fetch failed: ${res.status}`);
  return res.json();
}

function fmtPrice(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return etDateTimeShort(d) ?? "—";
}

function leaderPct(row: VectorLeaderPlay): number | null {
  return row.premium_pct_from_entry ?? row.peak_premium_pct;
}

function statusBadge(status: string, isWinner: boolean) {
  if (isWinner) return <Badge tone="bull">Winner</Badge>;
  if (status === "still_buy") return <Badge tone="bull">Still buy</Badge>;
  if (status === "caution") return <Badge tone="accent">Caution</Badge>;
  return <Badge tone="bear">Closed</Badge>;
}

function LeaderCard({ row }: { row: VectorLeaderPlay }) {
  const pct = leaderPct(row);
  return (
    <Panel className="vector-leader-row shrink-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{row.ticker}</span>
            {statusBadge(row.action_status, row.is_winner)}
            {row.tier === "elite" ? <Badge tone="accent">Elite</Badge> : null}
            {row.setup_invalidated ? <Badge tone="accent">Thesis stressed</Badge> : null}
          </div>
          <p className="mt-1 text-sm font-bold text-sky-100">
            {row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`}
            {row.rank != null ? ` · rank #${row.rank}` : ""}
          </p>
          <p className="mt-1 text-xs leading-snug text-sky-200">{row.action_reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <div className="text-xs text-sky-200">{fmtTimestamp(row.updated_at)}</div>
          <Badge tone={premiumPctTone(pct)} size="md">
            {formatPremiumPct(pct) === "—" ? "No %" : `${formatPremiumPct(pct)} premium`}
          </Badge>
          <div className="text-xs font-bold text-white">
            {fmtPrice(row.entry_mid)} → {fmtPrice(row.live_mid)}
          </div>
          {row.peak_premium_pct != null &&
          row.premium_pct_from_entry != null &&
          row.peak_premium_pct > row.premium_pct_from_entry ? (
            <div className="text-[11px] font-bold text-sky-300">Peak {formatPremiumPct(row.peak_premium_pct)}</div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function ClosureCard({ row }: { row: VectorClosurePlay }) {
  const pct = row.premium_pct_from_entry;
  return (
    <Panel className="vector-closure-row shrink-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{row.ticker}</span>
            <Badge tone="bear">Don&apos;t buy</Badge>
            {row.setup_invalidated ? <Badge tone="accent">Setup invalidated</Badge> : null}
          </div>
          <p className="mt-1 text-sm font-bold text-sky-100">
            {row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`}
            {row.rank != null ? ` · rank #${row.rank}` : ""}
          </p>
          <p className="mt-1 text-xs leading-snug text-sky-200">{row.close_reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <div className="text-xs text-sky-200">{fmtTimestamp(row.closed_at)}</div>
          <Badge tone={premiumPctTone(pct)} size="md">
            {formatPremiumPct(pct) === "—" ? "No %" : `${formatPremiumPct(pct)} premium`}
          </Badge>
          <div className="text-xs font-bold text-white">
            {fmtPrice(row.entry_mid)} → {fmtPrice(row.close_mid)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

const REASON_OPTIONS: { id: VectorClosureReasonFilter; label: string }[] = [
  { id: "all", label: "All reasons" },
  { id: "setup_invalidated", label: "Setup invalidated" },
  { id: "premium_chase", label: "Premium chase" },
  { id: "premium_cap", label: "Desk cap" },
  { id: "other", label: "Other" },
];

const SORT_OPTIONS: { id: VectorClosureSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "pct_desc", label: "% high → low" },
  { id: "pct_asc", label: "% low → high" },
  { id: "ticker", label: "Ticker A→Z" },
];

/**
 * Night Hawk Vector tab — universe sweep winners/leaders + closed contract picks.
 */
export function VectorPickLogBoard() {
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [sessionFilter, setSessionFilter] = useState<"today" | "all">("today");
  const [section, setSection] = useState<BoardSection>("winners");
  const sectionUserPicked = useRef(false);
  const [reasonFilter, setReasonFilter] = useState<VectorClosureReasonFilter>("all");
  const [sort, setSort] = useState<VectorClosureSort>("pct_desc");
  const [tickerQuery, setTickerQuery] = useState("");

  const apiUrl =
    sessionFilter === "today" && todaySession
      ? `/api/market/vector/pick-closures/board?limit=500&session_date=${todaySession}`
      : "/api/market/vector/pick-closures/board?limit=500";

  const { data, error, isLoading } = useSWR<VectorPickBoardResponse>(apiUrl, fetchVectorBoard, {
    refreshInterval: 30_000,
  });

  const winners = data?.winners ?? [];
  const leaders = data?.leaders ?? [];
  const closed = data?.closed ?? [];

  const filteredRunners = useMemo(() => {
    const q = tickerQuery.trim().toUpperCase();
    const runners = filterVectorRunnerLeaders(leaders);
    if (!q) return runners;
    return runners.filter((r) => r.ticker.toUpperCase().includes(q));
  }, [leaders, tickerQuery]);

  useEffect(() => {
    if (sectionUserPicked.current || !data) return;
    const next = preferredVectorBoardSection(winners.length, filteredRunners.length, leaders.length);
    setSection((cur) => (cur === next ? cur : next));
  }, [data, winners.length, filteredRunners.length, leaders.length]);

  const filteredClosed = useMemo(() => {
    const filtered = filterVectorClosureRows(closed, {
      sessionDate: sessionFilter === "today" ? todaySession : null,
      reason: reasonFilter,
      tickerQuery,
    });
    return sortVectorClosureRows(filtered, sort);
  }, [closed, sessionFilter, todaySession, reasonFilter, tickerQuery, sort]);

  const filteredLeaders = useMemo(() => {
    const q = tickerQuery.trim().toUpperCase();
    if (!q) return leaders;
    return leaders.filter((r) => r.ticker.toUpperCase().includes(q));
  }, [leaders, tickerQuery]);

  const filteredWinners = useMemo(() => {
    const q = tickerQuery.trim().toUpperCase();
    if (!q) return winners;
    return winners.filter((r) => r.ticker.toUpperCase().includes(q));
  }, [winners, tickerQuery]);

  const visibleRows = useMemo(() => {
    if (section === "winners") return filteredWinners;
    if (section === "runners") return filteredRunners;
    if (section === "leaders") return filteredLeaders;
    return filteredClosed;
  }, [section, filteredWinners, filteredRunners, filteredLeaders, filteredClosed]);

  if (isLoading && !data) {
    return (
      <div className="nh-deck-rows min-h-0 flex-1 space-y-2 overflow-y-auto">
        <Skeleton className="h-20 w-full shrink-0" />
        <Skeleton className="h-20 w-full shrink-0" />
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
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <Panel accent="sky" bodyClassName="px-4 py-3 md:px-5 md:py-4 shrink-0">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="sky" size="md" dot>
              Vector plays
            </Badge>
            {coverage ? (
              <span className="text-xs font-bold text-sky-100">
                {coverage.winners} winner{coverage.winners === 1 ? "" : "s"} · {filteredRunners.length} runner
                {filteredRunners.length === 1 ? "" : "s"} · {coverage.leaders} live · {coverage.closed} closed
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-snug text-sky-200">
            {data?.note ??
              "Premium % is option mid vs pick entry. Leaders come from the server universe sweep every ~2 min RTH."}
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["winners", `Winners (${winners.length})`],
                ["runners", `Runners (${filteredRunners.length})`],
                ["leaders", `Live (${leaders.length})`],
                ["closed", `Closed (${closed.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  section === id
                    ? "rounded border border-cyan-400/60 bg-cyan-400/10 px-2 py-1 text-xs font-bold text-white"
                    : "rounded border border-white/10 px-2 py-1 text-xs font-bold text-sky-200"
                }
                onClick={() => {
                  sectionUserPicked.current = true;
                  setSection(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
              Session
              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value as "today" | "all")}
                className="min-h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm font-bold normal-case text-white"
              >
                <option value="today">Today</option>
                <option value="all">All sessions</option>
              </select>
            </label>
            {section === "closed" ? (
              <>
                <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
                  Reason
                  <select
                    value={reasonFilter}
                    onChange={(e) => setReasonFilter(e.target.value as VectorClosureReasonFilter)}
                    className="min-h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm font-bold normal-case text-white"
                  >
                    {REASON_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
                  Sort
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as VectorClosureSort)}
                    className="min-h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm font-bold normal-case text-white"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="flex min-w-[7rem] flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
              Ticker
              <input
                value={tickerQuery}
                onChange={(e) => setTickerQuery(e.target.value.toUpperCase())}
                placeholder="e.g. INTC"
                className="min-h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm font-bold normal-case text-white placeholder:text-sky-300/50"
              />
            </label>
          </div>
        </div>
      </Panel>

      <div className="nh-deck-rows min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {!visibleRows.length ? (
          <EmptyState
            title={
              section === "winners"
                ? "No winning Vector picks yet"
                : section === "runners"
                  ? "No +15% runners yet"
                  : section === "leaders"
                    ? "No live Vector leaders"
                    : "No closed Vector picks match"
            }
            description={
              section === "winners"
                ? "Winners are +50% vs pick (or peak) from the universe sweep — INTC-class runners land here after deploy."
                : section === "runners"
                  ? "Runners are live names between +15% and +49% premium vs pick entry — the building phase before the +50% winner floor."
                  : section === "leaders"
                    ? "Every Vector universe ticker is evaluated every ~2 min during RTH."
                    : "Try All sessions or clear filters."
            }
          />
        ) : (
          visibleRows.map((row) =>
            section === "closed" ? (
              <ClosureCard key={`c-${row.id}`} row={row as VectorClosurePlay} />
            ) : (
              <LeaderCard
                key={`${(row as VectorLeaderPlay).closed_winner ? "cw" : "l"}-${row.id}-${(row as VectorLeaderPlay).contract.occ}`}
                row={row as VectorLeaderPlay}
              />
            )
          )
        )}
      </div>
    </div>
  );
}
