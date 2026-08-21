/**
 * Answer-adjacent live mini-panels — same cache readers as HELIX/Thermal desks.
 */

import type { DeskMiniPanelKind, DeskScopeKey } from "@/lib/largo/desk-scope";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { deskScopeConfig } from "@/lib/largo/desk-scope";
import { resolveSubmodule } from "@/lib/largo/slash-submodules";
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
  /** Active submodule slice when scoped via `/desk submodule`. */
  submodule?: string | null;
  ticker: string;
  /** ET wall-clock stamp for when this panel was built — NOT a UTC ISO. */
  as_of: string;
  /** The ET SESSION this panel belongs to (YYYY-MM-DD). */
  session_date?: string | null;
  /** Machine-orderable UTC instant, kept alongside the ET stamp. */
  as_of_utc?: string;
  /** Set by reads backed by a cached snapshot — when that SOURCE was computed (raw ISO). */
  source_asof?: string | null;
  /** That source time as an ET wall-clock stamp. */
  source_asof_et?: string | null;
  /** The ET SESSION that source belongs to. */
  source_session_date?: string | null;
  /** How fresh the underlying read is (e.g. "cached" for a strict cache reader). */
  freshness?: string | null;
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
  submodule?: string | null;
}): Promise<LargoMiniPanelPayload | null> {
  const cfg = deskScopeConfig(input.desk);
  if (!cfg) return null;
  const ticker = (input.ticker ?? cfg.defaultTicker).toUpperCase();
  const sub = resolveSubmodule(cfg.key, input.submodule ?? "");
  // ET-anchored, not a UTC ISO. A UTC instant rolls its calendar DATE at 20:00 ET, so anything
  // resolving "which session is this" from it is a full session ahead for the last four hours of
  // every trading day. `as_of` here is carried but not currently rendered or parsed by any
  // consumer (checked: LargoDeskMiniPanel, useLargoChat, slash-submodules, the route), so the
  // format change is safe; `as_of_utc` keeps a machine-orderable instant regardless.
  const nowMs = Date.now();
  const as_of = etStamp(nowMs) ?? new Date(nowMs).toISOString();
  const session_date = etSessionDate(nowMs);
  const as_of_utc = new Date(nowMs).toISOString();
  const base: LargoMiniPanelPayload = {
    kind: cfg.miniPanel,
    desk: cfg.key,
    label: sub ? `${cfg.label} · ${sub.label}` : cfg.label,
    submodule: sub?.id ?? null,
    ticker,
    as_of,
    session_date,
    as_of_utc,
    href: cfg.href,
    rows: [],
  };

  const subId = sub?.id;

  try {
    switch (cfg.key as DeskScopeKey) {
      case "spx-slayer": {
        const { marketPlatform } = await import("@/lib/platform");
        const productReads = await import("@/lib/largo/product-reads");
        const [play, gexMod, structure] = await Promise.all([
          marketPlatform.spx.getSpxPlayState().catch(() => null),
          import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX")).catch(() => null),
          marketPlatform.spx.getSpxDeskSummary().catch(() => null),
        ]);
        const gex = gexMod as {
          spot?: number;
          flip?: number;
          call_wall?: number;
          put_wall?: number;
          net_gex?: number;
        } | null;
        const p = play as {
          phase?: string;
          action?: string;
          grade?: string;
          spot?: number;
        } | null;
        const desk = structure as {
          price?: number;
          vwap?: number;
          ema20?: number;
          tick?: number;
          trin?: number;
        } | null;
        if (subId === "play" || subId === "gates") {
          base.rows = [
            {
              label: "Phase",
              value: p?.phase ?? "—",
            },
            {
              label: "Action",
              value: p?.action ?? "—",
              tone: (p?.action ?? "").toLowerCase().includes("short") ? "bear" : "bull",
            },
            { label: "Grade", value: p?.grade ?? "—" },
            { label: "Spot", value: p?.spot != null ? String(Math.round(p.spot)) : gex?.spot != null ? String(Math.round(gex.spot)) : "—" },
          ];
        } else if (subId === "pin") {
          const pinMod = await productReads.spxPinForLargo().catch(() => null);
          const pin = (pinMod as { pin?: { pinConfirmed?: number; magnet?: { strike?: number } } } | null)?.pin;
          base.rows = [
            { label: "Pin", value: pin?.pinConfirmed != null ? String(Math.round(pin.pinConfirmed)) : "—" },
            { label: "Magnet", value: pin?.magnet?.strike != null ? String(Math.round(pin.magnet.strike)) : "—" },
            { label: "Spot", value: gex?.spot != null ? String(Math.round(gex.spot)) : desk?.price != null ? String(Math.round(desk.price)) : "—" },
            { label: "Flip", value: gex?.flip != null ? String(Math.round(gex.flip)) : "—" },
          ];
        } else if (subId === "pulse") {
          const pulseMod = await productReads.spxPulseForLargo().catch(() => null);
          const pulse = (pulseMod as { pulse?: { price?: number; gammaFlip?: number; macroPhase?: { event?: string } } } | null)?.pulse;
          base.rows = [
            { label: "Spot", value: pulse?.price != null ? String(Math.round(pulse.price)) : "—" },
            { label: "Flip", value: pulse?.gammaFlip != null ? String(Math.round(pulse.gammaFlip)) : "—" },
            { label: "Macro", value: pulse?.macroPhase?.event ?? "—" },
            { label: "Play", value: [p?.phase, p?.action].filter(Boolean).join(" · ") || "—" },
          ];
        } else if (subId === "technicals") {
          base.rows = [
            { label: "Spot", value: desk?.price != null ? String(Math.round(desk.price)) : gex?.spot != null ? String(Math.round(gex.spot)) : "—" },
            { label: "VWAP", value: desk?.vwap != null ? String(Math.round(desk.vwap)) : "—" },
            { label: "EMA 20", value: desk?.ema20 != null ? String(Math.round(desk.ema20)) : "—" },
            { label: "Flip", value: gex?.flip != null ? String(Math.round(gex.flip)) : "—" },
          ];
        } else if (subId === "internals") {
          base.rows = [
            { label: "TICK", value: desk?.tick != null ? String(Math.round(desk.tick)) : "—", tone: (desk?.tick ?? 0) >= 0 ? "bull" : "bear" },
            { label: "TRIN", value: desk?.trin != null ? desk.trin.toFixed(2) : "—" },
            { label: "Spot", value: desk?.price != null ? String(Math.round(desk.price)) : "—" },
            { label: "Play", value: [p?.phase, p?.action].filter(Boolean).join(" · ") || "—" },
          ];
        } else if (subId === "lotto") {
          const lotto = await marketPlatform.spx.getSpxLottoState().catch(() => null);
          const rows = Array.isArray(lotto) ? lotto : [];
          const top = rows[0] as { phase?: string; direction?: string; strike?: number } | undefined;
          base.rows = [
            { label: "Lotto", value: top ? [top.phase, top.direction].filter(Boolean).join(" · ") || "Active" : "—" },
            { label: "Strike", value: top?.strike != null ? String(Math.round(top.strike)) : "—" },
            { label: "0DTE", value: [p?.phase, p?.action].filter(Boolean).join(" · ") || "—" },
          ];
        } else if (subId === "power-hour") {
          const ph = await marketPlatform.spx.getSpxPowerHourState().catch(() => null);
          const phRow = ph as { phase?: string; direction?: string; strike?: number } | null;
          base.rows = [
            { label: "PH", value: phRow ? [phRow.phase, phRow.direction].filter(Boolean).join(" · ") || "—" : "—" },
            { label: "Strike", value: phRow?.strike != null ? String(Math.round(phRow.strike)) : "—" },
            { label: "Spot", value: desk?.price != null ? String(Math.round(desk.price)) : "—" },
          ];
        } else if (subId === "signal-log") {
          const log = await marketPlatform.spx.getSpxSignalLog(5).catch(() => null);
          const last = (Array.isArray(log) ? log[0] : null) as { action?: string; grade?: string } | null;
          base.rows = [
            { label: "Last", value: last ? [last.action, last.grade].filter(Boolean).join(" · ") || "—" : "—" },
            { label: "Open", value: p?.action ?? "—" },
            { label: "Spot", value: desk?.price != null ? String(Math.round(desk.price)) : "—" },
          ];
        } else if (subId === "engine-history") {
          const snaps = await marketPlatform.spx.getSpxEngineSnapshots(3).catch(() => null);
          const last = (Array.isArray(snaps) ? snaps[0] : null) as { phase?: string; action?: string } | null;
          base.rows = [
            { label: "Snapshot", value: last ? [last.phase, last.action].filter(Boolean).join(" · ") || "—" : "—" },
            { label: "Now", value: [p?.phase, p?.action].filter(Boolean).join(" · ") || "—" },
          ];
        } else if (subId === "record") {
          const stats = await marketPlatform.spx.getSpxSetupStats().catch(() => null);
          const s = stats as { win_rate?: number; total?: number } | null;
          base.rows = [
            { label: "Win rate", value: s?.win_rate != null ? `${s.win_rate.toFixed(1)}%` : "—" },
            { label: "Graded", value: s?.total != null ? String(s.total) : "—" },
          ];
        } else if (subId === "vector") {
          const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
          const state = await fetchVectorFullState("SPX").catch(() => null);
          base.rows = [
            { label: "Spot", value: state?.spot != null ? String(Math.round(state.spot)) : "—" },
            { label: "Regime", value: state?.regime?.posture ?? "—", tone: biasTone(state?.regime?.posture) },
            { label: "Slayer", value: [p?.phase, p?.action].filter(Boolean).join(" · ") || "—" },
          ];
        } else if (subId === "flow-gex") {
          const { flowBriefForLargo } = await import("@/lib/largo/product-reads");
          const brief = await flowBriefForLargo().catch(() => null);
          const b = brief as { net_premium?: number; bias?: string } | null;
          base.rows = [
            { label: "Net flow", value: b?.net_premium != null ? fmtPremium(b.net_premium) : "—", tone: (b?.net_premium ?? 0) >= 0 ? "bull" : "bear" },
            { label: "Flow bias", value: b?.bias ?? "—", tone: biasTone(b?.bias) },
            { label: "Flip", value: gex?.flip != null ? String(Math.round(gex.flip)) : "—" },
            { label: "Net GEX", value: gex?.net_gex != null ? fmtPremium(gex.net_gex) : "—", tone: (gex?.net_gex ?? 0) >= 0 ? "bull" : "bear" },
          ];
        } else {
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
        }
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
        if (subId === "whales") {
          base.rows = [
            {
              label: "Top print",
              value: bp?.premium
                ? `${bp.option_type ?? ""} ${bp.strike ?? ""} · ${fmtPremium(bp.premium)}`.trim()
                : "—",
            },
            { label: "Whales", value: b?.whale_count != null ? String(b.whale_count) : "—" },
            { label: "Net premium", value: b?.net_premium != null ? fmtPremium(b.net_premium) : "—", tone: (b?.net_premium ?? 0) >= 0 ? "bull" : "bear" },
          ];
        } else if (subId === "tide") {
          base.rows = [
            { label: "Tide", value: a?.tide ?? "—", tone: biasTone(a?.tide) },
            { label: "Bias", value: b?.bias ?? "—", tone: biasTone(b?.bias) },
            { label: "Net premium", value: b?.net_premium != null ? fmtPremium(b.net_premium) : "—", tone: (b?.net_premium ?? 0) >= 0 ? "bull" : "bear" },
          ];
        } else {
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
        }
        break;
      }
      case "thermal": {
        const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
        const pos = await getGexPositioning(ticker).catch(() => null);
        // WHEN the matrix these rows are read from was computed. `as_of` above is when the PANEL
        // was built, which is not the same fact: every row below (Spot / Flip / Call wall / Put
        // wall / Net GEX) is a snapshot off a cached matrix, and dropping its time left the
        // panel's own build stamp as the only date in the payload — which reads as "now".
        if (pos?.asof) {
          base.source_asof = pos.asof;
          base.source_asof_et = etStamp(Date.parse(pos.asof));
          base.source_session_date = etSessionDate(Date.parse(pos.asof));
          // getGexPositioning is a documented strict cache reader.
          base.freshness = "cached";
        }
        if (subId === "vex") {
          base.rows = [
            { label: "Spot", value: pos?.spot != null ? String(Math.round(pos.spot)) : "—" },
            { label: "Net GEX", value: pos?.net_gex != null ? fmtPremium(pos.net_gex) : "—", tone: (pos?.net_gex ?? 0) >= 0 ? "bull" : "bear" },
            { label: "Flip", value: pos?.flip != null ? String(Math.round(pos.flip)) : "—" },
          ];
        } else {
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
        }
        break;
      }
      case "vector": {
        const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
        const state = await fetchVectorFullState(ticker).catch(() => null);
        const play = state?.play;
        if (subId === "regime") {
          base.rows = [
            { label: "Regime", value: state?.regime?.posture ?? "—", tone: biasTone(state?.regime?.posture) },
            { label: "Spot", value: state?.spot != null ? String(Math.round(state.spot)) : "—" },
          ];
        } else if (subId === "play") {
          base.rows = [
            { label: "Play", value: play ? [play.grade, play.bias].filter(Boolean).join(" · ") || "—" : "—" },
            { label: "Spot", value: state?.spot != null ? String(Math.round(state.spot)) : "—" },
          ];
        } else {
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
        }
        break;
      }
      case "nighthawk": {
        const zerodte = await import("@/lib/platform/zerodte-service")
          .then((m) => m.zeroDtePlaysForLargo())
          .catch(() => null);
        const plays = (zerodte as { plays?: Array<{ ticker?: string; status?: string; pnl_pct?: number }> } | null)?.plays ?? [];
        const open = plays.filter((p) => !/closed|graded/i.test(String(p.status ?? "")));
        const top = [...open].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))[0];
        if (subId === "marks") {
          base.rows = [
            {
              label: "Top P&L",
              value: top
                ? `${top.ticker ?? ""} ${top.pnl_pct != null ? `${top.pnl_pct >= 0 ? "+" : ""}${top.pnl_pct.toFixed(1)}%` : ""}`.trim()
                : "—",
              tone: (top?.pnl_pct ?? 0) >= 0 ? "bull" : "bear",
            },
            { label: "Open", value: String(open.length) },
          ];
        } else {
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
        }
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
