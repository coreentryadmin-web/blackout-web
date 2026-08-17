"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import type {
  MeridianEventDetail,
  MeridianEventKind,
  MeridianTickerLookup,
  MeridianTimelineItem,
  MeridianTimelinePayload,
} from "@/features/meridian/lib/meridian-types";
import {
  filterMeridianTimelineItems,
  isTickerLikeQuery,
  normalizeMeridianSearchQuery,
} from "@/features/meridian/lib/meridian-search-core";
import { useWatchlist } from "@/hooks/useWatchlist";
import { MeridianEventDetailPanel } from "./MeridianEventDetailPanel";
import { MeridianHero } from "./MeridianHero";
import {
  MeridianFilterPill,
  MeridianStatCard,
  MeridianTimelineRow,
  MeridianEmpty,
  MeridianShimmer,
} from "./meridian-ui";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    }
    return res.json();
  });

type FilterKind = "all" | MeridianEventKind | "watchlist" | "board";
type DeskView = "timeline" | "analytics";

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
  const [view, setView] = useState<DeskView>("timeline");
  const [searchQuery, setSearchQuery] = useState("");

  const kindFilteredItems = useMemo(() => {
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

  const filteredItems = useMemo(
    () => filterMeridianTimelineItems(kindFilteredItems, searchQuery),
    [kindFilteredItems, searchQuery]
  );

  const normalizedSearch = normalizeMeridianSearchQuery(searchQuery);
  const shouldLookup =
    normalizedSearch.length > 0 &&
    isTickerLikeQuery(normalizedSearch) &&
    filteredItems.length === 0;

  const timelineIdCsv = useMemo(() => allItems.map((i) => i.id).join(","), [allItems]);
  const lookupKey = shouldLookup
    ? `/api/market/meridian/lookup?ticker=${encodeURIComponent(normalizedSearch)}&timeline_ids=${encodeURIComponent(timelineIdCsv)}`
    : null;

  const { data: lookup, isLoading: lookupLoading } = useSWR<MeridianTickerLookup>(lookupKey, fetcher, {
    revalidateOnFocus: false,
  });

  const activeId = selectedId ?? filteredItems[0]?.id ?? null;

  const lookupTimelineItem = useMemo((): MeridianTimelineItem | null => {
    if (!lookup?.found || !lookup.timeline_id || !lookup.earnings) return null;
    const e = lookup.earnings;
    return {
      id: lookup.timeline_id,
      kind: "earnings",
      title: `${lookup.ticker} earnings`,
      subtitle: e.company_name,
      date: e.date,
      time: e.when === "premarket" ? "08:00" : e.when === "afterhours" ? "16:20" : e.time,
      impact: "high",
      days_until: e.days_until,
      ticker: lookup.ticker,
    };
  }, [lookup]);

  const activeItem =
    filteredItems.find((i) => i.id === activeId) ??
    allItems.find((i) => i.id === activeId) ??
    (activeId && lookupTimelineItem?.id === activeId ? lookupTimelineItem : null);

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
  const filters: { id: FilterKind; label: string; count?: number; tone?: string }[] = [
    { id: "all", label: "All", count: stats?.total },
    { id: "macro", label: "Macro", count: stats?.macro, tone: "meridian-theme-macro" },
    { id: "earnings", label: "Earnings", count: stats?.earnings, tone: "meridian-theme-earnings" },
    { id: "fda", label: "FDA", count: stats?.fda, tone: "meridian-theme-fda" },
    { id: "opex", label: "OpEx", count: stats?.opex, tone: "meridian-theme-opex" },
    { id: "watchlist", label: "Watchlist" },
    { id: "board", label: "Board", count: data?.board_tickers?.length },
  ];

  const highImpact = allItems.filter((i) => i.impact === "high").slice(0, 6);

  return (
    <div className="meridian-desk meridian-desk-v2">
      <MeridianHero
        catalystCount={stats?.total}
        next24h={stats?.next_24h}
        asOf={data?.as_of}
      />

      {stats && (
        <div className="meridian-stats-strip" aria-label="Timeline summary">
          <MeridianStatCard value={stats.total} label="Catalysts" tone="cyan" delay={0} />
          <MeridianStatCard value={stats.high_impact} label="High impact" tone="amber" delay={60} />
          <MeridianStatCard value={stats.next_24h} label="Next 24h" tone="violet" delay={120} />
          <MeridianStatCard
            value={data?.board_tickers?.length ?? 0}
            label="Board names"
            tone="emerald"
            delay={180}
          />
        </div>
      )}

      <div className="meridian-view-nav" role="tablist" aria-label="Desk view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "timeline"}
          className={`meridian-view-tab${view === "timeline" ? " is-active" : ""}`}
          onClick={() => setView("timeline")}
        >
          Timeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "analytics"}
          className={`meridian-view-tab${view === "analytics" ? " is-active" : ""}`}
          onClick={() => setView("analytics")}
        >
          Analytics grid
        </button>
        <button type="button" className="meridian-refresh-btn" onClick={() => mutate()}>
          Refresh
        </button>
      </div>

      {view === "analytics" && (
        <section className="meridian-analytics-grid" aria-label="High impact catalyst grid">
          {isLoading && <MeridianShimmer lines={4} />}
          {!isLoading && highImpact.length === 0 && (
            <MeridianEmpty message="No high-impact catalysts in the current window." />
          )}
          {highImpact.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`meridian-analytics-card meridian-theme-${item.kind}${item.id === activeId ? " is-active" : ""}`}
              style={{ animationDelay: `${i * 70}ms` }}
              onClick={() => {
                setSelectedId(item.id);
                setView("timeline");
              }}
            >
              <span className="meridian-analytics-card-kind">{item.kind}</span>
              <span className="meridian-analytics-card-title">{item.title}</span>
              <span className="meridian-analytics-card-meta">
                {item.days_until === 0 ? "Today" : `${item.days_until}d`} · {item.date}
              </span>
            </button>
          ))}
        </section>
      )}

      <div className={`meridian-desk-body${view === "analytics" ? " meridian-desk-body-compact" : ""}`}>
        <aside className="meridian-rail meridian-rail-v2" aria-label="Catalyst timeline">
          <div className="meridian-rail-head">
            <h2 className="meridian-rail-title">Catalyst lane</h2>
            <label className="meridian-search-wrap">
              <span className="sr-only">Search catalysts by ticker or name</span>
              <input
                type="search"
                className="meridian-search-input"
                placeholder="Search ticker or name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="meridian-search-clear"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery("")}
                >
                  ×
                </button>
              )}
            </label>
            {normalizedSearch && filteredItems.length > 0 && (
              <p className="meridian-search-meta">{filteredItems.length} match{filteredItems.length === 1 ? "" : "es"}</p>
            )}
          </div>

          <div className="meridian-filter-row" role="tablist" aria-label="Filter catalysts">
            {filters.map((f) => (
              <MeridianFilterPill
                key={f.id}
                id={f.id}
                label={f.label}
                count={f.count}
                tone={f.tone}
                active={filter === f.id}
                onClick={() => setFilter(f.id)}
              />
            ))}
          </div>

          {isLoading && <MeridianShimmer lines={5} />}
          {error && !isLoading && <MeridianEmpty message="Timeline unavailable — try refresh." />}
          {!isLoading && !error && filteredItems.length === 0 && (
            <div className="meridian-search-empty">
              <MeridianEmpty
                message={
                  normalizedSearch
                    ? `No catalysts match “${searchQuery.trim()}”.`
                    : "No catalysts match this filter."
                }
              />
              {shouldLookup && lookupLoading && <MeridianShimmer lines={2} />}
              {shouldLookup && !lookupLoading && lookup?.found && lookup.timeline_id && (
                <button
                  type="button"
                  className="meridian-lookup-card"
                  onClick={() => {
                    setSelectedId(lookup.timeline_id);
                    if (lookup.in_timeline) return;
                    setSearchQuery("");
                    setFilter("all");
                  }}
                >
                  <span className="meridian-lookup-kicker">Earnings lookup</span>
                  <span className="meridian-lookup-title">
                    {lookup.ticker}
                    {lookup.earnings?.company_name ? ` · ${lookup.earnings.company_name}` : ""}
                  </span>
                  <span className="meridian-lookup-meta">
                    {lookup.earnings?.days_until === 0
                      ? "Today"
                      : `${lookup.earnings?.days_until}d`}{" "}
                    · {lookup.earnings?.date}
                    {lookup.earnings?.status_label ? ` · ${lookup.earnings.status_label}` : ""}
                    {lookup.earnings?.estimated_eps != null
                      ? ` · Est EPS ${lookup.earnings.estimated_eps}`
                      : ""}
                  </span>
                  <span className="meridian-lookup-action">
                    {lookup.in_timeline ? "Jump to row →" : "Open earnings brief →"}
                  </span>
                </button>
              )}
              {shouldLookup && !lookupLoading && lookup && !lookup.found && (
                <p className="meridian-lookup-miss">{lookup.message}</p>
              )}
            </div>
          )}

          {grouped.map(([month, rows]) => (
            <div key={month} className="meridian-month-block">
              <p className="meridian-month-label">{month}</p>
              <ul className="meridian-timeline-list">
                {rows.map((item, index) => (
                  <MeridianTimelineRow
                    key={item.id}
                    item={item}
                    active={item.id === activeId}
                    onBoard={Boolean(item.ticker && boardSet.has(item.ticker))}
                    index={index}
                    onSelect={() => setSelectedId(item.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="meridian-main meridian-main-v2">
          {activeItem ? (
            <MeridianEventDetailPanel
              item={activeItem}
              detail={detail ?? null}
              loading={detailLoading}
              error={detailError ? String(detailError.message) : null}
              boardTickers={data?.board_tickers ?? []}
            />
          ) : (
            <MeridianEmpty message="Select a catalyst to open the structure brief." />
          )}
        </div>
      </div>
    </div>
  );
}

export { fmtPct };
