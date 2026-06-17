"use client";

import { useMemo } from "react";
import { EmbedFrame } from "@/components/embeds/EmbedFrame";

const SPX_SYMBOL = "CBOE:SPX";

/** SPX-only chart — symbol locked, remounts clean so TV cannot stick on AAPL */
export function SpxChart({ height, fill }: { height?: number; fill?: boolean }) {
  const src = useMemo(() => {
    const config = {
      autosize: true,
      symbol: SPX_SYMBOL,
      interval: "1",
      timezone: "America/New_York",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: true,
      support_host: "https://www.tradingview.com",
      disabled_features: [
        "header_symbol_search",
        "symbol_search_hot_key",
        "compare_symbol",
        "header_compare",
      ],
      enabled_features: ["hide_left_toolbar_by_default"],
    };
    return `https://s.tradingview.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
  }, []);

  return (
    <EmbedFrame title="SPX · Live" subtitle="CBOE:SPX" variant="tv" className="spx-chart-frame">
      <iframe
        key="spx-sniper-chart"
        src={src}
        title="SPX Live Chart"
        className="w-full border-0"
        style={fill ? { height: "100%", minHeight: "calc(100vh - 280px)" } : { height: height ?? 620 }}
        allowTransparency
        loading="eager"
      />
    </EmbedFrame>
  );
}
