"use client";

import clsx from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { VectorDteToggle } from "@/features/vector/components/VectorDteToggle";
import { VectorLensToggle } from "@/features/vector/components/VectorLensToggle";
import { VectorTimeframeSelect } from "@/features/vector/components/VectorTimeframeSelect";
import {
  VECTOR_COMPARE_PRESETS,
  type VectorComparePreset,
} from "@/features/vector/lib/vector-compare";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

type Props = {
  paneCount: number;
  linked: boolean;
  onToggleLinked: () => void;
  linkedZoom: boolean;
  onToggleLinkedZoom: () => void;
  canLinkTime: boolean;
  focusExpanded: boolean;
  canFocusExpand: boolean;
  onToggleFocusExpand: () => void;
  timeframe: VectorTimeframeMinutes;
  onTimeframe: (tf: VectorTimeframeMinutes) => void;
  dteHorizon: VectorDteHorizon;
  onDteHorizon: (h: VectorDteHorizon) => void;
  lens: VectorWallLens;
  onLens: (l: VectorWallLens) => void;
  onExitCompare: () => void;
  onApplyPreset: (preset: VectorComparePreset) => void;
  liveSession: boolean;
};

export function VectorCompareCommandBar({
  paneCount,
  linked,
  onToggleLinked,
  linkedZoom,
  onToggleLinkedZoom,
  canLinkTime,
  focusExpanded,
  canFocusExpand,
  onToggleFocusExpand,
  timeframe,
  onTimeframe,
  dteHorizon,
  onDteHorizon,
  lens,
  onLens,
  onExitCompare,
  onApplyPreset,
  liveSession,
}: Props) {
  return (
    <header className="vector-compare-command">
      <div className="vector-compare-command-brand">
        <ProductMark product="vector" size={24} animated={false} />
        <div className="vector-compare-command-titles">
          <span className="vector-compare-command-kicker">Vector</span>
          <h1 className="vector-compare-command-title">Compare</h1>
        </div>
        <span className="vector-compare-command-count">
          {paneCount} {paneCount === 1 ? "chart" : "charts"}
        </span>
      </div>

      <div
        className={clsx("vector-compare-command-sync", !linked && "is-unlinked")}
        role="group"
        aria-label="Linked chart controls"
      >
        <button
          type="button"
          className={clsx("vector-compare-link-btn", linked && "is-linked")}
          onClick={onToggleLinked}
          aria-pressed={linked}
          data-testid="vector-compare-linked"
          title={linked ? "Linked — settings, crosshair, and optional zoom sync" : "Per-pane controls"}
        >
          <span className="vector-compare-link-icon" aria-hidden="true" />
          {linked ? "Linked" : "Per-pane"}
        </button>
        <div className="vector-compare-command-linked-controls">
          <VectorTimeframeSelect
            interval={timeframe}
            onInterval={onTimeframe}
            disabled={!linked}
            idSuffix="-compare"
            exposeTestIds={false}
          />
          <VectorDteToggle
            horizon={dteHorizon}
            onHorizon={onDteHorizon}
            available
            disabled={!linked}
          />
          <VectorLensToggle
            lens={lens}
            vexAvailable
            onLens={onLens}
            liveSession={liveSession}
            exposeTestIds={false}
          />
        </div>
        {canLinkTime ? (
          <button
            type="button"
            className={clsx("vector-compare-zoom-link-btn", linkedZoom && "is-active")}
            onClick={onToggleLinkedZoom}
            aria-pressed={linkedZoom}
            disabled={!linked}
            title="Sync pan/zoom window across charts"
            data-testid="vector-compare-linked-zoom"
          >
            Sync zoom
          </button>
        ) : null}
      </div>

      <div className="vector-compare-command-presets" role="group" aria-label="Compare presets">
        {VECTOR_COMPARE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="vector-compare-preset-btn"
            onClick={() => onApplyPreset(preset)}
            data-testid={`vector-compare-preset-${preset.id}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {canFocusExpand ? (
        <button
          type="button"
          className={clsx("vector-compare-focus-btn", focusExpanded && "is-active")}
          onClick={onToggleFocusExpand}
          aria-pressed={focusExpanded}
          title={focusExpanded ? "Return to grid (Esc)" : "Expand focused chart (F)"}
          data-testid="vector-compare-focus-toggle"
        >
          {focusExpanded ? "Grid" : "Focus"}
        </button>
      ) : null}

      <button
        type="button"
        className="vector-compare-exit-btn"
        onClick={onExitCompare}
        data-testid="vector-compare-exit"
      >
        Exit compare
      </button>
    </header>
  );
}
