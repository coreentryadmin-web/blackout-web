"use client";

import { clsx } from "clsx";
import type { VectorBoardCalendarBucket } from "@/features/nighthawk/lib/vector-board-table-utils";

function fmtSigned(v: number): string {
  return `${v >= 0 ? "+" : ""}${v}%`;
}

function intensityClass(magnitude: number): string {
  if (magnitude >= 75) return "is-intense";
  if (magnitude >= 40) return "is-strong";
  return "is-mild";
}

export function VectorBoardCalendar({
  buckets,
  selectedDate,
  onSelectDate,
}: {
  buckets: VectorBoardCalendarBucket[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  if (buckets.length === 0) return null;

  return (
    <div className="vector-board-cal" role="group" aria-label="Session calendar">
      {buckets.map((b) => {
        const active = b.session_date === selectedDate;
        const day = b.session_date.slice(-2);
        const month = new Date(`${b.session_date}T12:00:00Z`).toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
        });
        const mag = Math.abs(b.net_premium_pct);
        return (
          <button
            key={b.session_date}
            type="button"
            className={clsx(
              "vector-board-cal-cell",
              `is-${b.tone}`,
              intensityClass(mag),
              active && "is-selected"
            )}
            onClick={() => onSelectDate(active ? null : b.session_date)}
            aria-pressed={active}
            title={`${b.session_date} · ${b.n} picks · ${b.winners} winners · ${b.closed} closed · avg ${fmtSigned(b.net_premium_pct)}`}
          >
            <span className="vector-board-cal-month">{month}</span>
            <span className="vector-board-cal-day">{day}</span>
            <span className="vector-board-cal-net tabular-nums">
              {b.n > 0 ? fmtSigned(b.net_premium_pct) : "—"}
            </span>
            {b.winners > 0 ? (
              <span className="vector-board-cal-dot" aria-label={`${b.winners} winners`} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
