/**
 * Thermal Discord v3 extras — breach alerts, shift leaders, session-close recap.
 * Cache-reader inputs only; never fabricates market numbers in production paths.
 */
import type { DiscordEmbedPayload } from "@/lib/discord-post";
import { todayEt } from "@/lib/et-date";
import { pickGexShiftLeaders } from "@/lib/gex-shift-leaders";
import {
  buildThermalDiscordEmbed,
  buildThermalRegimeSummary,
  buildThermalTickerOneLiner,
  fmtLevel,
  heatmapLink,
  pinPhrase,
  type ThermalDiscordPostMode,
} from "@/lib/thermal-discord-embed";
import type { ThermalCardColumn } from "@/lib/thermal-discord-card";

export type ThermalBreachKind = "call_wall" | "put_wall" | "flip";

export type ThermalBreachEvent = {
  ticker: string;
  kind: ThermalBreachKind;
  spot: number;
  level: number;
  direction: "crossed_above" | "crossed_below";
  /** Spot on the prior snapshot (for honest cross description). */
  priorSpot: number;
  asof: string;
};

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

const BREACH_KIND_LABEL: Record<ThermalBreachKind, string> = {
  call_wall: "call wall",
  put_wall: "put wall",
  flip: "gamma flip",
};

function fmtSpot(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShiftPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
}

/** Per-ticker intraday build/melt leaders — null when shift unavailable. */
export function buildThermalShiftLeadersLine(col: ThermalCardColumn, perSide = 2): string | null {
  const h = col.heatmap;
  if (!h?.shift?.available) return null;

  const leaders = pickGexShiftLeaders(h.gex?.strike_totals, h.shift, { perSide });
  if (!leaders.length) return null;

  const builds = leaders
    .filter((l) => l.delta > 0)
    .map((l) => `+${l.strike} (${fmtShiftPct(l.pct)})`);
  const melts = leaders
    .filter((l) => l.delta < 0)
    .map((l) => `${l.strike} (${fmtShiftPct(l.pct)})`);

  const parts: string[] = [];
  if (builds.length) parts.push(`build ${builds.join(", ")}`);
  if (melts.length) parts.push(`melt ${melts.join(", ")}`);
  if (!parts.length) return null;

  return `_${parts.join(" · ")}_`;
}

/** Full snapshot embed with optional shift-leader sub-lines per ticker. */
export function buildThermalDiscordEmbedWithExtras(
  columns: ThermalCardColumn[],
  mode: ThermalDiscordPostMode,
  opts?: { includeShiftLeaders?: boolean }
): DiscordEmbedPayload {
  const base = buildThermalDiscordEmbed(columns, mode);
  if (!opts?.includeShiftLeaders || mode !== "full") return base;

  const lines: string[] = [];
  for (const col of columns) {
    lines.push(buildThermalTickerOneLiner(col));
    const shift = buildThermalShiftLeadersLine(col);
    if (shift) lines.push(shift);
  }

  const regime = buildThermalRegimeSummary(columns);
  return {
    ...base,
    description: `${regime}\n\n${lines.join("\n")}`,
  };
}

function sideOf(spot: number, level: number): "above" | "below" | "at" {
  if (Math.abs(spot - level) < 0.005) return "at";
  return spot > level ? "above" : "below";
}

/**
 * Detect wall/flip crosses vs prior spot. Production cron compares successive snapshots;
 * returns at most one event per ticker (flip > call wall > put wall priority).
 */
export function detectThermalBreaches(
  columns: ThermalCardColumn[],
  priorSpots: Record<string, number>
): ThermalBreachEvent[] {
  const out: ThermalBreachEvent[] = [];
  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean) ?? new Date().toISOString();

  for (const col of columns) {
    const h = col.heatmap;
    const ticker = col.ticker.toUpperCase();
    const priorSpot = priorSpots[ticker];
    if (!h || !Number.isFinite(priorSpot) || !Number.isFinite(h.spot as number)) continue;

    const spot = Number(h.spot);
    const call = h.gex?.call_wall;
    const put = h.gex?.put_wall;
    const flip = h.gex?.flip;

    const checks: Array<{ kind: ThermalBreachKind; level: number | null | undefined }> = [
      { kind: "flip", level: flip },
      { kind: "call_wall", level: call },
      { kind: "put_wall", level: put },
    ];

    for (const { kind, level } of checks) {
      if (!Number.isFinite(level as number)) continue;
      const lvl = Number(level);
      const was = sideOf(priorSpot, lvl);
      const now = sideOf(spot, lvl);
      if (was === "at" || now === "at" || was === now) continue;
      out.push({
        ticker,
        kind,
        spot,
        level: lvl,
        direction: now === "above" ? "crossed_above" : "crossed_below",
        priorSpot,
        asof: asOf,
      });
      break;
    }
  }
  return out;
}

export function buildThermalBreachAlertEmbed(event: ThermalBreachEvent): DiscordEmbedPayload {
  const t = event.ticker.toUpperCase();
  const label = BREACH_KIND_LABEL[event.kind];
  const arrow = event.direction === "crossed_above" ? "↑ crossed above" : "↓ crossed below";
  const color = event.kind === "flip" ? 0xfbbf24 : event.direction === "crossed_above" ? 0xa3e635 : 0xff2d55;

  return {
    title: `Thermal · ${t} ${arrow} ${label}`,
    description: [
      `**${t} ${fmtSpot(event.spot)}** ${arrow} **${fmtLevel(event.level)}** (${label})`,
      `_Prior spot ${fmtSpot(event.priorSpot)} · structure breach — live snapshot_`,
      `[Open ${t} heatmap →](${heatmapLink(t)})`,
    ].join("\n"),
    color,
    url: heatmapLink(t),
    timestamp: new Date(event.asof).toISOString(),
    footer: { text: "Event-driven breach alert · Thermal" },
  };
}

function fmtAsOfEt(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(t));
}

/** ~4:05 PM ET session-close recap for Thermal Discord. */
export function buildThermalEodRecapEmbed(
  columns: ThermalCardColumn[],
  sessionDate: string = todayEt()
): DiscordEmbedPayload {
  const lines: string[] = [];
  for (const col of columns) {
    const h = col.heatmap;
    const t = col.ticker.toUpperCase();
    if (!h?.gex) {
      lines.push(`**${t}** — no close snapshot`);
      continue;
    }
    const read = h.gex.regime?.read?.trim() || "structure only";
    const pin = pinPhrase(h.spot, h.gex.call_wall, h.gex.put_wall, h.gex.flip);
    const shift = buildThermalShiftLeadersLine(col, 1);
    const close = [
      `[**${t} ${fmtSpot(Number(h.spot))}**](${heatmapLink(t)})`,
      `C ${fmtLevel(h.gex.call_wall)} · P ${fmtLevel(h.gex.put_wall)} · Flip ${fmtLevel(h.gex.flip)}`,
      `_${read}${pin ? ` · ${pin}` : ""}_`,
      shift,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(close);
  }

  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean);
  const regime = buildThermalRegimeSummary(columns);

  return {
    title: "BlackOut Thermal · Session close",
    description: [`**Session ${sessionDate}** · cash close recap`, regime, "", ...lines].join("\n"),
    color: 0x7dd3fc,
    url: `${APP_BASE}/heatmap`,
    timestamp: asOf ? new Date(asOf).toISOString() : new Date().toISOString(),
    footer: {
      text: `Close recap · as of ${fmtAsOfEt(asOf)} ET`,
    },
  };
}
