/**
 * Thermal Discord v2 — structured embed (regime summary + per-ticker one-liners + heatmap links).
 * Cache-reader inputs only — never fabricates market numbers.
 */
import type { DiscordEmbedPayload } from "@/lib/discord-post";
import { todayEt } from "@/lib/et-date";
import {
  bandStrikesAroundSpot,
  fmtCompactExpiry,
  resolveDiscordNearExpiries,
  THERMAL_DISCORD_MAX_EXPIRIES,
  THERMAL_DISCORD_STRIKE_HALF,
  type ThermalCardColumn,
} from "@/lib/thermal-discord-card";

export type ThermalDiscordPostMode = "full" | "pulse";

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

function fmtSpot(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtLevel(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  return Math.round(n as number).toLocaleString("en-US");
}

export function pctFromSpot(spot: number | null | undefined, level: number | null | undefined): string | null {
  if (!Number.isFinite(spot as number) || !Number.isFinite(level as number) || spot === 0) return null;
  const pct = ((Number(level) - Number(spot)) / Number(spot)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function pinPhrase(
  spot: number | null | undefined,
  call: number | null | undefined,
  put: number | null | undefined,
  flip: number | null | undefined
): string | null {
  if (!Number.isFinite(spot as number)) return null;
  const s = Number(spot);
  if (Number.isFinite(call as number) && s >= Number(call) * 0.998) return "at/above call wall";
  if (Number.isFinite(put as number) && s <= Number(put) * 1.002) return "at/below put wall";
  if (Number.isFinite(flip as number)) {
    return s >= Number(flip) ? "above flip" : "below flip";
  }
  if (Number.isFinite(call as number) && Number.isFinite(put as number) && s > Number(put) && s < Number(call)) {
    return "between walls";
  }
  return null;
}

export function wallDriftSuffix(heatmap: ThermalCardColumn["heatmap"]): string {
  const shift = heatmap?.shift;
  const wallGrew = shift?.available ? shift.wall_changes : null;
  if (shift?.available === false) return "drift pending";
  const c = wallGrew?.call_wall?.grew_pct;
  const p = wallGrew?.put_wall?.grew_pct;
  if (c == null && p == null) return "drift n/a";
  const fmt = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}%`);
  return `walls C${fmt(c)} P${fmt(p)}`;
}

export function heatmapLink(ticker: string): string {
  return `${APP_BASE}/heatmap?ticker=${encodeURIComponent(ticker.toUpperCase())}`;
}

/** One institutional line per index — spot, walls with % distance, flip, drift. */
export function buildThermalTickerOneLiner(col: ThermalCardColumn): string {
  const h = col.heatmap;
  const t = col.ticker.toUpperCase();
  if (!h) return `**${t}** — data unavailable`;

  const spot = h.spot;
  const call = h.gex?.call_wall;
  const put = h.gex?.put_wall;
  const flip = h.gex?.flip;
  const chg = h.change_pct;
  const chgS = Number.isFinite(chg as number)
    ? ` (${Number(chg) >= 0 ? "+" : ""}${Number(chg).toFixed(2)}%)`
    : "";

  const cDist = pctFromSpot(spot, call);
  const pDist = pctFromSpot(spot, put);
  const pin = pinPhrase(spot, call, put, flip);
  const drift = wallDriftSuffix(h);

  const wallPart = [
    Number.isFinite(call as number) ? `C ${fmtLevel(call)}${cDist ? ` (${cDist})` : ""}` : null,
    Number.isFinite(put as number) ? `P ${fmtLevel(put)}${pDist ? ` (${pDist})` : ""}` : null,
    Number.isFinite(flip as number) ? `Flip ${fmtLevel(flip)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const pinPart = pin ? ` · _${pin}_` : "";
  return `[**${t} ${fmtSpot(spot)}${chgS}**](${heatmapLink(t)}) · ${wallPart}${pinPart} · ${drift}`;
}

export function buildThermalRegimeSummary(columns: ThermalCardColumn[]): string {
  const bits: string[] = [];
  for (const col of columns) {
    const h = col.heatmap;
    if (!h?.gex) continue;
    const t = col.ticker;
    const read = h.gex.regime?.read?.trim();
    const pin = pinPhrase(h.spot, h.gex.call_wall, h.gex.put_wall, h.gex.flip);
    if (read && read !== "undetermined" && !/unavailable/i.test(read)) {
      bits.push(`${t}: ${read}`);
    } else if (pin) {
      bits.push(`${t} ${pin}`);
    }
  }
  if (!bits.length) return "_Regime: structure levels only — gamma read unavailable on this snapshot._";
  return `**Regime:** ${bits.join(" · ")}`;
}

function collectNearExpiries(columns: ThermalCardColumn[]): string[] {
  const today = todayEt();
  const set = new Set<string>();
  for (const col of columns) {
    const h = col.heatmap;
    if (!h) continue;
    const strikes = bandStrikesAroundSpot(h.strikes, h.spot, THERMAL_DISCORD_STRIKE_HALF);
    for (const e of resolveDiscordNearExpiries(
      h.gex?.cells,
      strikes,
      h.near_term_expiries,
      h.expiries,
      today,
      THERMAL_DISCORD_MAX_EXPIRIES
    )) {
      set.add(e);
    }
  }
  return [...set].sort();
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
    second: "2-digit",
    hour12: true,
  }).format(new Date(t));
}

/** Build the Thermal Discord embed — PNG attachment is optional (full vs pulse cadence). */
export function buildThermalDiscordEmbed(
  columns: ThermalCardColumn[],
  mode: ThermalDiscordPostMode
): DiscordEmbedPayload {
  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean);
  const expiries = collectNearExpiries(columns);
  const lines = columns.map(buildThermalTickerOneLiner);
  const regime = buildThermalRegimeSummary(columns);

  const expiryFooter =
    expiries.length > 0
      ? `Near ${expiries.map(fmtCompactExpiry).join(" · ")} · as of ${fmtAsOfEt(asOf)} ET`
      : `as of ${fmtAsOfEt(asOf)} ET`;

  const cadenceNote = mode === "full" ? "Full snapshot" : "Pulse update";

  return {
    title: "BlackOut Thermal · GEX snapshot",
    description: `${regime}\n\n${lines.join("\n")}`,
    color: 0x22d3ee,
    url: `${APP_BASE}/heatmap`,
    timestamp: asOf ? new Date(asOf).toISOString() : new Date().toISOString(),
    image: mode === "full" ? { url: "attachment://thermal-desk.png" } : undefined,
    footer: {
      text: `${expiryFooter} · ${cadenceNote}`,
    },
  };
}
