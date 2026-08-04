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
}: {
  label: string;
  value: string;
  tone?: "sky" | "bull" | "bear" | "gold";
  title?: string;
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
        "inline-flex items-baseline gap-1.5 rounded-lg border bg-void-deep/80 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        toneCls[tone],
      )}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-200">{label}</span>
      <span className="t-num text-[12px] font-bold">{value}</span>
    </span>
  );
}

/** Regime-adaptive discovery weights — honest provenance chip (Phase 2b). */
export function MarketStateStrip({ ms }: { ms: MarketStateSnapshot | null | undefined }) {
  if (!ms) return null;
  const w = ms.rail_weights;
  const active = ms.confidence > 0.05;
  return (
    <div className="nh-deck-context-strip mt-3 space-y-2" data-testid="zerodte-market-state-strip">
      <div className="flex flex-wrap items-center gap-2">
        <GovPill
          label="Regime"
          value={ms.regime_label ?? ms.regime_structure ?? "unknown"}
          tone={active ? "bull" : "sky"}
          title={ms.summary}
        />
        <GovPill label="FLOW" value={`×${w.FLOW}`} tone={w.FLOW > 1 ? "bull" : w.FLOW < 1 ? "gold" : "sky"} title="Merge rank weight" />
        <GovPill
          label="Breakout"
          value={`×${w.BREAKOUT}`}
          tone={w.BREAKOUT > 1 ? "bull" : w.BREAKOUT < 1 ? "gold" : "sky"}
          title="Merge rank weight"
        />
        <GovPill label="PIN" value={`×${w.PIN}`} tone={w.PIN > 1 ? "bull" : w.PIN < 1 ? "gold" : "sky"} title="Merge rank weight" />
        {active && (
          <GovPill
            label="Conf"
            value={`${Math.round(ms.confidence * 100)}%`}
            tone="sky"
            title="Regime clarity — low confidence keeps weights near equal"
          />
        )}
        {ms.calibration_shadow?.active && (
          <GovPill
            label="Cal shadow"
            value={`${Math.round(ms.calibration_shadow.blend * 100)}%`}
            tone="gold"
            title="Calibration origin-band priors blended into merge rank (shadow mode)"
          />
        )}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">{ms.summary}</p>
    </div>
  );
}

/** Phase 2c — top session rejection reason from discovery funnel. */
export function DiscoveryFunnelStrip({ funnel }: { funnel: DiscoveryFunnelHint | null | undefined }) {
  if (!funnel?.summary) return null;
  return (
    <p
      className="nh-deck-context-strip mt-2 font-mono text-[10px] uppercase tracking-widest text-sky-200"
      data-testid="zerodte-discovery-funnel-strip"
      title="Discovery funnel — why candidates didn't commit"
    >
      Funnel · {funnel.summary}
    </p>
  );
}
