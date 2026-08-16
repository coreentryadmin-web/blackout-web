import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { fmtPremium } from "@/lib/fmt-money";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchBenzingaCatalysts } from "@/lib/providers/polygon";
import {
  maxPainForExpiryFromHeatmap,
  summarizeHeatmapGammaByExpiry,
} from "@/lib/meridian/meridian-gex-reads";
import { readMeridianDeskLane } from "@/lib/meridian/meridian-desk-lane";
import type {
  MeridianFlowSkew,
  MeridianMacroBrief,
  MeridianMacroIndicatorRead,
  MeridianOpexDetail,
  MeridianOpexExpiryRead,
  MeridianSpxPositioning,
  MeridianFdaDetail,
} from "@/features/meridian/lib/meridian-types";
import { loadMeridianEarningsEnrichment } from "@/lib/meridian/meridian-earnings-enrich";

function flipDistancePts(spot: number | null, flip: number | null): number | null {
  if (spot == null || flip == null || !Number.isFinite(spot) || !Number.isFinite(flip)) return null;
  return Number(Math.abs(spot - flip).toFixed(2));
}

async function loadSpxPositioning(): Promise<MeridianSpxPositioning> {
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const pos = await getGexPositioning("SPX").catch(() => null);
  if (!pos) {
    return {
      available: false,
      spot: null,
      flip: null,
      flip_distance_pts: null,
      call_wall: null,
      put_wall: null,
      net_gex_label: null,
      gamma_regime: null,
    };
  }
  const spot = pos.spot ?? null;
  const flip = pos.flip ?? null;
  return {
    available: true,
    spot,
    flip,
    flip_distance_pts: flipDistancePts(spot, flip),
    call_wall: pos.call_wall ?? null,
    put_wall: pos.put_wall ?? null,
    net_gex_label:
      pos.net_gex != null && Number.isFinite(pos.net_gex) ? fmtPremium(pos.net_gex) : null,
    gamma_regime: pos.gamma_regime_read != null ? String(pos.gamma_regime_read) : null,
  };
}

async function loadTickerPositioning(ticker: string): Promise<MeridianSpxPositioning> {
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const pos = await getGexPositioning(ticker).catch(() => null);
  if (!pos) {
    return {
      available: false,
      spot: null,
      flip: null,
      flip_distance_pts: null,
      call_wall: null,
      put_wall: null,
      net_gex_label: null,
      gamma_regime: null,
    };
  }
  const spot = pos.spot ?? null;
  const flip = pos.flip ?? null;
  return {
    available: true,
    spot,
    flip,
    flip_distance_pts: flipDistancePts(spot, flip),
    call_wall: pos.call_wall ?? null,
    put_wall: pos.put_wall ?? null,
    net_gex_label:
      pos.net_gex != null && Number.isFinite(pos.net_gex) ? fmtPremium(pos.net_gex) : null,
    gamma_regime: pos.gamma_regime_read != null ? String(pos.gamma_regime_read) : null,
  };
}

async function loadIndexFlowSkew(ticker = "SPX"): Promise<MeridianFlowSkew> {
  const { marketPlatform } = await import("@/lib/platform");
  const flowRes = await marketPlatform.flows
    .getFlowTapeSummary({ limit: 60, ticker })
    .catch(() => null);
  let callPrem = 0;
  let putPrem = 0;
  const recent =
    (flowRes as { recent?: Array<{ premium?: number; option_type?: string }> } | null)?.recent ?? [];
  for (const row of recent) {
    const prem = Number(row.premium ?? 0);
    if (!Number.isFinite(prem)) continue;
    if (/call/i.test(String(row.option_type ?? ""))) callPrem += prem;
    else if (/put/i.test(String(row.option_type ?? ""))) putPrem += prem;
  }
  const net = callPrem - putPrem;
  const total = callPrem + putPrem;
  const ratio = putPrem > 0 ? callPrem / putPrem : callPrem > 0 ? null : null;
  const bias =
    total < 1
      ? ("unknown" as const)
      : net / total > 0.15
        ? ("bullish" as const)
        : net / total < -0.15
          ? ("bearish" as const)
          : ("neutral" as const);
  const summary =
    bias === "bullish"
      ? "Call premium dominates into the event window"
      : bias === "bearish"
        ? "Put premium dominates into the event window"
        : bias === "neutral"
          ? "Balanced flow in the lookback window"
          : `Insufficient ${ticker} flow in window`;
  return {
    available: flowRes != null && total >= 1,
    bias,
    summary,
    call_put_ratio: ratio != null && Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
    net_premium: total >= 1 ? net : null,
  };
}

