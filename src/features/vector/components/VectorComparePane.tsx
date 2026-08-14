"use client";

import { clsx } from "clsx";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { VectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import { fmtCompareSpot } from "@/features/vector/lib/vector-compare-format";

const VectorPageShell = dynamic(
  () =>
    import("@/features/vector/components/VectorPageShell").then((m) => ({
      default: m.VectorPageShell,
    })),
  {
    loading: () => (
      <div className="vector-compare-pane-loading" role="status" aria-live="polite">
        Loading chart…
      </div>
    ),
  }
);

export type VectorComparePaneMeta = {
  regime: VectorRegime | null;
  spot: number | null;
};

type Props = {
  seed: VectorClientSeed;
  slotIndex: number;
  syncEpoch: number;
  linkedTimeframe: VectorTimeframeMinutes;
  linkedDteHorizon: VectorDteHorizon;
  linkedLens: VectorWallLens;
  linked: boolean;
  toolbarHideLinkedControls: boolean;
  onRemove?: () => void;
  removable: boolean;
  onMeta?: (ticker: string, meta: VectorComparePaneMeta) => void;
  focused: boolean;
  onFocus?: () => void;
};

export function VectorComparePane({
  seed,
  slotIndex,
  syncEpoch,
  linkedTimeframe,
  linkedDteHorizon,
  linkedLens,
  linked,
  toolbarHideLinkedControls,
  onRemove,
  removable,
  onMeta,
  focused,
  onFocus,
}: Props) {
  const [regime, setRegime] = useState<VectorRegime | null>(null);
  const [spot, setSpot] = useState<number | null>(
    seed.initialBars.length ? seed.initialBars[seed.initialBars.length - 1]!.close : null
  );

  const pushMeta = useCallback(
    (r: VectorRegime | null, s: number | null) => {
      onMeta?.(seed.ticker, { regime: r, spot: s });
    },
    [onMeta, seed.ticker]
  );

  const handleRegime = useCallback(
    (r: VectorRegime) => {
      setRegime(r);
      pushMeta(r, spot);
    },
    [pushMeta, spot]
  );

  const handleSpot = useCallback(
    (s: number) => {
      setSpot(s);
      pushMeta(regime, s);
    },
    [pushMeta, regime]
  );

  const posture = regime?.posture ?? "unknown";
  const postureLabel =
    posture === "long"
      ? "LONG γ"
      : posture === "short"
        ? "SHORT γ"
        : posture === "transition"
          ? "TRANSITION"
          : "REGIME —";

  return (
    <article
      className={clsx("vector-compare-pane", focused && "is-focused")}
      data-slot={slotIndex + 1}
      onPointerDown={onFocus}
    >
      <header className="vector-compare-pane-head">
        <div className="vector-compare-pane-head-left">
          <span className="vector-compare-pane-slot" aria-hidden="true">
            {slotIndex + 1}
          </span>
          <span className="vector-compare-pane-ticker">{seed.ticker}</span>
          <span
            className={clsx(
              "vector-compare-pane-regime",
              posture === "long" && "is-long",
              posture === "short" && "is-short",
              posture === "transition" && "is-transition"
            )}
          >
            {postureLabel}
          </span>
        </div>
        <div className="vector-compare-pane-head-right">
          <span className="vector-compare-pane-spot">{fmtCompareSpot(spot, seed.ticker)}</span>
          {removable && onRemove ? (
            <button
              type="button"
              className="vector-compare-pane-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={`Remove ${seed.ticker} from compare`}
            >
              ×
            </button>
          ) : null}
        </div>
      </header>
      <div className="vector-compare-pane-body">
        <VectorPageShell
          key={
            linked
              ? `${seed.ticker}-${syncEpoch}-${linkedLens}-${linkedTimeframe}-${linkedDteHorizon}`
              : seed.ticker
          }
          {...seed}
          embed="chart-only"
          defaultDteHorizon={linked ? linkedDteHorizon : undefined}
          defaultTimeframe={linked ? linkedTimeframe : undefined}
          defaultChartViewport="session"
          toolbarHideLinkedControls={toolbarHideLinkedControls}
          suppressRegimeBanner
          onCompareRegimeChange={handleRegime}
          onCompareSpotChange={handleSpot}
          compareDefaultLens={linked ? linkedLens : undefined}
        />
      </div>
    </article>
  );
}
