"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import type { SwingRecordSummary } from "@/lib/swing/record";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";

const json = (u: string) => fetch(u, { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));

type SwingRecordResponse = {
  available?: boolean;
  summary?: SwingRecordSummary;
};

const COLLAPSE_STORAGE_KEY = "nh-swing-analytics-collapsed";

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v}%`;
}

function fmtSignedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v}%`;
}

/** Swing Command track record — mirrors NighthawkAnalyticsPanel for multi-day chains. */
export function SwingAnalyticsPanel() {
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "0") setCollapsed(false);
    } catch {
      /* stay collapsed */
    }
  }, []);

  const { data, isLoading } = useSWR<SwingRecordResponse>("/api/market/swing/record?days=30", json, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const summary = data?.summary;
  const decided = (summary?.wins ?? 0) + (summary?.losses ?? 0);
  const sampleOk = summary != null && decided >= TRACK_RECORD_MIN_SAMPLE && summary.low_n !== true;

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* best effort */
      }
      return next;
    });
  };

  if (isLoading && !data) {
    return (
      <div className="nh-analytics-panel nh-analytics-panel-loading" role="status">
        <span className="nh-analytics-panel-title">Swing analytics</span>
        <span className="nh-analytics-empty">Loading swing track record…</span>
      </div>
    );
  }

  if (!data?.available || !sampleOk) {
    return (
      <div className="nh-analytics-panel nh-analytics-panel-building" role="status">
        <span className="nh-analytics-panel-title">Swing analytics</span>
        <span className="nh-analytics-empty">
          Building swing track record — chains grade after exit
          {summary ? ` · ${decided}/${TRACK_RECORD_MIN_SAMPLE} resolved` : ""}
        </span>
      </div>
    );
  }

  return (
    <section
      className={clsx("nh-analytics-panel nh-analytics-panel--swing", collapsed && "nh-analytics-panel-collapsed")}
      aria-label="Swing track record"
    >
      <button
        type="button"
        className="nh-analytics-header nh-analytics-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
      >
        <span className="nh-analytics-panel-title">
          <span className={clsx("nh-analytics-chevron", !collapsed && "nh-analytics-chevron-open")} aria-hidden>
            ▸
          </span>
          Swing analytics
        </span>
        <span className="nh-analytics-panel-sub">
          {collapsed
            ? `Win ${fmtPct(summary?.win_rate_pct)} · ${fmtSignedPct(summary?.avg_compounded_return_pct)} avg chain`
            : `${summary?.window.days ?? 30}d · ${summary?.resolved_chains ?? 0} chains graded`}
        </span>
      </button>
      {!collapsed && summary && (
        <div className="nh-analytics-body" id="nh-swing-analytics-body">
          <div className="nh-analytics-tiles">
            <div className="nh-analytics-tile">
              <span className="nh-analytics-tile-label">Win rate</span>
              <span className="nh-analytics-tile-value text-sky-100">{fmtPct(summary.win_rate_pct)}</span>
            </div>
            <div className="nh-analytics-tile">
              <span className="nh-analytics-tile-label">Avg chain</span>
              <span
                className={clsx(
                  "nh-analytics-tile-value",
                  (summary.avg_compounded_return_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300",
                )}
              >
                {fmtSignedPct(summary.avg_compounded_return_pct)}
              </span>
            </div>
            <div className="nh-analytics-tile">
              <span className="nh-analytics-tile-label">Resolved</span>
              <span className="nh-analytics-tile-value text-sky-100">{summary.resolved_chains}</span>
            </div>
            <div className="nh-analytics-tile">
              <span className="nh-analytics-tile-label">Open</span>
              <span className="nh-analytics-tile-value text-sky-100">{summary.opens}</span>
            </div>
          </div>
          <p className="nh-analytics-footnote">
            Roll-chain composite preserves every leg loss — a later winner never nets away an earlier stop.
          </p>
        </div>
      )}
    </section>
  );
}

export default SwingAnalyticsPanel;
