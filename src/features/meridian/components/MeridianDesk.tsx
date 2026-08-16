"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import type {
  MeridianEventDetail,
  MeridianEventKind,
  MeridianTimelinePayload,
} from "@/features/meridian/lib/meridian-types";
import { useWatchlist } from "@/hooks/useWatchlist";
import { MeridianEventDetailPanel } from "./MeridianEventDetailPanel";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    }
    return res.json();
  });

type FilterKind = "all" | MeridianEventKind | "watchlist" | "board";

function kindBadge(kind: string): string {
  if (kind === "macro") return "Macro";
  if (kind === "opex") return "OpEx";
  if (kind === "fda") return "FDA";
  return "Earnings";
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function MeridianDesk() {
  const { data, error, isLoading, mutate } = useSWR<MeridianTimelinePayload>(
    "/api/market/meridian/timeline?days=21",
    fetcher,
    { refreshInterval: 120_000 }
  );

  const { watchlistSet, ready: watchlistReady } = useWatchlist();
  const boardSet = useMemo(() => new Set(data?.board_tickers ?? []), [data?.board_tickers]);

  const allItems = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");

  const filteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    if (filter === "watchlist") {
      if (!watchlistReady) return allItems;
      return allItems.filter((i) => i.ticker && watchlistSet.has(i.ticker.toUpperCase()));
    }
    if (filter === "board") {
      return allItems.filter((i) => i.ticker && boardSet.has(i.ticker.toUpperCase()));
    }
    return allItems.filter((i) => i.kind === filter);
  }, [allItems, filter, watchlistReady, watchlistSet, boardSet]);

  const activeId = selectedId ?? filteredItems[0]?.id ?? null;
  const activeItem = filteredItems.find((i) => i.id === activeId) ?? allItems.find((i) => i.id === activeId) ?? null;

  const detailKey = activeId ? `/api/market/meridian/event?id=${encodeURIComponent(activeId)}` : null;
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
  } = useSWR<MeridianEventDetail>(detailKey, fetcher, { refreshInterval: 60_000 });

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filteredItems>();
    for (const item of filteredItems) {
      const month = item.date.slice(0, 7);
      const list = map.get(month) ?? [];
      list.push(item);
      map.set(month, list);
    }
    return [...map.entries()];
  }, [filteredItems]);

  const stats = data?.stats;
  const filters: { id: FilterKind; label: string; count?: number }[] = [
    { id: "all", label: "All", count: stats?.total },
    { id: "macro", label: "Macro", count: stats?.macro },
    { id: "earnings", label: "Earnings", count: stats?.earnings },
    { id: "fda", label: "FDA", count: stats?.fda },
    { id: "opex", label: "OpEx", count: stats?.opex },
    { id: "watchlist", label: "Watchlist" },
    { id: "board", label: "Board", count: data?.board_tickers?.length },
  ];

  return (
    <div className="meridian-desk">
      {stats && (
        <div className="meridian-stats-bar" aria-label="Timeline summary">
          <div className="meridian-stat">
            <span className="meridian-stat-value">{stats.total}</span>
            <span className="meridian-stat-label">Catalysts</span>
          </div>
          <div className="meridian-stat">
            <span className="meridian-stat-value">{stats.high_impact}</span>
            <span className="meridian-stat-label">High impact</span>
          </div>
          <div className="meridian-stat">
            <span className="meridian-stat-value">{stats.next_24h}</span>
            <span className="meridian-stat-label">Next 24h</span>
          </div>
          <div className="meridian-stat meridian-stat-wide">
            <span className="meridian-stat-value">{data?.board_tickers?.length ?? 0}</span>
            <span className="meridian-stat-label">Night Hawk board names</span>
          </div>
        </div>
      )}

      <div className="meridian-desk-body">
        <aside className="meridian-rail" aria-label="Catalyst timeline">
          <div className="meridian-rail-head">
            <h2 className="meridian-rail-title">Catalyst timeline</h2>
            <button type="button" className="meridian-refresh" onClick={() => mutate()}>
              Refresh
            </button>
          </div>

          <div className="meridian-filter-row" role="tablist" aria-label="Filter catalysts">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`meridian-filter-chip${filter === f.id ? " is-active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.count != null ? ` · ${f.count}` : ""}
              </button>
            ))}
          </div>

          {isLoading && <p className="meridian-rail-empty">Loading timeline…</p>}
          {error && !isLoading && (
            <p className="meridian-rail-empty">Timeline unavailable — try refresh.</p>
          )}
          {!isLoading && !error && filteredItems.length === 0 && (
            <p className="meridian-rail-empty">No catalysts match this filter.</p>
          )}

          {grouped.map(([month, rows]) => (
            <div key={month} className="meridian-month">
              <p className="meridian-month-label">{month}</p>
              <ul className="meridian-list">
                {rows.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`meridian-row${item.id === activeId ? " is-active" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="meridian-row-top">
                        <span className={`meridian-row-kind meridian-kind-${item.kind}`}>
                          {kindBadge(item.kind)}
                        </span>
                        <span className={`meridian-row-impact impact-${item.impact}`}>
                          {item.impact === "high" ? "High" : item.impact === "medium" ? "Med" : "Low"}
                        </span>
                        <span className="meridian-row-days">
                          {item.days_until === 0 ? "Today" : `${item.days_until}d`}
                        </span>
                      </span>
                      <span className="meridian-row-title">{item.title}</span>
                      <span className="meridian-row-meta">
                        {item.date}
                        {item.time ? ` · ${item.time} ET` : ""}
                        {item.ticker && boardSet.has(item.ticker) ? " · board" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="meridian-main">
          {activeItem ? (
            <MeridianEventDetailPanel
              item={activeItem}
              detail={detail ?? null}
              loading={detailLoading}
              error={detailError ? String(detailError.message) : null}
              boardTickers={data?.board_tickers ?? []}
            />
          ) : (
            <p className="meridian-detail-empty">Select a catalyst to see structure context.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export { fmtPct };
