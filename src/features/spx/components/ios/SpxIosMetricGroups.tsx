"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import { priceVsLevel, PriceLevelIndicator } from "../SpxLiveSpotPrice";
import { SPX_DESK_MAX_PAIN_LABEL_IOS } from "@/features/spx/lib/spx-metric-labels";

type Props = {
  desk?: SpxDeskPayload;
  showValues: boolean;
  spot: number | null;
  defaultCollapsed?: boolean;
};

type GroupId = "market" | "technical" | "dealer" | "volatility";

function MetricRow({
  label,
  value,
  tone = "neutral",
  spot,
  level,
}: {
  label: string;
  value: string;
  tone?: string;
  spot?: number | null;
  level?: number | null;
}) {
  const toneClass =
    tone === "bull"
      ? "text-emerald-300"
      : tone === "bear"
        ? "text-rose-300"
        : tone === "gold"
          ? "text-gold"
          : tone === "violet"
            ? "text-violet-200"
            : tone === "orange"
              ? "text-orange-300"
              : "text-white";
  return (
    <div className="spx-ios-metric-row">
      <span className="spx-ios-metric-label">{label}</span>
      <span className={clsx("spx-ios-metric-value t-num", toneClass)}>
        {level != null && spot != null ? <PriceLevelIndicator direction={priceVsLevel(spot, level)} /> : null}
        {value}
      </span>
    </div>
  );
}

/** Four grouped metric cards — hierarchy over twelve equal pills. */
export function SpxIosMetricGroups({ desk, showValues, spot, defaultCollapsed = true }: Props) {
  const [open, setOpen] = useState<Set<GroupId>>(() =>
    defaultCollapsed ? new Set() : new Set(["market", "technical", "dealer", "volatility"])
  );

  const toggle = (id: GroupId) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groups: Array<{ id: GroupId; title: string; rows: React.ReactNode }> = [
    {
      id: "market",
      title: "Market",
      rows: (
        <>
          <MetricRow label="Trend" value={showValues ? (desk?.regime ?? "—") : "—"} tone="violet" />
          <MetricRow
            label="VIX"
            value={showValues && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"}
            tone="orange"
          />
        </>
      ),
    },
    {
      id: "technical",
      title: "Technical",
      rows: (
        <>
          <MetricRow
            label="VWAP"
            value={showValues ? fmtPrice(desk?.vwap ?? null) : "—"}
            tone={desk?.vwap != null && spot != null ? (spot >= desk.vwap ? "bull" : "bear") : "neutral"}
            spot={spot}
            level={desk?.vwap ?? null}
          />
          <MetricRow label="EMA 20" value={showValues ? fmtPrice(desk?.ema20 ?? null) : "—"} spot={spot} level={desk?.ema20 ?? null} />
          <MetricRow label="EMA 50" value={showValues ? fmtPrice(desk?.ema50 ?? null) : "—"} spot={spot} level={desk?.ema50 ?? null} />
          <MetricRow label="SMA 50" value={showValues ? fmtPrice(desk?.sma50 ?? null) : "—"} spot={spot} level={desk?.sma50 ?? null} />
          <MetricRow label="HOD" value={showValues ? fmtPrice(desk?.hod ?? null) : "—"} spot={spot} level={desk?.hod ?? null} />
          <MetricRow label="LOD" value={showValues ? fmtPrice(desk?.lod ?? null) : "—"} spot={spot} level={desk?.lod ?? null} />
        </>
      ),
    },
    {
      id: "dealer",
      title: "Dealer",
      rows: (
        <>
          <MetricRow
            label="Gamma"
            value={showValues && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
            tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
          />
          <MetricRow label="Flip" value={showValues ? fmtPrice(desk?.gamma_flip ?? null) : "—"} spot={spot} level={desk?.gamma_flip ?? null} />
          <MetricRow label={SPX_DESK_MAX_PAIN_LABEL_IOS} value={showValues ? fmtPrice(desk?.max_pain ?? null) : "—"} spot={spot} level={desk?.max_pain ?? null} />
        </>
      ),
    },
    {
      id: "volatility",
      title: "Volatility",
      rows: (
        <MetricRow
          label="IV rank"
          value={showValues && desk?.uw_iv_rank != null ? fmtPrice(desk.uw_iv_rank, 0) : "—"}
          tone="gold"
        />
      ),
    },
  ];

  return (
    <div className="spx-ios-metric-groups" aria-label="Desk metrics">
      {groups.map((g) => {
        const expanded = open.has(g.id);
        return (
          <section key={g.id} className="spx-ios-metric-group">
            <button
              type="button"
              className="spx-ios-metric-group-head"
              aria-expanded={expanded}
              onClick={() => toggle(g.id)}
            >
              <span>{g.title}</span>
              <span className="spx-ios-metric-group-chevron" aria-hidden>
                {expanded ? "▾" : "▸"}
              </span>
            </button>
            {expanded ? <div className="spx-ios-metric-group-body">{g.rows}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
