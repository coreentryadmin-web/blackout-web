"use client";

import clsx from "clsx";
import {
  VECTOR_DRAW_COLOR_IDS,
  VECTOR_DRAW_COLORS,
  VECTOR_DRAW_TOOL_LABELS,
  VECTOR_DRAW_TOOL_SHORTCUTS,
  type VectorDrawColorId,
  type VectorDrawTool,
} from "@/features/vector/lib/vector-drawings";

type Props = {
  tool: VectorDrawTool;
  onTool: (tool: VectorDrawTool) => void;
  color: VectorDrawColorId;
  onColor: (color: VectorDrawColorId) => void;
  count: number;
  selectedId: string | null;
  onUndo: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  disabled?: boolean;
  comparePane?: boolean;
};

const TOOLS: VectorDrawTool[] = ["select", "hline", "trend", "ray", "rect", "fib", "vline", "text"];

export function VectorDrawToolbar({
  tool,
  onTool,
  color,
  onColor,
  count,
  selectedId,
  onUndo,
  onClear,
  onDeleteSelected,
  disabled = false,
  comparePane = false,
}: Props) {
  return (
    <div
      className={clsx("vector-draw-toolbar", comparePane && "vector-draw-toolbar--compare")}
      role="group"
      aria-label="Drawing tools"
      data-testid="vector-draw-toolbar"
    >
      <div className="vector-draw-toolbar-tools">
        {TOOLS.map((t) => {
          const shortcut = VECTOR_DRAW_TOOL_SHORTCUTS[t];
          const title = shortcut
            ? `${VECTOR_DRAW_TOOL_LABELS[t]} (${shortcut})`
            : VECTOR_DRAW_TOOL_LABELS[t];
          return (
            <button
              key={t}
              type="button"
              className={clsx("vector-draw-tool-btn", tool === t && "is-active")}
              aria-pressed={tool === t}
              aria-keyshortcuts={shortcut}
              title={title}
              disabled={disabled}
              data-testid={`vector-draw-tool-${t}`}
              onClick={() => onTool(t)}
            >
              {toolIcon(t)}
            </button>
          );
        })}
      </div>

      <div className="vector-draw-toolbar-colors" role="group" aria-label="Drawing color">
        {VECTOR_DRAW_COLOR_IDS.map((c) => (
          <button
            key={c}
            type="button"
            className={clsx("vector-draw-color-btn", color === c && "is-active")}
            aria-pressed={color === c}
            aria-label={`Color ${c}`}
            disabled={disabled}
            data-testid={`vector-draw-color-${c}`}
            style={{ ["--draw-color" as string]: VECTOR_DRAW_COLORS[c] }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>

      <div className="vector-draw-toolbar-actions">
        <span className="vector-draw-count" data-testid="vector-draw-count">
          {count} ink
        </span>
        <button
          type="button"
          className="vector-draw-action-btn"
          onClick={onUndo}
          disabled={disabled}
          title="Undo last drawing"
          data-testid="vector-draw-undo"
        >
          Undo
        </button>
        <button
          type="button"
          className="vector-draw-action-btn"
          onClick={onDeleteSelected}
          disabled={disabled || !selectedId}
          title="Delete selected (Del)"
          data-testid="vector-draw-delete"
        >
          Del
        </button>
        <button
          type="button"
          className="vector-draw-action-btn vector-draw-action-btn--danger"
          onClick={onClear}
          disabled={disabled || count === 0}
          title="Clear all drawings on this ticker"
          data-testid="vector-draw-clear"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function toolIcon(t: VectorDrawTool): string {
  switch (t) {
    case "select":
      return "↖";
    case "hline":
      return "—";
    case "trend":
      return "╱";
    case "ray":
      return "→";
    case "rect":
      return "▭";
    case "text":
      return "T";
    case "fib":
      return "φ";
    case "vline":
      return "|";
    default:
      return "?";
  }
}
