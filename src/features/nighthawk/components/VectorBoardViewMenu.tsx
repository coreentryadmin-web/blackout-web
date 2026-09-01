"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  VECTOR_BOARD_COLUMNS,
  type VectorBoardCalendarRange,
  type VectorBoardColumnId,
  type VectorBoardDensity,
  type VectorBoardPreferences,
  type VectorBoardSavedView,
} from "@/features/nighthawk/lib/vector-board-preferences";

export function VectorBoardViewMenu({
  prefs,
  onPrefsChange,
  onApplyView,
  onExport,
  compareMode,
  onCompareModeChange,
}: {
  prefs: VectorBoardPreferences;
  onPrefsChange: (next: VectorBoardPreferences) => void;
  onApplyView: (view: VectorBoardSavedView) => void;
  onExport: () => void;
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  const setDensity = (density: VectorBoardDensity) => onPrefsChange({ ...prefs, density });
  const setCalendarRange = (calendarRange: VectorBoardCalendarRange) =>
    onPrefsChange({ ...prefs, calendarRange });
  const toggleColumn = (id: VectorBoardColumnId) =>
    onPrefsChange({
      ...prefs,
      columns: { ...prefs.columns, [id]: !prefs.columns[id] },
    });
  const toggleFocus = () => onPrefsChange({ ...prefs, focusMode: !prefs.focusMode });

  return (
    <div className="vector-board-view-menu" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-board-view-trigger", open && "is-open")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="vector-board-view-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1.5" y="2" width="9" height="2" rx="0.5" fill="currentColor" opacity="0.5" />
            <rect x="1.5" y="5" width="6" height="2" rx="0.5" fill="currentColor" />
            <rect x="1.5" y="8" width="8" height="2" rx="0.5" fill="currentColor" opacity="0.7" />
          </svg>
        </span>
        View
      </button>
      {open ? (
        <div className="vector-board-view-panel" role="menu">
          <div className="vector-board-view-section">
            <span className="vector-board-view-heading">Density</span>
            <div className="vector-board-view-row">
              <button
                type="button"
                className={clsx("vector-board-view-chip", prefs.density === "comfortable" && "is-active")}
                onClick={() => setDensity("comfortable")}
              >
                Comfortable
              </button>
              <button
                type="button"
                className={clsx("vector-board-view-chip", prefs.density === "compact" && "is-active")}
                onClick={() => setDensity("compact")}
              >
                Compact
              </button>
            </div>
          </div>

          <div className="vector-board-view-section">
            <span className="vector-board-view-heading">Calendar</span>
            <div className="vector-board-view-row">
              <button
                type="button"
                className={clsx("vector-board-view-chip", prefs.calendarRange === "recent" && "is-active")}
                onClick={() => setCalendarRange("recent")}
              >
                Last 5 sessions
              </button>
              <button
                type="button"
                className={clsx("vector-board-view-chip", prefs.calendarRange === "all" && "is-active")}
                onClick={() => setCalendarRange("all")}
              >
                All sessions
              </button>
            </div>
          </div>

          <div className="vector-board-view-section">
            <span className="vector-board-view-heading">Columns</span>
            <div className="vector-board-view-columns">
              {VECTOR_BOARD_COLUMNS.filter((c) => c.id !== "pick").map((col) => (
                <label key={col.id} className="vector-board-view-check">
                  <input
                    type="checkbox"
                    checked={prefs.columns[col.id]}
                    onChange={() => toggleColumn(col.id)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>

          <div className="vector-board-view-section">
            <span className="vector-board-view-heading">Saved views</span>
            <div className="vector-board-view-views">
              {prefs.savedViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className="vector-board-view-saved"
                  onClick={() => {
                    onApplyView(view);
                    setOpen(false);
                  }}
                >
                  {view.name}
                </button>
              ))}
            </div>
          </div>

          <div className="vector-board-view-actions">
            <button type="button" className="vector-board-view-action" onClick={toggleFocus}>
              {prefs.focusMode ? "Exit focus mode" : "Focus mode"}
            </button>
            <button
              type="button"
              className={clsx("vector-board-view-action", compareMode && "is-active")}
              onClick={() => onCompareModeChange(!compareMode)}
            >
              {compareMode ? "Exit compare" : "Compare picks"}
            </button>
            <button
              type="button"
              className="vector-board-view-action"
              onClick={() => {
                onExport();
                setOpen(false);
              }}
            >
              Export CSV
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
