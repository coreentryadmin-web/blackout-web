"use client";

import clsx from "clsx";
import {
  intradayZoomShortcutLabel,
  type IntradayZoomPreset,
} from "@/features/vector/lib/vector-candle-render";

type Props = {
  active: IntradayZoomPreset | null;
  disabled?: boolean;
  comparePane?: boolean;
  onZoom: (preset: IntradayZoomPreset) => void;
};

const PRESETS: { id: IntradayZoomPreset; label: string; title: string }[] = [
  { id: "session", label: "Session", title: "Full RTH session overview" },
  { id: "structure", label: "Structure", title: "Last ~75 minutes — pivot / structure read" },
  { id: "live", label: "Live", title: "Trailing live edge (~48 bars)" },
];

/** Intraday chart zoom presets — session overview, structure window, live follow. */
export function VectorIntradayZoomControls({
  active,
  disabled = false,
  comparePane = false,
  onZoom,
}: Props) {
  return (
    <div
      className="vector-intraday-zoom"
      role="group"
      aria-label="Chart zoom preset"
      data-testid="vector-intraday-zoom"
    >
      {PRESETS.map((p) => {
        const shortcut = intradayZoomShortcutLabel(p.id, comparePane);
        return (
          <button
            key={p.id}
            type="button"
            className={clsx("vector-intraday-zoom-btn", active === p.id && "is-active")}
            aria-pressed={active === p.id}
            aria-keyshortcuts={shortcut}
            disabled={disabled}
            title={`${p.title} (${shortcut})`}
            data-testid={`vector-intraday-zoom-${p.id}`}
            onClick={() => onZoom(p.id)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
