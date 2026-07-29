/**
 * HELIX → Discord community alerts (write-up embeds).
 *
 * Filters (all required for live pings):
 *   1. total premium ≥ $500K
 *   2. fill price under $10
 *   3. DTE ≤ 30
 *
 * Pure formatters live here so persist + cron share one shape. Never fabricates
 * GEX/walls — proximity is only woven in when the caller supplies it.
 */
import type { GexProximityLabel } from "@/lib/flow-gex-proximity";

export const HELIX_DISCORD_MIN_PREMIUM = 500_000;
export const HELIX_DISCORD_MAX_FILL = 10;
export const HELIX_DISCORD_MAX_DTE = 30;

export type HelixDiscordFlowInput = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction?: string;
  score?: number;
  route?: string;
  alerted_at?: string | null;
  event_at?: string | null;
  dte?: number | null;
  fill_price?: number | null;
  ask_pct?: number | null;
  open_interest?: number | null;
  otm_pct?: number | null;
  implied_volatility?: number | null;
  alert_rule?: string | null;
  gex_proximity?: GexProximityLabel | string | null;
};

export type HelixDiscordKind = "whale" | "structure" | "whale-structure" | "stack" | "near";

export type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
  url?: string;
};

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

export function dteFromExpiry(expiry: string, now = new Date()): number | null {
  const exp = String(expiry || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return null;
  const ms = Date.parse(`${exp}T20:00:00.000Z`); // rough session-day boundary; filter only
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - now.getTime()) / 86_400_000);
}

export function resolveHelixDiscordDte(flow: HelixDiscordFlowInput, now = new Date()): number | null {
  if (flow.dte != null && Number.isFinite(Number(flow.dte))) return Math.floor(Number(flow.dte));
  return dteFromExpiry(flow.expiry, now);
}

/** All three community gates. Missing fill/dte → reject (fail closed). */
export function passesHelixDiscordFilters(flow: HelixDiscordFlowInput, now = new Date()): boolean {
  const premium = Number(flow.premium);
  if (!Number.isFinite(premium) || premium < HELIX_DISCORD_MIN_PREMIUM) return false;

  const fill = flow.fill_price != null ? Number(flow.fill_price) : NaN;
  if (!(fill > 0) || !(fill < HELIX_DISCORD_MAX_FILL)) return false;

  const dte = resolveHelixDiscordDte(flow, now);
  if (dte == null || dte < 0 || dte > HELIX_DISCORD_MAX_DTE) return false;

  return true;
}

