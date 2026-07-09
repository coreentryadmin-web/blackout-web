"use client";

import { clsx } from "clsx";
import type { PlayKanbanChip, PlayKanbanColumn, PlayKanbanFilter } from "@/features/spx/lib/spx-play-kanban-chips";

type Props = {
  columns: Record<PlayKanbanColumn, PlayKanbanChip[]>;
  filter: PlayKanbanFilter;
  onFilterChange: (f: PlayKanbanFilter) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

const COLUMN_META: { id: PlayKanbanColumn; label: string; className: string }[] = [
  { id: "open", label: "Open", className: "spx-play-kanban-col-open" },
  { id: "watch", label: "Watch", className: "spx-play-kanban-col-watch" },
  { id: "closed", label: "Closed", className: "spx-play-kanban-col-closed" },
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
      {chip.prefix && <span className="spx-play-kanban-chip-prefix">{chip.prefix}</span>}
      <span className="spx-play-kanban-chip-label">{chip.label}</span>
    </button>
  );
}

export function SpxPlayKanbanBoard({ columns, filter, onFilterChange, selectedId, onSelect }: Props) {
  return (
    <div className="spx-play-kanban-board">
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

      <div className="spx-play-kanban-columns" aria-label="Trade alerts by state">
        {COLUMN_META.map((col, idx) => {
          const chips = columns[col.id];
          return (
            <div key={col.id} className={clsx("spx-play-kanban-col", col.className)}>
              {idx > 0 && <span className="spx-play-kanban-funnel" aria-hidden />}
              <p className="spx-play-kanban-col-title">{col.label}</p>
              <div className="spx-play-kanban-col-body">
                {chips.length === 0 ? (
                  <p className="spx-play-kanban-empty">—</p>
                ) : (
                  chips.map((chip) => (
                    <PlayKanbanChipButton
                      key={chip.id}
                      chip={chip}
                      selected={selectedId === chip.id}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
