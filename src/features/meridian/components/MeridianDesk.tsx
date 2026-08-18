"use client";

import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MeridianEventDetail,
  MeridianEventKind,
  MeridianTickerLookup,
  MeridianTimelineItem,
  MeridianTimelinePayload,
} from "@/features/meridian/lib/meridian-types";
import { detailRefreshMsFor } from "@/lib/meridian/meridian-viz-core";
import {
  deskUrlSearch,
  parseDeskUrlState,
  sameDeskUrlState,
  type DeskUrlState,
} from "@/features/meridian/lib/meridian-deeplink-core";
import {
  filterMeridianTimelineItems,
  isTickerLikeQuery,
  normalizeMeridianSearchQuery,
} from "@/features/meridian/lib/meridian-search-core";
import { useWatchlist } from "@/hooks/useWatchlist";
import { MeridianEventDetailPanel } from "./MeridianEventDetailPanel";
import { MeridianHero } from "./MeridianHero";
import {
  MeridianEarningsPulse,
  MeridianPrintClock,
  MeridianEarningsCalendar,
  MeridianSurpriseScatter,
  MeridianEarningsTable,
} from "./MeridianEarningsAnalytics";
import {
  MeridianDataCard,
  MeridianFilterPill,
  MeridianStatCard,
  MeridianTimelineRow,
  MeridianEmpty,
  MeridianShimmer,
  MeridianAnalyticsBanner,
} from "./meridian-ui";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    }
    return res.json();
  });

