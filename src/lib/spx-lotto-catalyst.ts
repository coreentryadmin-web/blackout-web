import type { MacroEvent } from "@/lib/providers/finnhub";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import {
  playLottoFlowMinNotional,
  playLottoGapMinPct,
  playLottoMinDirectionSignals,
} from "@/lib/spx-play-config";

export type LottoDirectionSignal = {
  id: string;
  direction: SpxPlayDirection;
  label: string;
};

export type LottoCatalystHit = {
  id: string;
  label: string;
  direction: SpxPlayDirection | "neutral";
};

export type LottoCatalystEvaluation = {
  qualified: boolean;
  direction: SpxPlayDirection | null;
  catalysts: LottoCatalystHit[];
  direction_signals: LottoDirectionSignal[];
  catalyst_summary: string;
  confidence: number;
  reason: string;
};

const MACRO_RE =
  /\b(CPI|FOMC|FED|PCE|NFP|NONFARM|JOBS|PAYROLL|PPI|GDP|RETAIL SALES|ISM|PMI|UNEMPLOYMENT|CLAIMS)\b/i;

function gapPct(desk: SpxDeskPayload): number | null {
  const pdc = desk.prior_close;
  if (pdc == null || pdc <= 0 || desk.price <= 0) return null;
  return ((desk.price - pdc) / pdc) * 100;
}

function flowSkew(desk: SpxDeskPayload): { direction: SpxPlayDirection | null; notional: number; label: string } {
  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) >= playLottoFlowMinNotional()) {
    return {
      direction: net > 0 ? "long" : "short",
      notional: Math.abs(net),
      label: `$${(Math.abs(net) / 1_000_000).toFixed(1)}M 0DTE flow skew`,
    };
  }

  let bull = 0;
  let bear = 0;
  for (const f of desk.spx_flows?.slice(0, 12) ?? []) {
    if (f.direction === "bullish" || f.option_type.toUpperCase().startsWith("C")) bull += f.premium;
    else bear += f.premium;
  }
  const total = bull + bear;
  if (total < playLottoFlowMinNotional()) {
    return { direction: null, notional: total, label: "Flow below catalyst floor" };
  }
  if (bull > bear * 1.15) return { direction: "long", notional: total, label: `$${(total / 1_000_000).toFixed(1)}M call-led tape` };
  if (bear > bull * 1.15) return { direction: "short", notional: total, label: `$${(total / 1_000_000).toFixed(1)}M put-led tape` };
  return { direction: null, notional: total, label: "Flow mixed" };
}

function macroCatalysts(events: MacroEvent[]): LottoCatalystHit[] {
  const hits: LottoCatalystHit[] = [];
  for (const ev of events) {
    const title = `${ev.event} ${ev.country}`.toUpperCase();
    if (!MACRO_RE.test(title)) continue;
    hits.push({
      id: `macro:${ev.event}`,
      label: `Macro: ${ev.event}`,
      direction: "neutral",
    });
  }
  return hits;
}

function darkPoolDirection(desk: SpxDeskPayload): SpxPlayDirection | null {
  const dp = desk.dark_pool;
  if (!dp) return null;
  const call = dp.call_premium ?? 0;
  const put = dp.put_premium ?? 0;
  const total = call + put;
  if (total < 500_000) return null;
  if (call > put * 2) return "long";
  if (put > call * 2) return "short";
  if (dp.bias === "bullish") return "long";
  if (dp.bias === "bearish") return "short";
  return null;
}

