"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPct, fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  sessionActive?: boolean;
};

/** Compact one-row market read — ~72pt, not a hero card. */
export function SpxIosMarketStrip({ desk, live, sessionActive }: Props) {
  const hasQuote = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  const showValues = Boolean(live || hasQuote);
  const bull = (desk?.spx_change_pct ?? 0) >= 0;
  const aboveVwap =
    desk?.vwap != null && desk?.price != null
      ? desk.price >= desk.vwap
      : Boolean(desk?.above_vwap);
  const gexPositive = (desk?.gex_net ?? 0) >= 0;

  return (
    <div className="spx-ios-market-strip" aria-label="Live market summary">
      <div className="spx-ios-market-strip-main">
        <span className="spx-ios-market-strip-ticker">SPX</span>
        <span className={clsx("spx-ios-market-strip-price t-num", bull ? "text-bull" : "text-bear-text")}>
          {showValues ? fmtPrice(desk?.price ?? null, 2) : "—"}
        </span>
        <span className={clsx("spx-ios-market-strip-pct t-num", bull ? "text-bull" : "text-bear-text")}>
          {showValues ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
        </span>
      </div>
      <div className="spx-ios-market-strip-chips">
        {sessionActive && live ? (
          <span className="spx-ios-market-chip spx-ios-market-chip-live">
            <span className="spx-ios-live-dot" aria-hidden />
            Live
          </span>
        ) : null}
        {showValues && desk?.gex_net != null ? (
          <span className={clsx("spx-ios-market-chip", gexPositive ? "spx-ios-market-chip-bull" : "spx-ios-market-chip-bear")}>
            {gexPositive ? "Positive gamma" : "Negative gamma"}
          </span>
        ) : null}
        {showValues && desk?.vwap != null ? (
          <span className={clsx("spx-ios-market-chip", aboveVwap ? "spx-ios-market-chip-bull" : "spx-ios-market-chip-bear")}>
            {aboveVwap ? "Above VWAP" : "Below VWAP"}
          </span>
        ) : null}
        {showValues && desk?.regime ? (
          <span className="spx-ios-market-chip spx-ios-market-chip-neutral capitalize">{desk.regime}</span>
        ) : null}
      </div>
    </div>
  );
}
