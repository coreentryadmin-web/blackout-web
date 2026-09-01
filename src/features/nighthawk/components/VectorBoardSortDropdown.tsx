"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  VECTOR_BOARD_SORT_OPTIONS,
  type VectorBoardSort,
} from "@/features/nighthawk/lib/vector-board-filters";

/** X Ads–style sort preset dropdown for the Vector board table. */
export function VectorBoardSortDropdown({
  value,
  onChange,
}: {
  value: VectorBoardSort;
  onChange: (next: VectorBoardSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = VECTOR_BOARD_SORT_OPTIONS.find((o) => o.id === value) ?? VECTOR_BOARD_SORT_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="vector-board-sort" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-board-sort-trigger", open && "is-open")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="vector-board-sort-label">Sort</span>
        <span className="vector-board-sort-value">{active.label}</span>
        <span className="vector-board-sort-chevron" aria-hidden>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d={open ? "M2 7 L5 4 L8 7" : "M2 4 L5 7 L8 4"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="vector-board-sort-panel" role="listbox" aria-label="Sort picks">
          {VECTOR_BOARD_SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={value === opt.id}
              className={clsx("vector-board-sort-opt", value === opt.id && "is-active")}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            >
              {opt.label}
              {value === opt.id ? (
                <span className="vector-board-sort-check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