function technicalDirection(desk: SpxDeskPayload): { direction: SpxPlayDirection | null; label: string } {
  const price = desk.price;
  if (price <= 0) return { direction: null, label: "No price" };

  const pdc = desk.prior_close;
  const gap = gapPct(desk);
  const wall = desk.gex_walls?.[0];

  if (gap != null && Math.abs(gap) >= playLottoGapMinPct()) {
    return {
      direction: gap > 0 ? "long" : "short",
      label: `Gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}% vs prior close`,
    };
  }

  if (desk.vwap != null) {
    if (price >= desk.vwap && desk.pdh != null && price > desk.pdh - 5) {
      return { direction: "long", label: `Above VWAP ${desk.vwap.toFixed(0)} / PDH context` };
    }
    if (price <= desk.vwap && desk.pdl != null && price < desk.pdl + 5) {
      return { direction: "short", label: `Below VWAP ${desk.vwap.toFixed(0)} / PDL context` };
    }
  }

  if (wall) {
    if (wall.kind === "support" && price >= wall.strike - 8) {
      return { direction: "long", label: `At GEX support ${wall.strike.toFixed(0)}` };
    }
    if (wall.kind === "resistance" && price <= wall.strike + 8) {
      return { direction: "short", label: `At GEX resistance ${wall.strike.toFixed(0)}` };
    }
  }

  if (pdc != null) {
    return {
      direction: price >= pdc ? "long" : "short",
      label: `${price >= pdc ? "Above" : "Below"} prior close ${pdc.toFixed(0)}`,
    };
  }

  return { direction: null, label: "Structure unclear" };
}

export function evaluateLottoCatalysts(desk: SpxDeskPayload): LottoCatalystEvaluation {
  const catalysts: LottoCatalystHit[] = [];
  const direction_signals: LottoDirectionSignal[] = [];

  catalysts.push(...macroCatalysts(desk.macro_events ?? []));

  const flow = flowSkew(desk);
  if (flow.direction) {
    catalysts.push({ id: "flow", label: flow.label, direction: flow.direction });
    direction_signals.push({ id: "flow", direction: flow.direction, label: flow.label });
  }

  const gap = gapPct(desk);
  if (gap != null && Math.abs(gap) >= playLottoGapMinPct()) {
    const dir: SpxPlayDirection = gap > 0 ? "long" : "short";
    const gapLabel =
      desk.gap_source === "SPY"
        ? `SPY premarket gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}%`
        : `SPX gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)}%`;
    catalysts.push({
      id: "gap",
      label: gapLabel,
      direction: dir,
    });
    direction_signals.push({ id: "gap", direction: dir, label: gapLabel });
  }

  const dpDir = darkPoolDirection(desk);
  if (dpDir) {
    const label = `Dark pool ${desk.dark_pool?.bias ?? dpDir} accumulation`;
    catalysts.push({ id: "dark_pool", label, direction: dpDir });
    direction_signals.push({ id: "dark_pool", direction: dpDir, label });
  }

  if (desk.vix_term?.structure === "backwardation") {
    catalysts.push({
      id: "vix",
      label: "VIX backwardation — vol expansion bid",
      direction: "neutral",
    });
  }

  const tech = technicalDirection(desk);
  if (tech.direction) {
    direction_signals.push({ id: "technical", direction: tech.direction, label: tech.label });
  }

  const longVotes = direction_signals.filter((s) => s.direction === "long").length;
  const shortVotes = direction_signals.filter((s) => s.direction === "short").length;
  const minDir = playLottoMinDirectionSignals();

  let direction: SpxPlayDirection | null = null;
  if (longVotes >= minDir && longVotes > shortVotes) direction = "long";
  else if (shortVotes >= minDir && shortVotes > longVotes) direction = "short";

  const qualified = catalysts.length >= 1 && direction != null;
  const catalyst_summary = catalysts.map((c) => c.label).join(" · ") || "No catalyst";
  const confidence = Math.min(
    96,
    catalysts.length * 18 + Math.max(longVotes, shortVotes) * 12 + (qualified ? 10 : 0)
  );

  const reason = !qualified
    ? catalysts.length < 1
      ? "No catalyst-tier signal — drift day"
      : `Direction split (${longVotes}L / ${shortVotes}S) — need ${minDir}+ aligned`
    : "Catalyst + direction aligned";

  return {
    qualified,
    direction,
    catalysts,
    direction_signals,
    catalyst_summary,
    confidence,
    reason,
  };
}
