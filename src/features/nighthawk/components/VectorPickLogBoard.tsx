"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Badge, EmptyState, Panel, Skeleton } from "@/components/ui";
import { etDateTimeShort } from "@/lib/et-clock";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
<<<<<<< HEAD
import type {
  VectorClosureReasonFilter,
  VectorClosureSort,
} from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import {
  filterVectorClosureRows,
  formatPremiumPct,
  premiumPctTone,
  sortVectorClosureRows,
} from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import type { VectorPickClosuresResponse } from "@/features/nighthawk/components/VectorPickLogBoard.types";
=======

type VectorContractRef = {
  occ: string;
  side: string;
  strike: number;
  expiry: string;
  label: string | null;
};

type VectorLeaderRow = {
  id: number;
  ticker: string;
  session_date: string;
  contract: VectorContractRef;
  rank: number | null;
  role: string | null;
  entry_mid: number | null;
  live_mid: number | null;
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: string;
  action_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  updated_at: string;
  is_winner: boolean;
};

type VectorClosureRow = {
  id: number;
  ticker: string;
  session_date: string;
  contract: VectorContractRef;
  rank: number | null;
  role: string | null;
  entry_mid: number | null;
  close_mid: number | null;
  premium_pct_from_entry: number | null;
  close_reason: string;
  setup_invalidated: boolean;
  closed_at: string;
};

type VectorPickBoardResponse = {
  available: boolean;
  degraded?: boolean;
  session_date?: string;
  coverage?: { leaders: number; winners: number; closed: number; note?: string };
  leaders?: VectorLeaderRow[];
  winners?: VectorLeaderRow[];
  closed?: VectorClosureRow[];
};
>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)

type SessionFilter = "today" | "all";
type BoardSection = "winners" | "leaders" | "closed";

async function fetchVectorBoard(url: string): Promise<VectorPickBoardResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`vector board fetch failed: ${res.status}`);
  return res.json();
}

function fmtPrice(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
}

<<<<<<< HEAD
=======
function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}

function premiumTone(pct: number | null): "bull" | "bear" | "neutral" {
  if (pct == null || !Number.isFinite(pct)) return "neutral";
  if (pct >= 15) return "bull";
  if (pct <= -15) return "bear";
  return "neutral";
}

>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)
function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return etDateTimeShort(d) ?? "—";
}

<<<<<<< HEAD
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
=======
function statusBadge(status: string, isWinner: boolean) {
  if (isWinner) return <Badge tone="bull">Winner</Badge>;
  if (status === "still_buy") return <Badge tone="bull">Still buy</Badge>;
  if (status === "caution") return <Badge tone="accent">Caution</Badge>;
  return <Badge tone="bear">Closed</Badge>;
}

