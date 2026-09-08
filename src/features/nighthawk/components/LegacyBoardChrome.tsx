"use client";

import { clsx } from "clsx";
import { VectorBoardCalendar } from "@/features/nighthawk/components/VectorBoardCalendar";
import type { VectorBoardCalendarBucket } from "@/features/nighthawk/lib/vector-board-table-utils";

export function LegacyBoardChrome({
  editionFor,
  todaySession,
  selectedDate,
  onSelectedDateChange,
  calendarBuckets,
  playCount,
  editionLabel,
}: {
  editionFor: string | null;
  todaySession: string;
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
  calendarBuckets: VectorBoardCalendarBucket[];
  playCount: number;
  editionLabel?: string | null;
}) {
  const activeDate = selectedDate ?? editionFor ?? todaySession;

  return (
    <header className="vector-board-toolbar legacy-board-toolbar">
      <div className="vector-board-toolbar-row">
        <div className="vector-board-tabs" role="tablist" aria-label="Legacy edition">
          <span className="vector-board-tab is-active" role="tab" aria-selected>
            Legacy Playbook
            <span className="vector-board-tab-count tabular-nums">({playCount})</span>
          </span>
        </div>

        <div className="vector-board-toolbar-actions">
          <div className="vector-board-scope" role="group" aria-label="Edition scope">
            <button
              type="button"
              className={clsx("vector-board-scope-btn", !selectedDate && "is-active")}
              onClick={() => onSelectedDateChange(null)}
            >
              Latest
            </button>
            <button
              type="button"
              className={clsx("vector-board-scope-btn", selectedDate != null && "is-active")}
              onClick={() => onSelectedDateChange(editionFor ?? todaySession)}
            >
              Browse
            </button>
          </div>
          <label className="vector-board-date-picker">
            <span className="vector-board-date-picker-label">Edition</span>
            <input
              type="date"
              className="vector-board-date-input"
              value={activeDate || ""}
              max={todaySession || undefined}
              onChange={(e) => {
                const v = e.target.value;
                onSelectedDateChange(v || null);
              }}
              aria-label="Pick edition day"
            />
          </label>
        </div>
      </div>

      <div className="vector-board-controls">
        <p className="vector-board-results-meta tabular-nums" aria-live="polite">
          Showing <strong>{playCount}</strong> plays
          {editionLabel ? <span className="vector-board-results-date"> · {editionLabel}</span> : null}
        </p>
      </div>

      {calendarBuckets.length > 0 ? (
        <div className="vector-board-cal-wrap">
          <VectorBoardCalendar
            buckets={calendarBuckets}
            selectedDate={activeDate}
            onSelectDate={(date) => onSelectedDateChange(date === activeDate ? null : date)}
          />
          {selectedDate ? (
            <button
              type="button"
              className="vector-board-cal-clear"
              onClick={() => onSelectedDateChange(null)}
            >
              Back to latest
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
