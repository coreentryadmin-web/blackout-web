import type { TickerFundamentalsBundle } from "@/lib/bie/ticker-fundamentals";
import type { MeridianFinancialsContext } from "@/features/meridian/lib/meridian-types";

function fmtPct(n: number | null | undefined, digits = 0): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/**
 * Map cached Polygon fundamentals bundle → Meridian earnings card slice.
 *
 * THE DEFECT (found 2026-08-30). `price_target_upside_pct` was hardcoded `null` here, always —
 * `BenzingaPriceTarget` (the type of `bundle.price_target`) carries only the raw dollar target,
 * never an upside, so there was never a value to forward. `MeridianEarningsIntelPanel.tsx`
 * gates the entire "Street PT $X (Y% upside)" line on
 * `financials.price_target != null && financials.price_target_upside_pct != null` — both must be
 * non-null — so with the second half permanently null, **that line never renders at all**, even on
 * a ticker with a real, live analyst price target. A field that always reads absent silently
 * deletes a whole feature rather than degrading it.
 *
 * THE FIX. The missing input is the current price, not a different provider field: upside is
 * `(target − spot) / spot`, and `spot` is already resolved at every call site in
 * `meridian-earnings-intel.ts` (from `pack.positioning.spot`/`thermal.spot`) — it was simply never
 * threaded into this function. `spot` is now an explicit second argument (optional, so existing
 * callers/tests that only care about the other fields keep compiling) and the percentage is
 * computed here, guarded the same way every other pct in this file is: both inputs finite, spot > 0
 * (an upside relative to a zero or negative spot is not a real percentage).
 */
export function buildMeridianFinancialsContext(
  bundle: TickerFundamentalsBundle | null,
  spot?: number | null
): MeridianFinancialsContext | null {
  if (!bundle) return null;
  const r = bundle.ratios;
  const s = bundle.signals;
  if (!r && !s) return null;

  const parts: string[] = [];
  if (r?.pe_ratio != null && Number.isFinite(r.pe_ratio)) parts.push(`P/E ${r.pe_ratio.toFixed(1)}`);
  if (r?.price_to_sales != null && Number.isFinite(r.price_to_sales)) parts.push(`P/S ${r.price_to_sales.toFixed(1)}`);
  if (r?.roe != null && Number.isFinite(r.roe)) {
    const roePct = Math.abs(r.roe) > 1 ? r.roe : r.roe * 100;
    parts.push(`ROE ${roePct.toFixed(0)}%`);
  }
  if (s?.revenue_yoy_pct != null) parts.push(`Rev ${fmtPct(s.revenue_yoy_pct)} YoY`);
  if (s?.net_margin_pct != null && Number.isFinite(s.net_margin_pct)) {
    const t =
      s.margin_trend === "expanding" ? " ↑" : s.margin_trend === "contracting" ? " ↓" : "";
    parts.push(`Net margin ${s.net_margin_pct.toFixed(0)}%${t}`);
  }
  if (s?.fcf_positive != null) {
    const t = s.fcf_trend === "rising" ? " ↑" : s.fcf_trend === "falling" ? " ↓" : "";
    parts.push(`FCF ${s.fcf_positive ? "+" : "−"}${t}`);
  }
  if (s?.net_cash_positive != null) parts.push(s.net_cash_positive ? "Net cash" : "Net debt");

  const priceTarget = bundle.price_target?.price_target ?? null;
  const priceTargetUpsidePct =
    priceTarget != null &&
    Number.isFinite(priceTarget) &&
    spot != null &&
    Number.isFinite(spot) &&
    spot > 0
      ? Number((((priceTarget - spot) / spot) * 100).toFixed(1))
      : null;

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
    price_target: priceTarget,
    price_target_upside_pct: priceTargetUpsidePct,
  };
}
