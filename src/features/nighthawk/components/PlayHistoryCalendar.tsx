"use client";

// Calendar heat-strip over the History window — click a day to narrow PlayHistoryTable to
// just that session. Same visual idea as Meridian's earnings calendar heat grid (`.mea-cal`
// in globals.css), but a distinct component: Meridian buckets by *earnings surprise tone*,
// this buckets by *this session's own net managed P&L* (dailyPnlByDate, analytics-panel.ts) —
// different domain, so no shared import, matching how PlayHistoryTable already duplicates
// (rather than imports) NighthawkAnalyticsPanel's private outcome-label map.
//
// Color discipline (explicit product decision, not a default): exactly THREE tones, never a
// red/amber/green gradient by magnitude — green only for a net-positive session, red only for
// net-negative, and amber/orange for "flat" (a net-zero day AND a day with plays that haven't
// graded yet — both are genuinely neutral, not a weak win or a weak loss).
import { clsx } from "clsx";
import type { DailyPnlBucket } from "@/features/nighthawk/lib/analytics-panel";

const EM_DASH = "—";

function fmtSignedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v}%`;
}

export function PlayHistoryCalendar({
  buckets,
  selectedDate,
  onSelectDate,
}: {
  buckets: DailyPnlBucket[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  if (buckets.length === 0) return null;

  return (
    <div className="nh-history-cal" role="group" aria-label="Past sessions">
      {buckets.map((b) => {
        const active = b.session_date === selectedDate;
        const day = b.session_date.slice(-2);
        return (
          <button
            key={b.session_date}
            type="button"
            className={clsx("nh-history-cal-cell", `is-${b.tone}`, active && "is-selected")}
            onClick={() => onSelectDate(active ? null : b.session_date)}
            aria-pressed={active}
            title={`${b.session_date} · ${b.graded}/${b.n} graded · net ${fmtSignedPct(b.net_pnl_pct)}`}
          >
            <span className="nh-history-cal-day">{day}</span>
            <span className="nh-history-cal-net tabular-nums">
              {b.graded > 0 ? fmtSignedPct(b.net_pnl_pct) : EM_DASH}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default PlayHistoryCalendar;
