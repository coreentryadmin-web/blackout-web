"use client";

// Session Analytics panel for the 0DTE Command deck (/nighthawk, ZERO_DTE view).
//
// WHY: the deck's left column is a play-by-play ledger table (ZeroDteBoard/CommandDeck) —
// real-time and correct, but it never answers "how is the SESSION/TRACK RECORD doing" at a
// glance. This panel sits above the deck and answers exactly that from the SAME data source
// members already partially see in HawkRecordStrip (`/api/market/zerodte/record`), with real
// chart primitives (recharts, code-split like DarkPoolSpark) instead of plain text.
//
// Every number here is either served directly by ZeroDteRecord (win_rate_pct, avg_pnl_pct,
// by_outcome, by_direction) or derived from its own `plays[]` by the pure, unit-tested helpers
// in `analytics-panel.ts` (tier win-rate, same-session P&L curve) — nothing is invented client
// side. Gated behind the same TRACK_RECORD_MIN_SAMPLE the legacy HawkRecordStrip uses, so a
// thin sample never renders confident-looking bars off 2 plays.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { clsx } from "clsx";
import type { ZeroDteRecord, ZeroDteRecordBucket } from "@/lib/zerodte/record";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";
import {
  winRateByTier,
  sessionPnlCurve,
  latestSessionDate,
  type TierWinRateBucket,
} from "@/features/nighthawk/lib/analytics-panel";

// Humanizes the raw `by_outcome` bucket labels (record.ts stamps the literal engine exit
// reason — thesis_break:gex-walls, ratchet_breakeven_floor, flat_theta_bleed, etc). Distinct
// from ZeroDteBoard.tsx's NIGHTHAWK_OUTCOME_LABEL, which covers a different vocabulary (the
// BIE echo note's target/stop/open/ambiguous/pending/unfilled) — not reusable here (Cursor
// review, PR #2989: the two label sets don't overlap despite the "outcome" name in both).
const OUTCOME_BUCKET_LABEL: Record<string, string> = {
  doubled: "doubled",
  stopped: "stopped",
  time_stop: "time stop",
  ratchet_breakeven_floor: "breakeven floor",
  ratchet_early_profit_floor: "early profit floor",
  ratchet_profit_floor: "profit floor",
  runner_floor: "runner floor",
  plan_stop: "plan stop",
  plan_target_trim: "target trim",
  trim_scale_first: "1st trim",
  trim_scale_second: "2nd trim",
  trim_scale_runner_target: "runner target",
  flat_theta_bleed: "flat scratch",
  ungraded: "ungraded",
};

function humanizeOutcomeLabel(raw: string): string {
  if (OUTCOME_BUCKET_LABEL[raw]) return OUTCOME_BUCKET_LABEL[raw];
  // thesis_break:<source> carries a variable suffix (gex-walls, oppose_cluster, ...) —
  // strip it rather than hardcoding every source.
  if (raw.startsWith("thesis_break")) return "thesis break";
  return raw;
}

const SessionPnlChart = dynamic(
  () => import("./NighthawkSessionPnlChart").then((m) => m.NighthawkSessionPnlChart),
  { ssr: false }
);

const EM_DASH = "—";

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${v}%`;
}

function fmtSignedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${v >= 0 ? "+" : ""}${v}%`;
}

const json = (u: string) => fetch(u, { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));

/** Horizontal win-rate bar — one row of the tier/outcome/direction breakouts. Width is the
 *  win rate itself (0-100), color ramps red→amber→green so a scanning trader reads the shape
 *  before the number. Null win-rate (no decided plays yet) renders a hairline, not a full bar
 *  — a 0-width bar is invisible and reads as "no data", which is what it is. */
