"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

function formatPresetLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function VectorBoardDatePresetDropdown({
  todaySession,
  selectedDate,
  sessionDates,
  onSelectDate,
  onScopeAll,
  onScopeToday,
}: {
  todaySession: string;
  selectedDate: string | null;
  sessionDates: string[];
  onSelectDate: (date: string | null) => void;
  onScopeToday: () => void;
  onScopeAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeDate = selectedDate ?? todaySession;
  const label = selectedDate
    ? formatPresetLabel(selectedDate)
    : todaySession
      ? `Today · ${formatPresetLabel(todaySession)}`
      : "Today";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const recent = sessionDates.filter((d) => d !== todaySession).slice(-7).reverse();

  return (
    <div className="vector-board-date-dropdown" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-board-date-trigger", open && "is-open")}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vector-board-date-trigger-label">{label}</span>
        <span className="vector-board-date-trigger-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="vector-board-date-panel" role="listbox" aria-label="Session date range">
          <button
            type="button"
            role="option"
            className={clsx("vector-board-date-opt", !selectedDate && "is-active")}
            onClick={() => {
              onScopeToday();
              setOpen(false);
            }}
          >
            <span className="vector-board-date-opt-title">Today</span>
            <span className="vector-board-date-opt-sub tabular-nums">{todaySession}</span>
          </button>
          <button
            type="button"
            role="option"
            className="vector-board-date-opt"
            onClick={() => {
              onScopeAll();
              setOpen(false);
            }}
          >
            <span className="vector-board-date-opt-title">All sessions</span>
            <span className="vector-board-date-opt-sub">No day filter</span>
          </button>
          {recent.length > 0 ? (
            <>
              <div className="vector-board-date-divider" role="separator" />
              <p className="vector-board-date-section">Recent sessions</p>
              {recent.map((date) => (
                <button
                  key={date}
                  type="button"
                  role="option"
                  className={clsx("vector-board-date-opt", selectedDate === date && "is-active")}
                  onClick={() => {
                    onSelectDate(date);
                    setOpen(false);
                  }}
                >
                  <span className="vector-board-date-opt-title">{formatPresetLabel(date)}</span>
                  <span className="vector-board-date-opt-sub tabular-nums">{date}</span>
                </button>
              ))}
            </>
          ) : null}
          <div className="vector-board-date-divider" role="separator" />
          <label className="vector-board-date-custom">
            <span className="vector-board-date-opt-title">Custom day</span>
            <input
              type="date"
              className="vector-board-date-input"
              value={activeDate || ""}
              max={todaySession || undefined}
              onChange={(e) => {
                const v = e.target.value;
                onSelectDate(v || null);
                setOpen(false);
              }}
              aria-label="Pick custom session day"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
