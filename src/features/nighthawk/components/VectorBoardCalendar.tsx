"use client";

import { clsx } from "clsx";
import type { VectorBoardCalendarBucket } from "@/features/nighthawk/lib/vector-board-table-utils";

function fmtSigned(v: number): string {
  return `${v >= 0 ? "+" : ""}${v}%`;
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
        const month = b.session_date.slice(5, 7);
        return (
          <button
            key={b.session_date}
            type="button"
            className={clsx("vector-board-cal-cell", `is-${b.tone}`, active && "is-selected")}
            onClick={() => onSelectDate(active ? null : b.session_date)}
            aria-pressed={active}
            title={`${b.session_date} · ${b.n} picks · ${b.winners} winners · avg ${fmtSigned(b.net_premium_pct)}`}
          >
            <span className="vector-board-cal-month">{month}</span>
            <span className="vector-board-cal-day">{day}</span>
            <span className="vector-board-cal-net tabular-nums">
              {b.n > 0 ? fmtSigned(b.net_premium_pct) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
