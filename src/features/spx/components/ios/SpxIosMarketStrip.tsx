"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { dayChangeTextClass, fmtPct, fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  sessionActive?: boolean;
};

function gammaRegimeChip(desk?: SpxDeskPayload): string | null {
  if (desk?.gex_net != null) {
    return desk.gex_net >= 0 ? "Positive gamma" : "Negative gamma";
  }
  if (desk?.gamma_regime === "mean_revert") return "Long gamma";
  if (desk?.gamma_regime === "amplification") return "Short gamma";
  return null;
}

function localRegimeChip(desk?: SpxDeskPayload): string | null {
  if (desk?.gamma_regime === "amplification") return "Amplification";
  if (desk?.gamma_regime === "mean_revert") return "Mean revert";
  return null;
}

/** Compact top rail — SPX spot + live state chips (sticky under native header). */
export function SpxIosMarketStrip({ desk, live, sessionActive }: Props) {
  const hasQuote = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  const showValues = Boolean(live || hasQuote);
  const changeTone = dayChangeTextClass(desk?.spx_change_pct ?? null);
  const aboveVwap =
    desk?.vwap != null && desk?.price != null
      ? desk.price >= desk.vwap
      : Boolean(desk?.above_vwap);
  const gammaChip = gammaRegimeChip(desk);
  const localChip = localRegimeChip(desk);

  return (
    <div className="spx-ios-market-strip" aria-label="Live market summary">
      <div className="spx-ios-market-strip-main">
        <span className="spx-ios-market-strip-ticker">SPX</span>
        <span className={clsx("spx-ios-market-strip-price t-num", changeTone)}>
          {showValues ? fmtPrice(desk?.price ?? null, 2) : "—"}
        </span>
        <span className={clsx("spx-ios-market-strip-pct t-num", changeTone)}>
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
        {showValues && gammaChip ? (
          <span
            className={clsx(
              "spx-ios-market-chip",
              desk?.gex_net != null && desk.gex_net >= 0 ? "spx-ios-market-chip-bull" : "spx-ios-market-chip-bear"
            )}
          >
            {gammaChip}
          </span>
        ) : null}
        {showValues && localChip && localChip !== gammaChip ? (
          <span className="spx-ios-market-chip spx-ios-market-chip-neutral">{localChip}</span>
        ) : null}
        {showValues && desk?.vwap != null ? (
          <span className={clsx("spx-ios-market-chip", aboveVwap ? "spx-ios-market-chip-bull" : "spx-ios-market-chip-bear")}>
            {aboveVwap ? "Above VWAP" : "Below VWAP"}
          </span>
        ) : null}
        {showValues && desk?.regime && desk.regime !== "unknown" ? (
          <span className="spx-ios-market-chip spx-ios-market-chip-neutral capitalize">{desk.regime}</span>
        ) : null}
      </div>
    </div>
  );
}
