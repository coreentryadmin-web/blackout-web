"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  VECTOR_DRAW_COLOR_IDS,
  VECTOR_DRAW_COLORS,
  VECTOR_DRAW_TOOL_LABELS,
  VECTOR_DRAW_TOOL_SHORTCUTS,
  type VectorDrawColorId,
  type VectorDrawTool,
} from "@/features/vector/lib/vector-drawings";

export type VectorDrawToolsProps = {
  tool: VectorDrawTool;
  onTool: (tool: VectorDrawTool) => void;
  color: VectorDrawColorId;
  onColor: (color: VectorDrawColorId) => void;
  textLabel: string;
  onTextLabel: (label: string) => void;
  count: number;
  selectedId: string | null;
  onUndo: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  disabled?: boolean;
};

const TOOLS: VectorDrawTool[] = ["select", "hline", "trend", "ray", "rect", "fib", "vline", "text"];

/** Compact dropdown — all drawing tools live under one "Tools" trigger (like Indicators). */
export function VectorDrawToolsMenu({
  tool,
  onTool,
  color,
  onColor,
  textLabel,
  onTextLabel,
  count,
  selectedId,
  onUndo,
  onClear,
  onDeleteSelected,
  disabled = false,
}: VectorDrawToolsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = tool !== "select" || count > 0;

  return (
    <div className="vector-draw-menu" ref={rootRef} data-testid="vector-draw-toolbar">
      <button
        type="button"
        className={clsx("vector-ind-trigger", active && "vector-ind-trigger-active")}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="vector-draw-tools-trigger"
      >
        Tools
        {count > 0 ? <span className="vector-ind-badge">{count}</span> : null}
      </button>

      {open ? (
        <div className="vector-draw-panel" role="menu" aria-label="Drawing tools">
          <div className="vector-ind-panel-head">
            <span>Draw</span>
            {count > 0 ? (
              <button type="button" className="vector-ind-clear" onClick={onClear}>
                Clear all
              </button>
            ) : null}
          </div>

          <div className="vector-draw-panel-tools" role="group" aria-label="Tool type">
            {TOOLS.map((t) => {
              const shortcut = VECTOR_DRAW_TOOL_SHORTCUTS[t];
              const title = shortcut
                ? `${VECTOR_DRAW_TOOL_LABELS[t]} (${shortcut})`
                : VECTOR_DRAW_TOOL_LABELS[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tool === t}
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

          <div className="vector-draw-panel-colors" role="group" aria-label="Drawing color">
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

          {tool === "text" ? (
            <label className="vector-draw-text-label">
              <span className="sr-only">Text label</span>
              <input
                type="text"
                className="vector-draw-text-input"
                value={textLabel}
                onChange={(e) => onTextLabel(e.target.value)}
                placeholder="Label — click chart to place"
                maxLength={120}
                disabled={disabled}
                data-testid="vector-draw-text-input"
              />
            </label>
          ) : null}

          <div className="vector-draw-panel-actions">
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Use VectorDrawToolsMenu — kept for import stability in tests/scripts. */
export const VectorDrawToolbar = VectorDrawToolsMenu;

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
