"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { PlayKanbanChip, PlayKanbanColumn, PlayKanbanFilter } from "@/features/spx/lib/spx-play-kanban-chips";

type Props = {
  columns: Record<PlayKanbanColumn, PlayKanbanChip[]>;
  filter: PlayKanbanFilter;
  onFilterChange: (f: PlayKanbanFilter) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

const COLUMN_META: { id: PlayKanbanColumn; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "watch", label: "Watch" },
  { id: "closed", label: "Closed" },
];

const FILTERS: { id: PlayKanbanFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "structure", label: "Structure" },
  { id: "lotto", label: "Lotto" },
  { id: "power", label: "Power" },
];

function PlayKanbanChipButton({
  chip,
  selected,
  onSelect,
}: {
  chip: PlayKanbanChip;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "spx-play-kanban-chip",
        `spx-play-kanban-chip--${chip.tone}`,
        selected && "spx-play-kanban-chip--selected"
      )}
      onClick={() => onSelect(chip.id)}
      title={chip.prefix ? `${chip.prefix} · ${chip.label}` : chip.label}
    >
      <span className="spx-play-kanban-chip-kind">{chip.prefix ?? chip.kind.slice(0, 3).toUpperCase()}</span>
      <span className="spx-play-kanban-chip-label">{chip.label}</span>
    </button>
  );
}

function firstColumnWithChips(columns: Record<PlayKanbanColumn, PlayKanbanChip[]>): PlayKanbanColumn {
  for (const col of COLUMN_META) {
    if (columns[col.id].length > 0) return col.id;
  }
  return "open";
}

export function SpxPlayKanbanBoard({ columns, filter, onFilterChange, selectedId, onSelect }: Props) {
  const [activeColumn, setActiveColumn] = useState<PlayKanbanColumn>("open");

  useEffect(() => {
    if (selectedId) {
      for (const col of COLUMN_META) {
        if (columns[col.id].some((c) => c.id === selectedId)) {
          setActiveColumn(col.id);
          return;
        }
      }
    }
    setActiveColumn(firstColumnWithChips(columns));
  }, [selectedId, columns.open, columns.watch, columns.closed]);

  const activeChips = columns[activeColumn];

  return (
    <div className="spx-play-kanban-board">
      <div className="spx-play-kanban-toolbar">
        <div className="spx-play-kanban-filters" role="group" aria-label="Play type filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={clsx("spx-play-surface-filter", filter === f.id && "spx-play-surface-filter-active")}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="spx-play-kanban-column-tabs" role="tablist" aria-label="Play state">
          {COLUMN_META.map((col) => {
            const count = columns[col.id].length;
            const active = activeColumn === col.id;
            return (
              <button
                key={col.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={clsx("spx-play-kanban-column-tab", active && "spx-play-kanban-column-tab--active")}
                onClick={() => setActiveColumn(col.id)}
              >
                <span>{col.label}</span>
                <span className="spx-play-kanban-column-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="spx-play-kanban-chip-tray"
        role="tabpanel"
        aria-label={`${activeColumn} plays`}
      >
        {activeChips.length === 0 ? (
          <p className="spx-play-kanban-empty-tray">No {activeColumn} plays in this filter.</p>
        ) : (
          <div className="spx-play-kanban-chip-row">
            {activeChips.map((chip) => (
              <PlayKanbanChipButton
                key={chip.id}
                chip={chip}
                selected={selectedId === chip.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
