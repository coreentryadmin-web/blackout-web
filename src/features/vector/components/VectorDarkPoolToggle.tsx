"use client";

import clsx from "clsx";

type Props = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** When false, omit data-testid (compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/** Opt-in dark-pool concentration levels on the price pane (orange dashed guides). */
export function VectorDarkPoolToggle({ enabled, onChange, exposeTestIds = true }: Props) {
  return (
    <div className="vector-desk-seg vector-dp-walls-seg" role="group" aria-label="Dark pool walls">
      <button
        type="button"
        aria-pressed={enabled}
        title="Show top institutional dark-pool price levels as orange dashed guides on the chart."
        onClick={() => onChange(!enabled)}
        {...(exposeTestIds ? { "data-testid": "vector-dp-walls-toggle" } : {})}
        className={clsx("vector-desk-seg-btn", enabled && "is-active is-dp-walls")}
      >
        DP
      </button>
    </div>
  );
}
