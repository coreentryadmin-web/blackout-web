"use client";

import { renderEmphasis } from "@/features/spx/lib/spx-emphasis";
import type { TechnicalsLine } from "@/features/vector/lib/vector-technicals";

type Props = {
  technicals: TechnicalsLine[];
  className?: string;
};

/**
 * Standalone TECHNICALS card — extracted from VectorPulse's intel grid (2026-08-05, action-rail
 * layout) so it can sit in the desktop 4th "action" column alongside the Play card and Alerts
 * builder instead of being buried at the bottom of the long narrative feed. Reuses the exact
 * `vp-intel-card` markup/classes VectorPulse still uses for its other intel cards, so it's visually
 * identical to how this card always looked, only its PLACEMENT changed originally — and now (member
 * request, 2026-08-05) each line is colored by its own bull/bear/warn/muted `tone` (from
 * `technicalsCalloutLines`, the same `vp-t-*` classes every other intel card already uses) instead
 * of one flat muted gray, so VWAP/EMA/MACD/structure reads scan at a glance instead of requiring the
 * member to read every line's text to know which way it leans.
 * VectorPulse keeps owning the `technicals` data (via VectorChart's `onTechnicalsChange`); this
 * component is purely presentational and renders nothing when there's nothing to show, same as
 * before.
 */
export function VectorTechnicalsPanel({ technicals, className }: Props) {
  if (!technicals || technicals.length === 0) return null;

  return (
    <div className={`vp-intel vector-technicals-panel ${className ?? ""}`}>
      <div className="vp-intel-card">
        <div className="vp-intel-card-head">
          <span className="vp-intel-card-icon">≡</span>
          <span className="vp-intel-card-title">TECHNICALS</span>
        </div>
        {technicals.map((t, i) => (
          <div key={i} className={`vp-intel-card-body vp-t-${t.tone}`}>
            {renderEmphasis(t.text)}
          </div>
        ))}
      </div>
    </div>
  );
}
