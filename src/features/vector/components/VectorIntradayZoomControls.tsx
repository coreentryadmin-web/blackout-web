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
  /** Override for compare command-bar sync row. */
  ariaLabel?: string;
  testIdPrefix?: string;
  className?: string;
};

const PRESETS: { id: IntradayZoomPreset; label: string; title: string }[] = [
  { id: "session", label: "Session", title: "Full RTH session overview" },
  { id: "structure", label: "Structure", title: "Last ~75 minutes — pivot / structure read" },
  { id: "live", label: "Live", title: "Centered live window (~48 bars, current candle mid-screen)" },
];

/** Intraday chart zoom presets — session overview, structure window, live follow. */
export function VectorIntradayZoomControls({
  active,
  disabled = false,
  comparePane = false,
  onZoom,
  ariaLabel = "Chart zoom preset",
  testIdPrefix = "vector-intraday-zoom",
  className,
}: Props) {
  return (
    <div
      className={clsx("vector-intraday-zoom", className)}
      role="group"
      aria-label={ariaLabel}
      data-testid={testIdPrefix}
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
            data-testid={`${testIdPrefix}-${p.id}`}
            onClick={() => onZoom(p.id)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
