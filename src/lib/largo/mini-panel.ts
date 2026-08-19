/**
 * Answer-adjacent live mini-panels — same cache readers as HELIX/Thermal desks.
 */

import type { DeskMiniPanelKind, DeskScopeKey } from "@/lib/largo/desk-scope";
import { deskScopeConfig } from "@/lib/largo/desk-scope";
import { fmtPremium } from "@/lib/fmt-money";

export type MiniPanelRow = {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "neutral" | "warn";
};

export type LargoMiniPanelPayload = {
  kind: DeskMiniPanelKind;
  desk: string;
  label: string;
  ticker: string;
  as_of: string;
  href: string | null;
  rows: MiniPanelRow[];
  stale?: boolean;
};

function biasTone(bias: string | null | undefined): MiniPanelRow["tone"] {
  const b = (bias ?? "").toLowerCase();
  if (b.includes("bull")) return "bull";
  if (b.includes("bear")) return "bear";
  if (b.includes("mixed") || b.includes("conflict")) return "warn";
  return "neutral";
}

export async function fetchMiniPanelPayload(input: {
  desk: string;
  ticker?: string;
}): Promise<LargoMiniPanelPayload | null> {
  const cfg = deskScopeConfig(input.desk);
  if (!cfg) return null;
  const ticker = (input.ticker ?? cfg.defaultTicker).toUpperCase();
  const as_of = new Date().toISOString();
  const base: LargoMiniPanelPayload = {
    kind: cfg.miniPanel,
    desk: cfg.key,
    label: cfg.label,
    ticker,
    as_of,
    href: cfg.href,
    rows: [],
  };

  try {
    switch (cfg.key as DeskScopeKey) {
      case "spx-slayer": {
        const { marketPlatform } = await import("@/lib/platform");
        const [play, gexMod] = await Promise.all([
          marketPlatform.spx.getSpxPlayState().catch(() => null),
          import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
        ]);
        const gex = gexMod as {
          spot?: number;
          flip?: number;
          call_wall?: number;
          put_wall?: number;
        } | null;
        const p = play as {
          phase?: string;
          action?: string;
          grade?: string;
          spot?: number;
        } | null;
        base.rows = [
          { label: "Spot", value: gex?.spot != null ? String(Math.round(gex.spot)) : p?.spot != null ? String(Math.round(p.spot)) : "—" },
          { label: "Flip", value: gex?.flip != null ? String(Math.round(gex.flip)) : "—" },
          { label: "Call wall", value: gex?.call_wall != null ? String(Math.round(gex.call_wall)) : "—" },
          { label: "Put wall", value: gex?.put_wall != null ? String(Math.round(gex.put_wall)) : "—" },
          {
            label: "Play",
            value: [p?.phase, p?.action, p?.grade].filter(Boolean).join(" · ") || "—",
            tone: (p?.action ?? "").toLowerCase().includes("short") ? "bear" : "bull",
          },
        ];
        break;
      }
      case "helix": {
        const { flowBriefForLargo, helixTapeAnalyticsForLargo } = await import("@/lib/largo/product-reads");
        const [brief, analytics] = await Promise.all([
          flowBriefForLargo(),
          helixTapeAnalyticsForLargo(ticker === "SPX" ? null : ticker, 120),
        ]);
        const b = brief as { net_premium?: number; bias?: string; whale_count?: number } | null;
        const a = analytics as {
          biggest_print?: { premium?: number; strike?: number; option_type?: string };
          tide?: string;
        } | null;
        const bp = a?.biggest_print;
        base.rows = [
          {
            label: "Net premium",
            value: b?.net_premium != null ? fmtPremium(b.net_premium) : "—",
            tone: (b?.net_premium ?? 0) >= 0 ? "bull" : "bear",
          },
          { label: "Bias", value: b?.bias ?? "—", tone: biasTone(b?.bias) },
          { label: "Whales", value: b?.whale_count != null ? String(b.whale_count) : "—" },
          {
            label: "Top print",
            value: bp?.premium
              ? `${bp.option_type ?? ""} ${bp.strike ?? ""} · ${fmtPremium(bp.premium)}`.trim()
              : "—",
          },
          { label: "Tide", value: a?.tide ?? "—", tone: biasTone(a?.tide) },
        ];
        break;
      }
      case "thermal": {
        const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
        const pos = await getGexPositioning(ticker).catch(() => null);
        base.rows = [
          { label: "Spot", value: pos?.spot != null ? String(Math.round(pos.spot)) : "—" },
          { label: "Flip", value: pos?.flip != null ? String(Math.round(pos.flip)) : "—" },
          { label: "Call wall", value: pos?.call_wall != null ? String(Math.round(pos.call_wall)) : "—" },
          { label: "Put wall", value: pos?.put_wall != null ? String(Math.round(pos.put_wall)) : "—" },
          {
            label: "Net GEX",
            value: pos?.net_gex != null ? fmtPremium(pos.net_gex) : "—",
            tone: (pos?.net_gex ?? 0) >= 0 ? "bull" : "bear",
          },
        ];
        break;
      }
      case "vector": {
        const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
        const state = await fetchVectorFullState(ticker).catch(() => null);
        const play = state?.play;
        base.rows = [
          { label: "Spot", value: state?.spot != null ? String(Math.round(state.spot)) : "—" },
          {
            label: "Regime",
            value: state?.regime?.posture ?? "—",
            tone: biasTone(state?.regime?.posture),
          },
          {
            label: "Flip",
            value: state?.gammaFlip != null ? String(Math.round(state.gammaFlip)) : "—",
          },
          {
            label: "Play",
            value: play ? [play.grade, play.bias].filter(Boolean).join(" · ") || "—" : "—",
          },
        ];
        break;
      }
      case "nighthawk": {
        const zerodte = await import("@/lib/platform/zerodte-service")
          .then((m) => m.zeroDtePlaysForLargo())
          .catch(() => null);
        const plays = (zerodte as { plays?: Array<{ ticker?: string; status?: string; pnl_pct?: number }> } | null)?.plays ?? [];
        const open = plays.filter((p) => !/closed|graded/i.test(String(p.status ?? "")));
        const top = [...open].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))[0];
        base.rows = [
          { label: "Open", value: String(open.length) },
          {
            label: "Top P&L",
            value: top
              ? `${top.ticker ?? ""} ${top.pnl_pct != null ? `${top.pnl_pct >= 0 ? "+" : ""}${top.pnl_pct.toFixed(1)}%` : ""}`.trim()
              : "—",
            tone: (top?.pnl_pct ?? 0) >= 0 ? "bull" : "bear",
          },
          { label: "Board", value: plays.length ? `${plays.length} plays` : "—" },
        ];
        break;
      }
      case "meridian": {
        const { meridianTimelineForLargo } = await import("@/lib/largo/meridian-for-largo");
        const timeline = await meridianTimelineForLargo(3).catch(() => null);
        const events = (timeline as { events?: Array<{ title?: string; when?: string }> } | null)?.events ?? [];
        const next = events[0];
        base.rows = [
          { label: "Next", value: next?.title ?? "—" },
          { label: "When", value: next?.when ?? "—" },
          { label: "Events", value: events.length ? String(events.length) : "—" },
        ];
        break;
      }
      default:
        base.rows = [{ label: "Desk", value: cfg.label }];
    }
  } catch {
    return { ...base, rows: [{ label: "Status", value: "Unavailable" }], stale: true };
  }

  if (!base.rows.length) return null;
  return base;
}