type FilterKind = "all" | MeridianEventKind | "watchlist" | "board" | "mega_cap";
type DeskView = "timeline" | "analytics";

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function MeridianDesk() {
  const { data, error, isLoading, mutate } = useSWR<MeridianTimelinePayload>(
    "/api/market/meridian/timeline?days=21",
    fetcher,
    { refreshInterval: 90_000 }
  );

  const { watchlistSet, ready: watchlistReady } = useWatchlist();
  const boardSet = useMemo(() => new Set(data?.board_tickers ?? []), [data?.board_tickers]);

  const allItems = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [view, setView] = useState<DeskView>("timeline");

  /**
   * URL ⇄ desk state.
   *
   * Read on MOUNT rather than during render: this is a client component inside a server-rendered
   * page, and touching window during render would either break SSR or produce a hydration
   * mismatch on any link that carries state. One frame of default state is the correct trade.
   *
   * The history entry is written with pushState for a change of EVENT (so Back returns to the
   * previous event, which is what a reader who clicked through three names expects) and
   * replaceState for view/filter (which are refinements of the same page, not destinations).
   * Written directly rather than through the router because a router navigation would re-run the
   * page and drop the SWR cache — a URL update must not cost a refetch.
   */
  const urlHydrated = useRef(false);
  const lastUrlState = useRef<DeskUrlState>({ event: null, view: null, filter: null });

  useEffect(() => {
    const apply = (search: string) => {
      const st = parseDeskUrlState(search);
      lastUrlState.current = st;
      setSelectedId(st.event);
      setView((st.view ?? "timeline") as DeskView);
      setFilter((st.filter ?? "all") as FilterKind);
    };
    apply(window.location.search);
    urlHydrated.current = true;
    // Back/forward must move the desk, not just the address bar.
    const onPop = () => apply(window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // Never write a URL before the first read, or the mount would immediately overwrite the
    // state a pasted link just delivered.
    if (!urlHydrated.current) return;
    const next: DeskUrlState = { event: selectedId, view, filter };
    if (sameDeskUrlState(next, lastUrlState.current)) return;
    const eventChanged = next.event !== lastUrlState.current.event;
    lastUrlState.current = next;
    const url = `${window.location.pathname}${deskUrlSearch(next)}`;
    if (eventChanged) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [selectedId, view, filter]);
  const [searchQuery, setSearchQuery] = useState("");
  /** Calendar day drill-down — clicking a day filters the print ledger; clicking it again clears. */
  const [earningsDate, setEarningsDate] = useState<string | null>(null);
  /**
   * "Now" for the print clock, captured ONCE per mount rather than read inside the component.
   *
   * Two reasons. The countdown must be a pure function of props so the panel renders
   * deterministically and can be reasoned about; and calling Date.now() during render would make
   * every parent re-render silently shift every countdown, which reads as flicker on a panel whose
   * whole job is a stable "in 2h 14m".
   */
  const [nowMs] = useState(() => Date.now());

  /**
   * Clicking a ticker in any earnings panel jumps to that name's timeline event.
   *
   * Mirrors what the high-impact catalyst cards below already do, so "click a thing to inspect it"
   * behaves the same everywhere on this view. When the window has no timeline row for that ticker
   * (the analytics window carries a 14-day lookback the timeline does not), the click is a NO-OP
   * rather than a navigation to nothing — silently switching views to an unchanged timeline reads
   * as a broken button.
   */
  const selectEarningsTicker = (ticker: string) => {
    const match = allItems.find(
      (it) => it.kind === "earnings" && (it.ticker ?? "").toUpperCase() === ticker.toUpperCase()
    );
    if (!match) return;
    setSelectedId(match.id);
    setView("timeline");
  };

  const kindFilteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    if (filter === "watchlist") {
      if (!watchlistReady) return allItems;
      return allItems.filter((i) => i.ticker && watchlistSet.has(i.ticker.toUpperCase()));
    }
    if (filter === "board") {
      return allItems.filter((i) => i.ticker && boardSet.has(i.ticker.toUpperCase()));
    }
    if (filter === "mega_cap") {
      return allItems.filter((i) => i.kind === "earnings" && (i.importance ?? 0) >= 4);
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

  /**
   * Poll cadence scaled by how close the print is.
   *
   * The old rule was flat — 15s if this name had printed, 30s if ANY name that week had, 60s
   * otherwise — so an event ten days out was polled almost as hard as one reporting in minutes,
   * and one reporting in minutes no harder than one next week. Both halves are wrong, in
   * opposite directions. Scaling by proximity spends the budget where it changes a decision,
   * and spending LESS on distant names is what makes being aggressive on imminent ones
   * affordable.
   */
  const detailRefreshMs = useMemo(() => {
    if (activeItem?.kind !== "earnings") return 60_000;
    const hours =
      activeItem.days_until != null ? activeItem.days_until * 24 : null;
    return detailRefreshMsFor(hours, Boolean(activeItem.is_printed));
  }, [activeItem]);

  const detailKey = activeId ? `/api/market/meridian/event?id=${encodeURIComponent(activeId)}` : null;
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    mutate: mutateDetail,
  } = useSWR<MeridianEventDetail>(detailKey, fetcher, { refreshInterval: detailRefreshMs });

  /**
   * Refresh refetches the DETAIL as well as the timeline, and says so while it runs.
   *
   * It previously called `mutate()` alone, which revalidates only the left lane — so a reader
   * watching an event panel pressed Refresh and nothing they were looking at changed. With no
   * pending state either, a successful refetch that returned identical cached data was
   * indistinguishable from a dead button. Reported live as "Refresh button is not working".
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([mutate(), detailKey ? mutateDetail() : Promise.resolve(undefined)]);
    } finally {
      setRefreshing(false);
    }
  };

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
    { id: "mega_cap", label: "Imp ≥4", count: stats?.earnings_mega_cap, tone: "meridian-theme-earnings" },
    { id: "fda", label: "FDA", count: stats?.fda, tone: "meridian-theme-fda" },
    { id: "opex", label: "OpEx", count: stats?.opex, tone: "meridian-theme-opex" },
    { id: "watchlist", label: "Watchlist" },
    { id: "board", label: "Board", count: data?.board_tickers?.length },
  ];

  const highImpact = allItems.filter((i) => i.impact === "high").slice(0, 6);

  return (
    <div className="meridian-desk meridian-desk-v2">
      <MeridianHero asOf={data?.as_of} />

      {stats && (
        <div className="meridian-stats-strip" aria-label="Timeline summary">
          <MeridianStatCard value={stats.total} label="Catalysts" tone="cyan" delay={0} />
          <MeridianStatCard value={stats.earnings} label="Earnings" tone="cyan" delay={60} />
          <MeridianStatCard
            value={stats.earnings_mega_cap ?? 0}
            label="Mega-cap ER"
            tone="amber"
            delay={90}
          />
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
        <button
          type="button"
          className={`meridian-refresh-btn${refreshing ? " is-busy" : ""}`}
          onClick={refreshAll}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {view === "analytics" && (
        <>
          {/*
            Earnings analytics block. Mounted ABOVE the catalyst grid because it answers the
            first question a member opens this view with — what prints, when, and how has the
            week actually graded — before the per-event browse below.

            `earnings_analytics_rows` is the FULL window (all importances, plus a 14-day lookback
            so the scatter is not empty every morning); the mega-cap strip further down keeps its
            own curated 24-row imp>=4 dataset. Two datasets on purpose — see the type comment.
          */}
          {(data?.earnings_analytics_rows?.length ?? 0) > 0 && (
            <section className="meridian-earnings-analytics" aria-label="Earnings analytics">
              <MeridianEarningsPulse rows={data!.earnings_analytics_rows} />

              <div className="meridian-mea-split">
                <MeridianDataCard label="Next 24 hours" tone="earnings">
                  <MeridianPrintClock
                    rows={data!.earnings_analytics_rows}
                    /* `nowMs` is owned here, not read inside the component, so the clock stays a
                       pure function of its props and re-renders deterministically. */
                    nowMs={nowMs}
                    onSelectTicker={selectEarningsTicker}
                  />
                </MeridianDataCard>

                <MeridianDataCard label="Surprise map · EPS vs revenue" tone="earnings">
                  <MeridianSurpriseScatter
                    rows={data!.earnings_analytics_rows}
                    onSelectTicker={selectEarningsTicker}
                  />
                </MeridianDataCard>
              </div>

              <MeridianDataCard label="Print calendar" tone="earnings" wide>
                <MeridianEarningsCalendar
                  rows={data!.earnings_analytics_rows}
                  selectedDate={earningsDate}
                  onSelectDate={(d) => setEarningsDate((cur) => (cur === d ? null : d))}
                />
              </MeridianDataCard>

              <MeridianDataCard
                label={earningsDate ? `Prints on ${earningsDate}` : "All prints in window"}
                tone="earnings"
                wide
              >
                <MeridianEarningsTable
                  rows={
                    earningsDate
                      ? data!.earnings_analytics_rows.filter((r) => r.date === earningsDate)
                      : data!.earnings_analytics_rows
                  }
                  onSelectTicker={selectEarningsTicker}
                />
              </MeridianDataCard>
            </section>
          )}

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
          {(data?.earnings_week?.length ?? 0) > 0 && (
            <section className="meridian-earnings-week" aria-label="Mega-cap earnings week">
              <h3 className="meridian-earnings-week-title">Mega-cap earnings week</h3>
              {data?.earnings_week_analytics && (
                <MeridianAnalyticsBanner
                  label="Universe analytics"
                  headline={data.earnings_week_analytics.headline}
                  sub={
                    data.earnings_week_analytics.eps_beat_rate != null
                      ? `${data.earnings_week_analytics.printed_this_week}/${data.earnings_week_analytics.names_count} printed · rev beat ${data.earnings_week_analytics.revenue_beat_rate != null ? Math.round(data.earnings_week_analytics.revenue_beat_rate * 100) : "—"}%`
                      : `${data.earnings_week_analytics.printed_this_week}/${data.earnings_week_analytics.names_count} printed`
                  }
                  tone="earnings"
                  icon="▣"
                />
              )}
              <div className="meridian-analytics-grid">
                {data!.earnings_week.map((row, i) => (
                  <button
                    key={`${row.ticker}-${row.date}`}
                    type="button"
                    className={`meridian-analytics-card meridian-theme-earnings${row.is_printed ? " is-printed" : ""}`}
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => {
                      setSelectedId(`earnings:${row.ticker}:${row.date}`);
                      setView("timeline");
                      setFilter("earnings");
                    }}
                  >
                    <span className="meridian-analytics-card-kind">imp {row.importance ?? "—"}</span>
                    <span className="meridian-analytics-card-title">
                      {row.ticker}
                      {row.company_name ? ` · ${row.company_name}` : ""}
                    </span>
                    <span className="meridian-analytics-card-meta">
                      {row.date}
                      {row.time_et ? ` · ${row.time_et} ET` : ""}
                      {row.estimated_eps != null ? ` · est ${row.estimated_eps}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {(data?.estimate_revision_timeline?.length ?? 0) > 0 && (
            <section className="meridian-earnings-revisions" aria-label="Estimate revision timeline">
              <h3 className="meridian-earnings-week-title">Estimate revisions (36h)</h3>
              <ul className="meridian-card-list meridian-revisions-list">
                {data!.estimate_revision_timeline.slice(0, 10).map((r) => (
                  <li key={`${r.ticker}-${r.last_updated}-${r.change_kind}`}>
                    <button
                      type="button"
                      className="meridian-revision-link"
                      onClick={() => {
                        setSelectedId(`earnings:${r.ticker}:${r.date}`);
                        setView("timeline");
                        setFilter("earnings");
                      }}
                    >
                      {r.headline}
                      {r.eps_delta != null ? ` · EPS Δ ${r.eps_delta >= 0 ? "+" : ""}${r.eps_delta}` : ""}
                      {r.revenue_delta_pct != null
                        ? ` · Rev ${r.revenue_delta_pct >= 0 ? "+" : ""}${r.revenue_delta_pct}%`
                        : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(data?.recent_earnings_revisions?.length ?? 0) > 0 && (
            <section className="meridian-earnings-revisions" aria-label="Recent calendar revisions">
              <h3 className="meridian-earnings-week-title">Calendar updates (36h)</h3>
              <ul className="meridian-card-list meridian-revisions-list">
                {data!.recent_earnings_revisions.slice(0, 8).map((r) => (
                  <li key={`${r.ticker}-${r.last_updated}`}>
                    <button
                      type="button"
                      className="meridian-revision-link"
                      onClick={() => {
                        setSelectedId(`earnings:${r.ticker}:${r.date}`);
                        setView("timeline");
                        setFilter("earnings");
                      }}
                    >
                      {r.headline}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(data?.after_hours_movers?.length ?? 0) > 0 && (
            <section className="meridian-earnings-revisions" aria-label="After-hours movers">
              <h3 className="meridian-earnings-week-title">After-hours movers</h3>
              <ul className="meridian-card-list meridian-revisions-list">
                {data!.after_hours_movers.slice(0, 8).map((m) => (
                  <li key={`${m.title}-${m.published ?? ""}`}>
                    {m.title}
                    {m.channel ? ` · ${m.channel}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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

          {/* Say that the lane filtered. A quietly shorter list is indistinguishable from a
              quietly broken feed, and the two need different reactions from the reader. Only
              shown when the filter actually RAN — "0 hidden" and "did not run" are different
              facts and must not render identically. */}
          {data?.optionable_filter_applied && (data.non_optionable_hidden ?? 0) > 0 && (
            <p className="meridian-lane-note">
              {data.non_optionable_hidden} print{data.non_optionable_hidden === 1 ? "" : "s"} hidden — no listed options
            </p>
          )}

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
              allItems={allItems}
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
