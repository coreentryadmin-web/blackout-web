"use client";

import clsx from "clsx";
import {
  VECTOR_DTE_HORIZONS,
  dteHorizonLabel,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";

type Props = {
  horizon: VectorDteHorizon;
  onHorizon: (h: VectorDteHorizon) => void;
  /** Always true today: the per-expiry CHAIN path re-scopes walls for EVERY optionable ticker
   *  (getPerExpiryGexWalls), not just the WS-oracle names — the old "oracle tickers only" note
   *  predated that and misled a QA pass into flagging the toggle on TSLA as a bug. Kept as a prop
   *  so a future per-ticker availability rule has a seam. */
  available: boolean;
  disabled?: boolean;
  /** Rendered under the VEX lens, where the CHART's vanna rail is not per-expiry (no vanna is
   *  recorded on the narrowed rails — see vector-narrowed-wall-core.ts). The toggle still governs the
   *  GEX ladder, so it must stay reachable; this only changes what it says it is doing. */
  ladderOnly?: boolean;
};

/** Compact DTE horizon selector — 0DTE / Weekly / Monthly.
 *  "All" was REMOVED from the member UI (user-directed, 2026-07-13): the blended all-expiry scope
 *  was the one whose definition drifted across surfaces/tasks (DTE grind findings) and it added no
 *  decision value over the narrowed horizons. The "all" horizon still exists in the type + APIs
 *  (SPX Slayer/BIE consume it); only the member-facing option is gone. */
export function VectorDteToggle({
  horizon,
  onHorizon,
  available,
  disabled = false,
  ladderOnly = false,
}: Props) {
  if (!available) return null;
  const groupLabel = ladderOnly ? "Expiry horizon (GEX ladder)" : "Expiry horizon";
  // Under VEX the toggle no longer scopes the chart, so say so rather than letting the member infer
  // that the vanna rail they are looking at is per-expiry.
  const hint = ladderOnly
    ? "Scopes the GEX ladder. The VEX chart rail covers all expiries — per-expiry vanna is not recorded."
    : undefined;
  return (
    <div className="vector-desk-seg" role="group" aria-label={groupLabel} title={hint}>
      {VECTOR_DTE_HORIZONS.filter((k) => k !== "all").map((key) => {
        const active = horizon === key;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onHorizon(key)}
            aria-pressed={active}
            data-testid={`vector-dte-${key}`}
            className={clsx(
              "vector-desk-seg-btn",
              active && "is-active is-dte",
              disabled && "is-disabled"
            )}
          >
            {dteHorizonLabel(key)}
          </button>
        );
      })}
    </div>
  );
}
