import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { fmtPremium } from "@/lib/fmt-money";
import type {
  MeridianFlowSkew,
  MeridianMacroBrief,
  MeridianOpexDetail,
  MeridianSpxPositioning,
} from "@/features/meridian/lib/meridian-types";

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

async function loadIndexFlowSkew(): Promise<MeridianFlowSkew> {
  const { marketPlatform } = await import("@/lib/platform");
  const flowRes = await marketPlatform.flows
    .getFlowTapeSummary({ limit: 60, ticker: "SPX" })
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
          ? "Balanced index flow in the lookback window"
          : "Insufficient SPX flow in window";
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

/** Structure-first brief for a macro catalyst (SPX positioning + flow skew). */
export async function buildMeridianMacroBrief(input: {
  event: string;
  date: string;
  time: string | null;
  impact: "high" | "medium" | "low";
}): Promise<MeridianMacroBrief> {
  const [spx_positioning, flow] = await Promise.all([loadSpxPositioning(), loadIndexFlowSkew()]);
  return roundFloats({
    kind: "macro",
    event: input.event,
    date: input.date,
    time: input.time,
    impact: input.impact,
    event_window: macroEventWindow(input.date, input.time),
    spx_positioning,
    flow,
    as_of: new Date().toISOString(),
  });
}

/** OpEx uses the same SPX structure read — charm/pin risk into expiry. */
export async function buildMeridianOpexDetail(date: string): Promise<MeridianOpexDetail> {
  const spx_positioning = await loadSpxPositioning();
  return roundFloats({
    kind: "opex",
    date,
    title: "Monthly OpEx",
    spx_positioning,
    as_of: new Date().toISOString(),
  });
}