export function moneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) {
    const v = n / 1e6;
    return `$${v >= 10 ? v.toFixed(1) : v.toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3).toLocaleString("en-US")}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtStrike(s: number): string {
  if (!Number.isFinite(s)) return "?";
  return Number.isInteger(s) ? String(s) : String(s);
}

function fmtExpiry(exp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(exp ?? "").trim());
  if (!m) return String(exp ?? "?").slice(0, 10);
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

function dteLabel(dte: number | null): string | null {
  if (dte == null || !Number.isFinite(dte)) return null;
  const n = Math.max(0, Math.floor(dte));
  return n === 0 ? "0DTE" : `${n}DTE`;
}

export function gexPhrase(proximity: string | null | undefined): string | null {
  switch (proximity) {
    case "at_gamma_flip":
      return "at the gamma flip";
    case "at_call_wall":
      return "at the call wall";
    case "at_put_wall":
      return "at the put wall";
    case "near_call_wall":
      return "near the call wall";
    case "near_put_wall":
      return "near the put wall";
    default:
      return null;
  }
}

function aggressorPhrase(askPct: number | null | undefined): string | null {
  if (askPct == null || !Number.isFinite(askPct)) return null;
  if (askPct >= 60) return "lifting the ask";
  if (askPct <= 40) return "hitting the bid";
  return null;
}

export function classifyHelixDiscordKind(flow: HelixDiscordFlowInput, now = new Date()): HelixDiscordKind {
  const gex = gexPhrase(flow.gex_proximity ?? null);
  const whale = flow.route === "whale" || Number(flow.premium) >= 1_000_000;
  const dte = resolveHelixDiscordDte(flow, now);
  if (gex && whale) return "whale-structure";
  if (gex) return "structure";
  if (/repeat/i.test(String(flow.alert_rule || ""))) return "stack";
  if (dte != null && dte <= 2) return "near";
  return "whale";
}

function titleFor(kind: HelixDiscordKind): string {
  switch (kind) {
    case "whale-structure":
      return "🐋🧱 HELIX · Whale @ Structure";
    case "structure":
      return "🧱 HELIX · Flow @ Structure";
    case "stack":
      return "📚 HELIX · Repeat Hits";
    case "near":
      return "⚡ HELIX · Near-dated Whale";
    default:
      return "⭐ HELIX · Whale";
  }
}

function colorFor(flow: HelixDiscordFlowInput, kind: HelixDiscordKind): number {
  if (kind === "structure" || kind === "whale-structure") return 0x38bdf8;
  if (kind === "stack") return 0xa3e635;
  const side = String(flow.option_type || "").toUpperCase();
  if (side.startsWith("C")) return 0x00e676;
  if (side.startsWith("P")) return 0xff2d55;
  return 0x22d3ee;
}

export function helixDiscordHeadline(flow: HelixDiscordFlowInput, now = new Date()): string {
  const side = String(flow.option_type || "?").toUpperCase().startsWith("C") ? "C" : "P";
  const fill = flow.fill_price != null ? Number(flow.fill_price) : null;
  const dte = dteLabel(resolveHelixDiscordDte(flow, now));
  const fillStr =
    fill != null && Number.isFinite(fill) ? ` @ $${fill % 1 ? fill.toFixed(2) : fill}` : "";
  return `${String(flow.ticker).toUpperCase()} ${fmtStrike(Number(flow.strike))}${side} ${fmtExpiry(
    flow.expiry
  )}${fillStr}${dte ? ` — ${dte}` : ""}`;
}

/** 1–2 line prose write-up. Walls/GEX only when present. */
export function helixDiscordWriteup(flow: HelixDiscordFlowInput, now = new Date()): string {
  const isCall = String(flow.option_type || "").toUpperCase().startsWith("C");
  const prem = moneyShort(Number(flow.premium));
  const fill = flow.fill_price != null ? Number(flow.fill_price) : null;
  const size =
    fill != null && fill > 0 && Number(flow.premium) > 0
      ? Math.round(Number(flow.premium) / (fill * 100))
      : null;
  const gex = gexPhrase(flow.gex_proximity ?? null);
  const leg = isCall ? "call" : "put";

  let line1 = `${prem} in ${leg} premium`;
  if (size != null && size > 0) line1 += ` (~${size.toLocaleString("en-US")} contracts est.)`;
  if (flow.open_interest != null && Number.isFinite(Number(flow.open_interest))) {
    const oi = Number(flow.open_interest);
    const oiStr = oi >= 1000 ? `${(oi / 1000).toFixed(oi >= 10000 ? 0 : 1)}k` : String(Math.round(oi));
    line1 += ` vs ${oiStr} OI`;
  }
  if (gex) line1 += ` — printing ${gex}`;
  line1 += ".";

  const bits: string[] = [];
  const aggr = aggressorPhrase(flow.ask_pct);
  if (aggr) bits.push(aggr);
  else if (flow.direction && flow.direction !== "unknown") bits.push(`${flow.direction} flow`);
  if (/repeat/i.test(String(flow.alert_rule || ""))) bits.push("repeat hits on this contract");
  const dte = resolveHelixDiscordDte(flow, now);
  if (dte != null && dte <= 2) bits.push(dte === 0 ? "0DTE" : "near-dated");
  if (flow.route === "whale" || Number(flow.premium) >= 1_000_000) bits.push("whale-tier");
  if (flow.otm_pct != null && Number.isFinite(Number(flow.otm_pct))) {
    const otm = Number(flow.otm_pct);
    if (Math.abs(otm) >= 0.3) bits.push(`${Math.abs(otm).toFixed(1)}% ${otm >= 0 ? "OTM" : "ITM"}`);
  }

  return bits.length ? `${line1}\n${bits.join(" · ")}.` : line1;
}

export function buildHelixDiscordEmbed(
  flow: HelixDiscordFlowInput,
  opts?: { kind?: HelixDiscordKind; now?: Date }
): DiscordEmbed {
  const now = opts?.now ?? new Date();
  const kind = opts?.kind ?? classifyHelixDiscordKind(flow, now);
  const ticker = String(flow.ticker || "?").toUpperCase();
  const when = flow.event_at || flow.alerted_at || now.toISOString();
  const et = new Date(when).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    month: "short",
    day: "numeric",
  });

  return {
    title: titleFor(kind),
    description: `**${helixDiscordHeadline(flow, now)}**\n\n${helixDiscordWriteup(flow, now)}\n\n[Open in HELIX](${APP_BASE}/flows?ticker=${encodeURIComponent(ticker)})`,
    color: colorFor(flow, kind),
    footer: { text: `BlackOut HELIX · ${et} ET` },
    timestamp: new Date(when).toISOString(),
    url: `${APP_BASE}/flows?ticker=${encodeURIComponent(ticker)}`,
  };
}

export function buildHelixTopHitsDigestEmbed(input: {
  windowMin: 15 | 30;
  rows: HelixDiscordFlowInput[];
  inWindowCount: number;
  sessionFallback: boolean;
  now?: Date;
}): DiscordEmbed {
  const now = input.now ?? new Date();
  const et = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  if (!input.rows.length) {
    return {
      title: `📊 HELIX · Top hits · last ${input.windowMin}m`,
      description: "Quiet tape — nothing matched ≥$500K · fill <$10 · ≤30 DTE.",
      color: 0x64748b,
      footer: { text: `BlackOut HELIX · ${et} ET` },
      timestamp: now.toISOString(),
    };
  }

  const head = input.sessionFallback
    ? `_No fresh prints in last ${input.windowMin}m — best recent matches under the 3 filters (not a live window)._\n`
    : `Top ${input.rows.length} in the last **${input.windowMin} minutes** · ≥$500K · fill <$10 · ≤30 DTE.\n`;

  const body = input.rows
    .map((f, i) => {
      const fill = f.fill_price != null ? Number(f.fill_price) : null;
      const dte = resolveHelixDiscordDte(f, now);
      const dteStr = dte == null ? "" : dte === 0 ? "0DTE" : `${dte}DTE`;
      const gex = gexPhrase(f.gex_proximity ?? null);
      const fillStr =
        fill != null && Number.isFinite(fill) ? ` @ $${fill % 1 ? fill.toFixed(2) : fill}` : "";
      return `**${i + 1}.** ${String(f.ticker).toUpperCase()} ${fmtStrike(Number(f.strike))}${
        String(f.option_type || "").toUpperCase().startsWith("C") ? "C" : "P"
      }${fillStr} · ${moneyShort(Number(f.premium))} · ${dteStr}${gex ? ` · ${gex}` : ""}`;
    })
    .join("\n");

  const lead = input.rows[0];
  const blurb = `\nLead: **${String(lead.ticker).toUpperCase()}** ${moneyShort(Number(lead.premium))}${
    gexPhrase(lead.gex_proximity ?? null) ? ` · ${gexPhrase(lead.gex_proximity ?? null)}` : ""
  } — ${lead.direction || "—"}.`;

  return {
    title: `📊 HELIX · Top hits · last ${input.windowMin}m`,
    description: `${head}\n${body}${blurb}\n\n[Open in HELIX](${APP_BASE}/flows)`,
    color: input.sessionFallback ? 0x94a3b8 : 0x22d3ee,
    footer: { text: `BlackOut HELIX · ${et} ET · ${input.inWindowCount} in window` },
    timestamp: now.toISOString(),
    url: `${APP_BASE}/flows`,
  };
}

/** Opt-in: set HELIX_DISCORD_ALERTS=1 (uses DISCORD_THERMAL_WEBHOOK_URL). */
export function helixDiscordAlertsEnabled(): boolean {
  const v = process.env.HELIX_DISCORD_ALERTS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function helixDiscordWebhookUrl(): string | null {
  return process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim() || null;
}

/** Discord digest list size (embed char budget; desk rail uses 12). */
export const HELIX_DISCORD_DIGEST_LIMIT = 5;

function eventMs(flow: HelixDiscordFlowInput): number | null {
  const iso = flow.event_at || flow.alerted_at;
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Rank filtered flows for a digest window — score≥5 first, else premium.
 * Prefers in-window prints; falls back to session leaders when the window is quiet.
 */
export function selectHelixDiscordDigest(
  flows: readonly HelixDiscordFlowInput[],
  opts: { windowMin: 15 | 30; now?: Date; limit?: number }
): {
  rows: HelixDiscordFlowInput[];
  inWindowCount: number;
  sessionFallback: boolean;
} {
  const nowMs = (opts.now ?? new Date()).getTime();
  const windowMs = opts.windowMin * 60_000;
  const limit = opts.limit ?? HELIX_DISCORD_DIGEST_LIMIT;
  const eligible = flows.filter((f) => passesHelixDiscordFilters(f, opts.now));
  const inWindow = eligible.filter((f) => {
    const ms = eventMs(f);
    return ms != null && nowMs - ms <= windowMs;
  });
  const pool = inWindow.length > 0 ? inWindow : eligible;
  const sessionFallback = inWindow.length === 0 && pool.length > 0;

  const byScore = [...pool]
    .filter((f) => Number(f.score ?? 0) >= 5)
    .sort(
      (a, b) =>
        Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.premium) - Number(a.premium)
    )
    .slice(0, limit);
  if (byScore.length > 0) {
    return { rows: byScore, inWindowCount: inWindow.length, sessionFallback };
  }

  const byPremium = [...pool]
    .sort((a, b) => Number(b.premium) - Number(a.premium))
    .slice(0, limit);
  return { rows: byPremium, inWindowCount: inWindow.length, sessionFallback };
}