function WinRateBar({
  label,
  n,
  winRatePct,
  avgPnlPct,
  lowN,
}: {
  label: string;
  n: number;
  winRatePct: number | null;
  avgPnlPct: number | null;
  lowN: boolean;
}) {
  const pct = winRatePct ?? 0;
  const tone = winRatePct == null ? "bg-white/10" : pct >= 55 ? "bg-emerald-400" : pct >= 40 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="nh-analytics-barrow" title={`${label}: ${n} play${n === 1 ? "" : "s"}, ${fmtPct(winRatePct)} win rate`}>
      <div className="nh-analytics-barrow-label">
        <span>{label}</span>
        {lowN && n > 0 && (
          <span
            className="rounded border border-gold/35 bg-gold/[0.08] px-1 py-px font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-gold"
            title={`Fewer than ${LOW_N_THRESHOLD} scoreable plays — not enough samples to read as a trend`}
          >
            n&lt;{LOW_N_THRESHOLD}
          </span>
        )}
      </div>
      <div className="nh-analytics-bartrack">
        <div className={clsx("nh-analytics-barfill", tone)} style={{ width: `${Math.max(pct, winRatePct == null ? 0 : 2)}%` }} />
      </div>
      <div className="nh-analytics-barvalue">
        <span className="tabular-nums">{fmtPct(winRatePct)}</span>
        <span className="nh-analytics-barvalue-sub tabular-nums">
          {n} · avg {fmtSignedPct(avgPnlPct)}
        </span>
      </div>
    </div>
  );
}

function BucketRows({ buckets }: { buckets: ZeroDteRecordBucket[] }) {
  const shown = buckets.filter((b) => b.n > 0);
  if (shown.length === 0) return <p className="nh-analytics-empty">No graded plays in this window yet.</p>;
  return (
    <div className="nh-analytics-barlist">
      {shown.map((b) => (
        <WinRateBar key={b.label} label={humanizeOutcomeLabel(b.label)} n={b.n} winRatePct={b.win_rate_pct} avgPnlPct={b.avg_pnl_pct} lowN={b.low_n} />
      ))}
    </div>
  );
}

