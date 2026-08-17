import type { TickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import type { MeridianFinancialsContext } from "@/features/meridian/lib/meridian-types";

function fmtPct(n: number | null | undefined, digits = 0): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** Map cached Polygon fundamentals bundle → Meridian earnings card slice. */
export function buildMeridianFinancialsContext(
  bundle: TickerFundamentalsBundle | null
): MeridianFinancialsContext | null {
  if (!bundle) return null;
  const r = bundle.ratios;
  const s = bundle.signals;
  if (!r && !s) return null;

  const parts: string[] = [];
  if (r?.pe_ratio != null) parts.push(`P/E ${r.pe_ratio.toFixed(1)}`);
  if (r?.price_to_sales != null) parts.push(`P/S ${r.price_to_sales.toFixed(1)}`);
  if (r?.roe != null) {
    const roePct = Math.abs(r.roe) > 1 ? r.roe : r.roe * 100;
    parts.push(`ROE ${roePct.toFixed(0)}%`);
  }
  if (s?.revenue_yoy_pct != null) parts.push(`Rev ${fmtPct(s.revenue_yoy_pct)} YoY`);
  if (s?.net_margin_pct != null) {
    const t =
      s.margin_trend === "expanding" ? " ↑" : s.margin_trend === "contracting" ? " ↓" : "";
    parts.push(`Net margin ${s.net_margin_pct.toFixed(0)}%${t}`);
  }
  if (s?.fcf_positive != null) {
    const t = s.fcf_trend === "rising" ? " ↑" : s.fcf_trend === "falling" ? " ↓" : "";
    parts.push(`FCF ${s.fcf_positive ? "+" : "−"}${t}`);
  }
  if (s?.net_cash_positive != null) parts.push(s.net_cash_positive ? "Net cash" : "Net debt");

  return {
    available: true,
    as_of: bundle.as_of,
    headline: parts.length ? parts.join(" · ") : null,
    pe_ratio: r?.pe_ratio ?? null,
    price_to_sales: r?.price_to_sales ?? null,
    roe_pct: r?.roe != null ? (Math.abs(r.roe) > 1 ? r.roe : r.roe * 100) : null,
    revenue_yoy_pct: s?.revenue_yoy_pct ?? null,
    net_margin_pct: s?.net_margin_pct ?? null,
    margin_trend: s?.margin_trend ?? null,
    fcf_positive: s?.fcf_positive ?? null,
    fcf_trend: s?.fcf_trend ?? null,
    eps_trajectory: s?.eps_trajectory ?? null,
    net_cash_positive: s?.net_cash_positive ?? null,
    price_target: bundle.price_target?.price_target ?? null,
    price_target_upside_pct: null,
  };
}
