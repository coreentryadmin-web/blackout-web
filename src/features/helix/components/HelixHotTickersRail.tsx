import { useMemo } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { computeHelixHotTickers } from "@/features/helix/lib/helix-hot-tickers";

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
          const net = row.callPremium - row.putPremium;
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
              <span
                className={clsx(
                  "helix-hot-ticker-bias font-mono",
                  net > 0 && "text-bull",
                  net < 0 && "text-bear"
                )}
              >
                {net >= 0 ? "▲" : "▼"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
