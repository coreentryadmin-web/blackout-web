"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import type { MeridianEventDetail, MeridianTimelinePayload } from "@/features/meridian/lib/meridian-types";
import { MeridianEventDetailPanel } from "./MeridianEventDetailPanel";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    }
    return res.json();
  });

function kindBadge(kind: string): string {
  if (kind === "macro") return "Macro";
  if (kind === "opex") return "OpEx";
  if (kind === "fda") return "FDA";
  return "Earnings";
}

export function MeridianDesk() {
  const { data, error, isLoading, mutate } = useSWR<MeridianTimelinePayload>(
    "/api/market/meridian/timeline?days=21",
    fetcher,
    { refreshInterval: 120_000 }
  );

  const items = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? items[0]?.id ?? null;
  const activeItem = items.find((i) => i.id === activeId) ?? null;

  const detailKey = activeId ? `/api/market/meridian/event?id=${encodeURIComponent(activeId)}` : null;
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
  } = useSWR<MeridianEventDetail>(detailKey, fetcher, { refreshInterval: 60_000 });

  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const month = item.date.slice(0, 7);
      const list = map.get(month) ?? [];
      list.push(item);
      map.set(month, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="meridian-desk">
      <aside className="meridian-rail" aria-label="Catalyst timeline">
        <div className="meridian-rail-head">
          <h2 className="meridian-rail-title">Upcoming catalysts</h2>
          <button type="button" className="meridian-refresh" onClick={() => mutate()}>
            Refresh
          </button>
        </div>

        {isLoading && <p className="meridian-rail-empty">Loading timeline…</p>}
        {error && !isLoading && (
          <p className="meridian-rail-empty">Timeline unavailable — try refresh.</p>
        )}
        {!isLoading && !error && items.length === 0 && (
          <p className="meridian-rail-empty">No catalysts in the next 21 sessions.</p>
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
                      <span className="meridian-row-kind">{kindBadge(item.kind)}</span>
                      <span className="meridian-row-days">
                        {item.days_until === 0 ? "Today" : `${item.days_until}d`}
                      </span>
                    </span>
                    <span className="meridian-row-title">{item.title}</span>
                    <span className="meridian-row-meta">
                      {item.date}
                      {item.time ? ` · ${item.time} ET` : ""}
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
          />
        ) : (
          <p className="meridian-detail-empty">Select a catalyst to see structure context.</p>
        )}
      </div>
    </div>
  );
}