function LeaderCard({ row }: { row: VectorLeaderRow }) {
  const pct = row.premium_pct_from_entry ?? row.peak_premium_pct;
  return (
    <Panel className="vector-leader-row shrink-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{row.ticker}</span>
            {statusBadge(row.action_status, row.is_winner)}
            {row.setup_invalidated ? <Badge tone="accent">Thesis stressed</Badge> : null}
          </div>
          <p className="mt-1 text-sm font-bold text-sky-100">
            {row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`}
            {row.rank != null ? ` · rank #${row.rank}` : ""}
          </p>
          <p className="mt-1 text-xs leading-snug text-sky-200">{row.action_reason}</p>
        </div>
        <div className="text-right">
          <Badge tone={premiumTone(pct)} className="text-sm font-bold">
            {fmtPct(pct)} vs pick
          </Badge>
          <div className="mt-2 text-xs text-sky-200">
            <div>{fmtTimestamp(row.updated_at)}</div>
            <div className="mt-1 font-bold text-white">
              {fmtPrice(row.entry_mid)} → {fmtPrice(row.live_mid)}
            </div>
            {row.peak_premium_pct != null &&
            row.premium_pct_from_entry != null &&
            row.peak_premium_pct > row.premium_pct_from_entry ? (
              <div>Peak {fmtPct(row.peak_premium_pct)}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ClosureCard({ row }: { row: VectorClosureRow }) {
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
        <div className="text-right">
          <Badge tone={premiumTone(pct)} className="text-sm font-bold">
            {fmtPct(pct)} vs pick
          </Badge>
          <div className="mt-2 text-xs text-sky-200">
            <div>{fmtTimestamp(row.closed_at)}</div>
            <div className="mt-1 font-bold text-white">
              {fmtPrice(row.entry_mid)} → {fmtPrice(row.close_mid)}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)

/**
 * Night Hawk Vector tab — universe sweep leaders (winning plays) + closed contract picks.
 */
export function VectorPickLogBoard() {
<<<<<<< HEAD
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [sessionFilter, setSessionFilter] = useState<"today" | "all">("today");
  const [reasonFilter, setReasonFilter] = useState<VectorClosureReasonFilter>("all");
  const [sort, setSort] = useState<VectorClosureSort>("newest");
  const [tickerQuery, setTickerQuery] = useState("");

  const apiUrl =
    sessionFilter === "today" && todaySession
      ? `/api/market/vector/pick-closures/board?limit=500&session_date=${todaySession}`
      : "/api/market/vector/pick-closures/board?limit=500";

  const { data, error, isLoading } = useSWR<VectorPickClosuresResponse>(apiUrl, fetchVectorClosures, {
    refreshInterval: 30_000,
  });
=======
  const todaySession = etSessionDate(Date.now());
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("today");
  const [section, setSection] = useState<BoardSection>("winners");
>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)

  const url =
    sessionFilter === "today" && todaySession
      ? `/api/market/vector/pick-closures/board?limit=500&session_date=${todaySession}`
      : "/api/market/vector/pick-closures/board?limit=500";

  const { data, error, isLoading } = useSWR<VectorPickBoardResponse>(url, fetchVectorBoard, {
    refreshInterval: 30_000,
  });

  const winners = data?.winners ?? [];
  const leaders = data?.leaders ?? [];
  const closed = data?.closed ?? [];

<<<<<<< HEAD
  const visible = useMemo(() => {
    const filtered = filterVectorClosureRows(closed, {
      sessionDate: sessionFilter === "today" ? todaySession : null,
      reason: reasonFilter,
      tickerQuery,
    });
    return sortVectorClosureRows(filtered, sort);
  }, [closed, sessionFilter, todaySession, reasonFilter, tickerQuery, sort]);
=======
  const visibleRows = useMemo(() => {
    if (section === "winners") return winners;
    if (section === "leaders") return leaders;
    return closed;
  }, [section, winners, leaders, closed]);
>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)

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

<<<<<<< HEAD
  if (!closed.length) {
    return (
      <EmptyState
        title="No closed Vector picks yet"
        description="When a Vector contract pick goes Don't buy (setup invalidated, premium chase, or desk cap), it is logged here while the Vector desk live-evaluates that ticker."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <Panel accent="sky" bodyClassName="px-4 py-3 md:px-5 md:py-4 shrink-0">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="sky" size="md" dot>
              Vector pick log
            </Badge>
            <span className="text-xs font-bold text-sky-100">
              Showing {visible.length} of {closed.length} closed picks
              {sessionFilter === "today" && todaySession ? ` · ${todaySession}` : ""}
            </span>
          </div>
          <p className="text-xs leading-snug text-sky-200">
            {data?.note ??
              "Premium % is option mid vs pick entry — not Night Hawk 0DTE trade P&L. Rows log the first Don't buy per contract while Vector live quotes run."}
          </p>
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
            <label className="flex min-w-[7rem] flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
              Ticker
              <input
                value={tickerQuery}
                onChange={(e) => setTickerQuery(e.target.value.toUpperCase())}
                placeholder="e.g. SPX"
                className="min-h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm font-bold normal-case text-white placeholder:text-sky-300/50"
              />
            </label>
          </div>
        </div>
      </Panel>

      <div className="nh-deck-rows min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {visible.length === 0 ? (
          <EmptyState
            title="No rows match filters"
            description="Try All sessions or clear the ticker filter."
          />
        ) : (
          visible.map((row) => {
            const pct = row.premium_pct_from_entry;
            const pctLabel = formatPremiumPct(pct);
            return (
              <Panel key={row.id} className="vector-closure-row shrink-0 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{row.ticker}</span>
                      <Badge tone="bear">Closed</Badge>
                      {row.setup_invalidated ? <Badge tone="accent">Setup invalidated</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm font-bold text-sky-100">
                      {row.contract.label ??
                        `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`}
                      {row.rank != null ? ` · rank #${row.rank}` : ""}
                    </p>
                    <p className="mt-1 text-xs leading-snug text-sky-200">{row.close_reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <div className="text-xs text-sky-200">{fmtTimestamp(row.closed_at)}</div>
                    <Badge tone={premiumPctTone(pct)} size="md">
                      {pctLabel === "—" ? "No %" : `${pctLabel} premium`}
                    </Badge>
                    <div className="text-xs font-bold text-white">
                      {fmtPrice(row.entry_mid)} → {fmtPrice(row.close_mid)}
                    </div>
                    <div className="text-[11px] font-bold text-sky-300">vs pick entry mid</div>
                  </div>
                </div>
              </Panel>
            );
          })
        )}
      </div>
=======
  const coverage = data?.coverage;

  return (
    <div className="nh-deck-rows min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
      {coverage ? (
        <p className="px-1 text-xs font-bold leading-snug text-sky-200">
          {coverage.winners} winner{coverage.winners === 1 ? "" : "s"} · {coverage.leaders} live ·{" "}
          {coverage.closed} closed
          {coverage.note ? ` — ${coverage.note}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 px-1">
        {(
          [
            ["winners", `Winners (${winners.length})`],
            ["leaders", `All live (${leaders.length})`],
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
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={
            sessionFilter === "today"
              ? "rounded border border-cyan-400/60 bg-cyan-400/10 px-2 py-1 text-xs font-bold text-white"
              : "rounded border border-white/10 px-2 py-1 text-xs font-bold text-sky-200"
          }
          onClick={() => setSessionFilter((s) => (s === "today" ? "all" : "today"))}
        >
          {sessionFilter === "today" ? "Today" : "All sessions"}
        </button>
      </div>

      {!visibleRows.length ? (
        <EmptyState
          title={
            section === "winners"
              ? "No winning Vector picks yet"
              : section === "leaders"
                ? "No live Vector leaders"
                : "No closed Vector picks"
          }
          description={
            section === "winners"
              ? "Winners are ranked contract picks at +50% vs pick (or peak) from the server universe sweep."
              : section === "leaders"
                ? "The sweep evaluates every Vector universe ticker every ~2 min during RTH."
                : "Don't buy closures log when a pick fails live gates (invalidation, premium chase, desk cap)."
          }
        />
      ) : (
        visibleRows.map((row) =>
          section === "closed" ? (
            <ClosureCard key={`c-${row.id}`} row={row as VectorClosureRow} />
          ) : (
            <LeaderCard key={`l-${row.id}`} row={row as VectorLeaderRow} />
          )
        )
      )}
>>>>>>> 15825842d (feat(vector): universe pick sweep + winners board on Night Hawk)
    </div>
  );
}