function TierRows({ buckets }: { buckets: TierWinRateBucket[] }) {
  const shown = buckets.filter((b) => b.n > 0);
  if (shown.length === 0) return <p className="nh-analytics-empty">No tier-graded plays in this window yet.</p>;
  return (
    <div className="nh-analytics-barlist">
      {shown.map((b) => (
        <WinRateBar key={b.tier} label={`Tier ${b.tier}`} n={b.n} winRatePct={b.win_rate_pct} avgPnlPct={b.avg_pnl_pct} lowN={b.low_n} />
      ))}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "flat" }) {
  return (
    <div className="nh-analytics-tile">
      <span className="nh-analytics-tile-label">{label}</span>
      <span
        className={clsx(
          "nh-analytics-tile-value",
          tone === "up" && "text-emerald-300",
          tone === "down" && "text-rose-300",
          tone === "flat" && "text-sky-100"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Member-facing preference: collapsed vs expanded. Collapsed is the default — the panel sits
// ABOVE the live play ledger (CommandDeck), and on a phone-width viewport its stat tiles + two
// bar columns + a chart run tall enough to push the ledger fully below the fold (member report
// 2026-08-28, screenshot showed OPEN/WATCH/CLOSED and the play cards invisible without scrolling
// past this panel first). The ledger is what a member opens the deck for; this panel is a
// secondary "how's the session going" view, so it starts closed and expands on demand.
const COLLAPSE_STORAGE_KEY = "nh-analytics-collapsed";

export function NighthawkAnalyticsPanel() {
  const { data: record, isLoading } = useSWR<ZeroDteRecord>("/api/market/zerodte/record?days=30", json, {
    // The ledger updates as plays grade through the session, not tick-by-tick — 30s keeps the
    // panel fresh without adding load next to the board's own 1s RTH poll.
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  // Defaults to collapsed on every render (incl. server-adjacent first client render, since this
  // whole component is already ssr:false); a stored "0" (explicitly expanded) flips it open on
  // mount. Read/write are both best-effort — private-mode/blocked storage just keeps the default.
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === "0") setCollapsed(false);
    } catch {
      // storage unavailable — stay collapsed, the safe default
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence only — the in-memory toggle still works this session
      }
      return next;
    });
  };

  const tierBuckets = useMemo(() => winRateByTier(record?.plays ?? []), [record?.plays]);
  const pnlCurve = useMemo(() => sessionPnlCurve(record?.plays ?? []), [record?.plays]);
  const sessionNet = pnlCurve.length > 0 ? pnlCurve[pnlCurve.length - 1].cumulative_pct : null;
  // The curve's own latest session can lag "today" pre-market or over a weekend/holiday —
  // caption it against record.window.through (the record's own as-of session date, already
  // computed server-side) rather than always saying "Today's", which would mislabel a prior
  // session's plays as today's (Cursor review, PR #2989).
  const curveDate = record?.plays?.length ? latestSessionDate(record.plays) : null;
  const curveIsToday = curveDate != null && record != null && curveDate === record.window.through;

  if (isLoading && !record) {
    return (
      <div className="nh-analytics-panel nh-analytics-panel-loading" role="status">
        <span className="nh-analytics-panel-title">Session analytics</span>
        <span className="nh-analytics-empty">Loading track record…</span>
      </div>
    );
  }

  if (!record?.available || record.graded < TRACK_RECORD_MIN_SAMPLE) {
    return (
      <div className="nh-analytics-panel nh-analytics-panel-building" role="status">
        <span className="nh-analytics-panel-title">Session analytics</span>
        <span className="nh-analytics-empty">
          Building track record — outcomes resolve after each session
          {record ? ` · ${record.graded}/${TRACK_RECORD_MIN_SAMPLE} graded` : ""}
        </span>
      </div>
    );
  }

  return (
    <section className={clsx("nh-analytics-panel", collapsed && "nh-analytics-panel-collapsed")} aria-label="0DTE session analytics">
      <button
        type="button"
        className="nh-analytics-header nh-analytics-toggle"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="nh-analytics-body"
      >
        <span className="nh-analytics-panel-title">
          <span className={clsx("nh-analytics-chevron", !collapsed && "nh-analytics-chevron-open")} aria-hidden>
            ▸
          </span>
          Session analytics
        </span>
        <span className="nh-analytics-panel-sub">
          {collapsed
            ? `Win ${fmtPct(record.win_rate_pct)} · ${fmtSignedPct(record.avg_pnl_pct)} avg · tap to expand`
            : `${record.window.days}d track record · ${record.graded} graded`}
        </span>
      </button>

      {!collapsed && (
        <div id="nh-analytics-body">
          <div className="nh-analytics-tiles">
            <StatTile
              label="Win rate"
              value={fmtPct(record.win_rate_pct)}
              tone={record.win_rate_pct == null ? "flat" : record.win_rate_pct >= 50 ? "up" : "down"}
            />
            <StatTile
              label="Avg return"
              value={fmtSignedPct(record.avg_pnl_pct)}
              tone={record.avg_pnl_pct == null ? "flat" : record.avg_pnl_pct >= 0 ? "up" : "down"}
            />
            <StatTile label="Graded" value={String(record.graded)} tone="flat" />
            <StatTile
              label="Session P&L"
              value={sessionNet == null ? EM_DASH : fmtSignedPct(sessionNet)}
              tone={sessionNet == null ? "flat" : sessionNet >= 0 ? "up" : "down"}
            />
          </div>

          <div className="nh-analytics-grid">
            <div className="nh-analytics-col">
              <span className="nh-analytics-col-title">By merit tier</span>
              <TierRows buckets={tierBuckets} />
            </div>
            <div className="nh-analytics-col">
              <span className="nh-analytics-col-title">By exit outcome</span>
              <BucketRows buckets={record.by_outcome} />
            </div>
            <div className="nh-analytics-col nh-analytics-col-wide">
              <span className="nh-analytics-col-title">
                {curveIsToday ? "Today's session P&L" : "Latest session P&L"}
                {pnlCurve.length > 0 ? ` · ${pnlCurve.length} resolved` : ""}
                {!curveIsToday && curveDate ? ` · ${curveDate}` : ""}
              </span>
              {pnlCurve.length > 0 ? (
                <div className="nh-analytics-curve">
                  <SessionPnlChart points={pnlCurve} />
                </div>
              ) : (
                <p className="nh-analytics-empty">No plays have resolved yet today.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default NighthawkAnalyticsPanel;