function macroEventWindow(date: string, time: string | null): string | null {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  if (!Number.isFinite(hh)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const startH = Math.max(0, (hh ?? 8) - 1);
  const endH = Math.min(23, (hh ?? 8) + 3);
  return `${date.slice(5).replace("-", " ")} · ${pad(startH)}:${pad(mm ?? 0)} – ${pad(endH)}:${pad(mm ?? 0)} ET`;
}

function macroIndicatorIdForEvent(event: string): string | null {
  const u = event.toUpperCase();
  if (u.includes("CPI")) return "CPI";
  if (u.includes("NFP") || u.includes("PAYROLL") || u.includes("NONFARM")) return "PAYROLLS";
  if (u.includes("GDP")) return "GDP";
  if (u.includes("UNEMPLOY")) return "UNRATE";
  return null;
}

async function loadMacroIndicator(event: string): Promise<MeridianMacroIndicatorRead | null> {
  const id = macroIndicatorIdForEvent(event);
  if (!id) return null;

  const { loadSpxDesk } = await import("@/features/spx/lib/spx-desk-loader");
  const desk = await loadSpxDesk().catch(() => null);
  const fromDesk = desk?.macro_indicators?.find(
    (m) =>
      m.indicator.toUpperCase() === id ||
      m.label.toUpperCase().includes(id) ||
      (id === "PAYROLLS" && /payroll|nfp|nonfarm/i.test(m.label))
  );
  if (fromDesk) {
    return {
      label: fromDesk.label,
      latest_value: fromDesk.latest_value,
      prior_value: fromDesk.prior_value,
      change_pct: fromDesk.change_pct,
      as_of: fromDesk.as_of,
    };
  }

  const { fetchUwEconomyIndicator } = await import("@/lib/providers/unusual-whales");
  const snap = await fetchUwEconomyIndicator(id).catch(() => null);
  if (!snap) return null;
  return {
    label: snap.label,
    latest_value: snap.latest_value,
    prior_value: snap.prior_value,
    change_pct: snap.change_pct,
    as_of: snap.as_of,
  };
}

async function loadOpexExpiryRead(opexDate: string): Promise<MeridianOpexExpiryRead> {
  const today = todayEtYmd();
  const { fetchGexHeatmap } = await import("@/lib/providers/polygon-options-gex");
  const [hm, deskLane] = await Promise.all([
    fetchGexHeatmap("SPX").catch(() => null),
    readMeridianDeskLane(),
  ]);

  const maxPain = maxPainForExpiryFromHeatmap(hm, opexDate);
  const greekFromCells = summarizeHeatmapGammaByExpiry(hm?.gex?.cells, today);
  const greek = greekFromCells ?? deskLane.greek_exposure;
  const netFlowRows = deskLane.net_flow_by_expiry;
  const opexFlow = netFlowRows.find(
    (r) => String(r.expiry ?? r.expiration ?? "").slice(0, 10) === opexDate
  );
  const netCall = opexFlow ? Number(opexFlow.net_call_premium ?? opexFlow.call_premium ?? 0) : 0;
  const netPut = opexFlow ? Number(opexFlow.net_put_premium ?? opexFlow.put_premium ?? 0) : 0;
  const netFlowLabel =
    opexFlow && (Math.abs(netCall) > 0 || Math.abs(netPut) > 0)
      ? `Net flow into ${opexDate.slice(5)} expiry · calls ${fmtPremium(netCall)} / puts ${fmtPremium(netPut)}`
      : null;

  return {
    max_pain: maxPain,
    greek_headline: greek?.headline ?? null,
    pinned_expiry: greek?.pinned_expiry ?? null,
    pinned_pct: greek?.pinned_pct ?? null,
    net_flow_label: netFlowLabel,
  };
}

/** Structure-first brief for a macro catalyst (SPX positioning + flow skew + macro read). */
export async function buildMeridianMacroBrief(input: {
  event: string;
  date: string;
  time: string | null;
  impact: "high" | "medium" | "low";
  estimate?: string | null;
}): Promise<MeridianMacroBrief> {
  const [spx_positioning, flow, macro_indicator] = await Promise.all([
    loadSpxPositioning(),
    loadIndexFlowSkew("SPX"),
    loadMacroIndicator(input.event),
  ]);
  return roundFloats({
    kind: "macro",
    event: input.event,
    date: input.date,
    time: input.time,
    impact: input.impact,
    event_window: macroEventWindow(input.date, input.time),
    estimate: input.estimate?.trim() || null,
    macro_indicator,
    spx_positioning,
    flow,
    as_of: new Date().toISOString(),
  });
}

/** OpEx structure read — walls, max pain, gamma pin, expiry net flow. */
export async function buildMeridianOpexDetail(date: string): Promise<MeridianOpexDetail> {
  const [spx_positioning, expiry_read] = await Promise.all([
    loadSpxPositioning(),
    loadOpexExpiryRead(date),
  ]);
  return roundFloats({
    kind: "opex",
    date,
    title: "Monthly OpEx",
    spx_positioning,
    expiry_read,
    as_of: new Date().toISOString(),
  });
}

/** FDA decision window — ticker structure, flow, and recent catalyst headlines. */
export async function buildMeridianFdaDetail(input: {
  ticker: string;
  date: string;
  drug?: string | null;
  indication?: string | null;
}): Promise<MeridianFdaDetail> {
  const ticker = input.ticker.toUpperCase();
  const [positioning, flow, catalystRows] = await Promise.all([
    loadTickerPositioning(ticker),
    loadIndexFlowSkew(ticker),
    fetchBenzingaCatalysts(ticker, 6).catch(() => []),
  ]);
  const drug = input.drug?.trim() || null;
  const indication = input.indication?.trim() || null;
  return roundFloats({
    kind: "fda",
    ticker,
    title: `${ticker} FDA`,
    date: input.date,
    drug,
    indication,
    catalysts: catalystRows.slice(0, 6).map((c) => ({
      title: c.title,
      channel: c.channel ?? c.type ?? null,
      published: c.published ?? null,
    })),
    positioning,
    flow,
    as_of: new Date().toISOString(),
  });
}

export { loadMeridianEarningsEnrichment };
