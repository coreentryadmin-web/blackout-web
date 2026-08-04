"use client";

import { clsx } from "clsx";
import type { DiscoveryFunnelHint } from "@/lib/zerodte/discovery-funnel-hint";
import type { MarketStateSnapshot } from "@/lib/zerodte/market-state-engine";

/** One mono stat pill — shared by governor / regime / calibration strips. */
export function GovPill({
  label,
  value,
  tone = "sky",
  title,
  compact = false,
}: {
  label: string;
  value: string;
  tone?: "sky" | "bull" | "bear" | "gold";
  title?: string;
  compact?: boolean;
}) {
  const toneCls: Record<string, string> = {
    sky: "border-sky-400/20 text-sky-100",
    bull: "border-bull/30 text-bull",
    bear: "border-bear/40 text-bear",
    gold: "border-gold/35 text-gold",
  };
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-baseline gap-1.5 rounded-lg border bg-void-deep/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        compact ? "px-1.5 py-0.5 gap-1" : "px-2.5 py-1.5",
        toneCls[tone],
      )}
    >
      <span className={clsx("font-mono uppercase tracking-[0.18em] text-sky-200", compact ? "text-[8px]" : "text-[9px]")}>
        {label}
      </span>
      <span className={clsx("t-num font-bold", compact ? "text-[10px]" : "text-[12px]")}>{value}</span>
    </span>
  );
}

/** Regime-adaptive discovery weights — honest provenance chip (Phase 2b). */
export function MarketStateStrip({
  ms,
  compact = false,
}: {
  ms: MarketStateSnapshot | null | undefined;
  compact?: boolean;
}) {
  if (!ms) return null;
  const w = ms.rail_weights;
  const active = ms.confidence > 0.05;
  return (
    <div
      className={clsx("nh-deck-context-strip", !compact && "mt-3 space-y-2", compact && "nh-deck-context-strip--compact")}
      data-testid="zerodte-market-state-strip"
      title={compact ? ms.summary : undefined}
    >
      <div className={clsx("flex items-center gap-1.5", compact ? "flex-nowrap" : "flex-wrap gap-2")}>
        <GovPill
          label="Regime"
          value={ms.regime_label ?? ms.regime_structure ?? "unknown"}
          tone={active ? "bull" : "sky"}
          title={ms.summary}
          compact={compact}
        />
        <GovPill label="FLOW" value={`×${w.FLOW}`} tone={w.FLOW > 1 ? "bull" : w.FLOW < 1 ? "gold" : "sky"} title="Merge rank weight" compact={compact} />
        <GovPill
          label="Breakout"
          value={`×${w.BREAKOUT}`}
          tone={w.BREAKOUT > 1 ? "bull" : w.BREAKOUT < 1 ? "gold" : "sky"}
          title="Merge rank weight"
          compact={compact}
        />
        <GovPill label="PIN" value={`×${w.PIN}`} tone={w.PIN > 1 ? "bull" : w.PIN < 1 ? "gold" : "sky"} title="Merge rank weight" compact={compact} />
        {active && (
          <GovPill
            label="Conf"
            value={`${Math.round(ms.confidence * 100)}%`}
            tone="sky"
            title="Regime clarity — low confidence keeps weights near equal"
            compact={compact}
          />
        )}
        {ms.calibration_shadow?.active && (
          <GovPill
            label="Cal shadow"
            value={`${Math.round(ms.calibration_shadow.blend * 100)}%`}
            tone="gold"
            title="Calibration origin-band priors blended into merge rank (shadow mode)"
            compact={compact}
          />
        )}
      </div>
      {!compact && <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">{ms.summary}</p>}
    </div>
  );
}

/** Phase 2c — top session rejection reason from discovery funnel. */
export function DiscoveryFunnelStrip({
  funnel,
  compact = false,
}: {
  funnel: DiscoveryFunnelHint | null | undefined;
  compact?: boolean;
}) {
  if (!funnel?.summary) return null;
  return (
    <p
      className={clsx(
        "nh-deck-context-strip font-mono uppercase tracking-widest text-sky-200",
        compact ? "nh-deck-funnel-compact" : "mt-2 text-[10px]",
      )}
      data-testid="zerodte-discovery-funnel-strip"
      title="Discovery funnel — why candidates didn't commit"
    >
      {compact ? funnel.summary : `Funnel · ${funnel.summary}`}
    </p>
  );
}
