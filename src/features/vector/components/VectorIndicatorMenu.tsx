"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  VECTOR_INDICATOR_GROUPS,
  VECTOR_OPENING_RANGE_PRESETS,
  isVectorOverlayFamilyId,
  overlayFamilyAvailability,
  openingRangeLabel,
  type VectorIndicatorId,
  type VectorOpeningRangeMinutes,
} from "@/features/vector/lib/vector-indicators-config";

type Props = {
  enabled: Set<VectorIndicatorId>;
  onToggle: (id: VectorIndicatorId) => void;
  onClear: () => void;
  /** Bars currently shown (at the active timeframe) — MA families that need more are annotated. */
  barCount: number;
  /** Selected opening-range window — the "Opening range" item's label is computed from this (e.g.
   *  "Opening range (30m)") rather than the registry's static default, and a compact 5/15/30/60m
   *  preset control renders under the item once "opening-range" is enabled (2026-08-05 audit
   *  finding #7: the window was hardcoded to 15 with no way to change it). */
  openingRangeMinutes: VectorOpeningRangeMinutes;
  onOpeningRangeMinutes: (minutes: VectorOpeningRangeMinutes) => void;
};

/**
 * Indicator toggle menu — a compact dropdown of the price-pane overlays, all OFF by default. One
 * toggle per TYPE (VWAP / EMA / SMA), so enabling "EMA" draws every EMA line at once rather than a
 * checkbox per period; enabled types show a coloured dot matching the on-chart line. Closes on
 * outside-click / Escape. Oscillators (RSI/MACD) and profiles land in follow-ups and slot into this
 * same menu as new type toggles.
 */
export function VectorIndicatorMenu({
  enabled,
  onToggle,
  onClear,
  barCount,
  openingRangeMinutes,
  onOpeningRangeMinutes,
}: Props) {
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

  const count = enabled.size;

  return (
    <div className="vector-ind-menu" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-ind-trigger", count > 0 && "vector-ind-trigger-active")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="vector-indicator-trigger"
      >
        Indicators
        {count > 0 ? <span className="vector-ind-badge">{count}</span> : null}
      </button>

      {open ? (
        <div className="vector-ind-panel" role="menu">
          {VECTOR_INDICATOR_GROUPS.map((group, gi) => (
            <div key={group.title}>
              <div className="vector-ind-panel-head">
                <span>{group.title}</span>
                {gi === 0 && count > 0 ? (
                  <button type="button" className="vector-ind-clear" onClick={onClear}>
                    Clear
                  </button>
                ) : null}
              </div>
              {group.items.map((it) => {
                const on = enabled.has(it.id);
                // MA families can't compute when the current timeframe leaves too few bars (e.g.
                // SMA 200 on a ~7-bar 60m session). Annotate that, and block ENABLING a family that
                // would draw nothing — but never block turning one OFF (so a family enabled at a
                // lower timeframe can still be cleared). Levels have no bar-count dependency.
                const avail = isVectorOverlayFamilyId(it.id)
                  ? overlayFamilyAvailability(it.id, barCount)
                  : null;
                const note =
                  avail?.status === "none"
                    ? `needs ≥${avail.minBars} bars`
                    : avail?.status === "partial"
                      ? `${avail.missing.join("/")} n/a`
                      : null;
                const blocked = avail?.status === "none" && !on;
                // Static tooltip (2026-08-05 audit finding) — e.g. "Fib"/"Auto fib" use different
                // retracement-direction conventions with no other on-chart explanation of why they
                // can point opposite ways. Combined with the bar-count note when both are present.
                const tooltip = [it.hint, note ? `${it.label} — ${note} at this timeframe` : null]
                  .filter(Boolean)
                  .join(" ");
                // "Opening range" carries a COMPUTED label reflecting the actual selected window
                // (2026-08-05 audit finding #7) rather than the registry's static "(15m)" default.
                const isOpeningRange = it.id === "opening-range";
                const label = isOpeningRange ? openingRangeLabel(openingRangeMinutes) : it.label;
                return (
                  <div key={it.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={blocked}
                      title={tooltip || undefined}
                      className={clsx(
                        "vector-ind-item",
                        on && "vector-ind-item-on",
                        blocked && "vector-ind-item-disabled"
                      )}
                      onClick={() => onToggle(it.id)}
                    >
                      <span
                        className="vector-ind-dot"
                        style={{ backgroundColor: on ? it.color : "transparent", borderColor: it.color }}
                        aria-hidden="true"
                      />
                      <span className="vector-ind-label">{label}</span>
                      {note ? <span className="vector-ind-note">{note}</span> : null}
                      <span className="vector-ind-check" aria-hidden="true">
                        {on ? "✓" : ""}
                      </span>
                    </button>
                    {/* Compact preset control — only matters (and only shown) once the member has
                        opening-range on, per the "no new toolbar chrome" placement call. */}
                    {isOpeningRange && on ? (
                      <div className="vector-ind-or-presets" role="group" aria-label="Opening range window">
                        {VECTOR_OPENING_RANGE_PRESETS.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={clsx(
                              "vector-ind-or-preset",
                              m === openingRangeMinutes && "vector-ind-or-preset-active"
                            )}
                            aria-pressed={m === openingRangeMinutes}
                            onClick={() => onOpeningRangeMinutes(m)}
                          >
                            {m}m
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
