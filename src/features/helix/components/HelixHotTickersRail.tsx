import { useMemo } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { computeHelixHotTickers } from "@/features/helix/lib/helix-hot-tickers";
import { directionTone } from "@/features/helix/lib/helix-direction-read";

export function HelixHotTickersRail({
  flows,
  activeTicker,
  onSelect,
  className,
}: {
  flows: ReadonlyArray<FlowAlert>;
  activeTicker: string;
  onSelect: (ticker: string) => void;
  className?: string;
}) {
  const hot = useMemo(() => computeHelixHotTickers(flows), [flows]);

  if (hot.length === 0) return null;

  return (
    <div className={clsx("helix-hot-tickers", className)} aria-label="Hot tickers by premium">
      <span className="helix-hot-tickers-label">Hot</span>
      <div className="helix-hot-tickers-rail">
        {hot.map((row) => {
          const active = activeTicker === row.ticker;
          // Aggression-aware read, matching NetPremiumLeaderboard/ExpiryConcentration — NOT the
          // raw callPremium - putPremium sign, which reads a sold call as bullish. A neutral
          // (unreadable-majority) verdict renders no arrow at all rather than a guessed one.
          const tone = directionTone(row.direction);
          return (
            <button
              key={row.ticker}
              type="button"
              onClick={() => onSelect(active ? "" : row.ticker)}
              className={clsx("helix-hot-ticker-chip", active && "helix-hot-ticker-chip--active")}
              title={`${row.printCount} prints · ${fmtPremium(row.totalPremium)} total`}
            >
              <span className="helix-hot-ticker-symbol">{row.ticker}</span>
              <span className="helix-hot-ticker-prem font-mono">{fmtPremium(row.totalPremium)}</span>
              {tone != null && (
                <span
                  className={clsx(
                    "helix-hot-ticker-bias font-mono",
                    tone === "bull" && "text-bull",
                    tone === "bear" && "text-bear"
                  )}
                >
                  {tone === "bull" ? "▲" : "▼"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
