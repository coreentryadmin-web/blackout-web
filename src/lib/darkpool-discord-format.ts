/**
 * Dark pool → Discord community alerts (#blackout-darkpool).
 *
 * Reads cached UW dark-pool data (WS → Redis / serverCache) — no per-post UW REST.
 * Opt-in: DARKPOOL_DISCORD_ALERTS=1 + DISCORD_DARKPOOL_WEBHOOK_URL.
 */
import { formatHelixHitTimestampEt, moneyShort } from "@/lib/helix-discord-format";
import type { DiscordEmbed } from "@/lib/helix-discord-format";
import { buildHelixDarkpoolDeepLink, darkpoolPrintToDeepLink } from "@/lib/helix-flow-deep-link";
import { signalWindowAgeMs } from "@/features/helix/lib/helix-signal-detection";

export { type DiscordEmbed };

export const DARKPOOL_DISCORD_MIN_PREMIUM = 5_000_000;
export const DARKPOOL_DISCORD_DIGEST_LIMIT = 5;

export type DarkPoolDiscordPrint = {
  ticker: string;
  premium: number;
  side: "buy" | "sell" | "neutral";
  executed_at: string;
  price?: number | null;
  share_size?: number | null;
  /** Optional ADV context — never fabricated. */
  adv_context_line?: string | null;
};

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

export function darkpoolDiscordAlertsEnabled(): boolean {
  const v = process.env.DARKPOOL_DISCORD_ALERTS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function darkpoolDiscordWebhookUrl(): string | null {
  return process.env.DISCORD_DARKPOOL_WEBHOOK_URL?.trim() || null;
}

export function darkpoolDiscordMinPremium(): number {
  const raw = Number(process.env.DARKPOOL_DISCORD_MIN_PREMIUM ?? DARKPOOL_DISCORD_MIN_PREMIUM);
  return Number.isFinite(raw) && raw > 0 ? raw : DARKPOOL_DISCORD_MIN_PREMIUM;
}

/** Fail closed — no ticker, premium, or trustworthy timestamp → drop. */
export function normalizeDarkPoolDiscordPrint(raw: unknown): DarkPoolDiscordPrint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ticker = String(r.ticker ?? r.symbol ?? r.underlying ?? "").toUpperCase();
  if (!ticker) return null;

  const premium = Number(r.premium ?? r.notional ?? r.size_premium ?? 0);
  if (!Number.isFinite(premium) || premium <= 0) return null;

  const executed_at = String(r.executed_at ?? r.date ?? r.timestamp ?? "").trim();
  if (!executed_at) return null;
  const ms = new Date(executed_at).getTime();
  if (!Number.isFinite(ms)) return null;

  const sideRaw = String(r.side ?? r.sentiment ?? r.direction ?? "neutral").toLowerCase();
  const side: DarkPoolDiscordPrint["side"] = sideRaw.includes("buy")
    ? "buy"
    : sideRaw.includes("sell")
      ? "sell"
      : "neutral";

  const priceRaw = Number(r.price ?? r.strike ?? r.ref_price ?? r.execution_price ?? NaN);
  const price = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;
  const shareRaw = Number(r.size ?? r.share_size ?? r.shares ?? NaN);
  const share_size = Number.isFinite(shareRaw) && shareRaw > 0 ? shareRaw : null;

  return { ticker, premium, side, executed_at, price, share_size };
}

/** Extract individual prints from a UW `off_lit_trades` WS payload (single or batch). */
export function extractDarkPoolWsPrints(raw: unknown): DarkPoolDiscordPrint[] {
  const rows = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.data;
  const list = Array.isArray(rows) ? rows : typeof raw === "object" && raw !== null ? [raw] : [];
  const out: DarkPoolDiscordPrint[] = [];
  for (const row of list) {
    const p = normalizeDarkPoolDiscordPrint(row);
    if (p) out.push(p);
  }
  return out;
}

export function passesDarkpoolDiscordFilters(
  print: DarkPoolDiscordPrint,
  minPremium = darkpoolDiscordMinPremium()
): boolean {
  return Number.isFinite(print.premium) && print.premium >= minPremium && Boolean(print.executed_at);
}

function sideLabel(side: DarkPoolDiscordPrint["side"]): string {
  if (side === "buy") return "BUY side";
  if (side === "sell") return "SELL side";
  return "direction unknown";
}

function sideColor(side: DarkPoolDiscordPrint["side"]): number {
  if (side === "buy") return 0x00e676;
  if (side === "sell") return 0xff2d55;
  return 0x22d3ee;
}

function fmtPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "";
  return ` @ $${price % 1 ? price.toFixed(2) : price}`;
}

function fmtShares(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M shares`;
  if (n >= 1_000) return `~${Math.round(n / 1000)}K shares`;
  return `~${Math.round(n).toLocaleString("en-US")} shares`;
}

export function darkpoolDiscordDedupKey(print: DarkPoolDiscordPrint): string {
  const prem = Math.round(print.premium);
  const at = print.executed_at.slice(0, 19);
  const px = print.price != null ? Math.round(print.price * 100) : 0;
  return `${print.ticker}|${at}|${prem}|${px}`;
}

export function buildDarkpoolDiscordEmbed(print: DarkPoolDiscordPrint): DiscordEmbed {
  const et = formatHelixHitTimestampEt(print.executed_at);
  const shares = fmtShares(print.share_size);
  const headline = `**${moneyShort(print.premium)} block${fmtPrice(print.price)}** · ${sideLabel(print.side)}`;
  const meta = [et ? `${et} ET` : null, shares, print.adv_context_line ?? null]
    .filter(Boolean)
    .join(" · ");

  const printUrl = darkpoolPrintToDeepLink(print);

  return {
    title: `🌑 Dark Pool · ${print.ticker}`,
    description: `${headline}\n\n${meta}\n\n[Open this block in HELIX](${printUrl})`,
    color: sideColor(print.side),
    footer: { text: "BlackOut Dark Pool" },
    timestamp: new Date(print.executed_at).toISOString(),
    url: printUrl,
  };
}

export function buildDarkpoolTopBlocksDigestEmbed(input: {
  windowMin: number;
  rows: DarkPoolDiscordPrint[];
  inWindowCount: number;
  now?: Date;
}): DiscordEmbed {
  const now = input.now ?? new Date();
  const et = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const minPrem = darkpoolDiscordMinPremium();

  if (!input.rows.length) {
    return {
      title: `🌑 Dark Pool · Top blocks · last ${input.windowMin}m`,
      description: `Quiet tape — no blocks ≥${moneyShort(minPrem)} in the last ${input.windowMin} minutes.`,
      color: 0x64748b,
      footer: { text: `BlackOut Dark Pool · ${et} ET` },
      timestamp: now.toISOString(),
    };
  }

  const head = `Top ${input.rows.length} institutional blocks in the last **${input.windowMin} minutes** · ≥${moneyShort(minPrem)}.\n`;
  const body = input.rows
    .map((p, i) => {
      const ts = formatHelixHitTimestampEt(p.executed_at, { date: false });
      const label = `${p.ticker} · ${moneyShort(p.premium)}${fmtPrice(p.price)} · ${sideLabel(p.side)} · ${ts} ET`;
      return `**${i + 1}.** [${label}](${darkpoolPrintToDeepLink(p)})`;
    })
    .join("\n");

  const leadUrl = input.rows[0] ? darkpoolPrintToDeepLink(input.rows[0]) : `${APP_BASE}/flows`;

  return {
    title: `🌑 Dark Pool · Top blocks · last ${input.windowMin}m`,
    description: `${head}\n${body}\n\n[Open HELIX desk](${APP_BASE}/flows)`,
    color: 0x6366f1,
    footer: { text: `BlackOut Dark Pool · ${et} ET · ${input.inWindowCount} in window` },
    timestamp: now.toISOString(),
    url: leadUrl,
  };
}

export function selectDarkpoolDigestPrints(
  prints: readonly DarkPoolDiscordPrint[],
  opts?: { windowMin?: number; now?: Date; limit?: number; minPremium?: number }
): { rows: DarkPoolDiscordPrint[]; inWindowCount: number } {
  const windowMin = opts?.windowMin ?? 15;
  const windowMs = windowMin * 60_000;
  const nowMs = (opts?.now ?? new Date()).getTime();
  const limit = opts?.limit ?? DARKPOOL_DISCORD_DIGEST_LIMIT;
  const minPremium = opts?.minPremium ?? darkpoolDiscordMinPremium();

  const eligible = prints.filter((p) => passesDarkpoolDiscordFilters(p, minPremium));
  const inWindow = eligible.filter((p) => {
    const ms = new Date(p.executed_at).getTime();
    // Same future-print guard as Helix's Repeat Hits/digest filters: a future-dated/clock-skewed
    // executed_at makes nowMs - ms negative, trivially satisfying <= windowMs and getting counted
    // as an in-window block for the digest ranking.
    const age = signalWindowAgeMs(Number.isFinite(ms) ? ms : null, nowMs);
    return age != null && age <= windowMs;
  });

  const rows = [...inWindow]
    .sort((a, b) => b.premium - a.premium || new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())
    .slice(0, limit);

  return { rows, inWindowCount: inWindow.length };
}

/** Live WS/cron pings — default ON (route cron has DARKPOOL_DISCORD_RTH_ONLY). */
export function darkpoolDiscordLiveRthOnly(): boolean {
  const v = process.env.DARKPOOL_DISCORD_LIVE_RTH_ONLY?.trim().toLowerCase();
  if (v == null || v === "") return true;
  return v === "1" || v === "true" || v === "yes";
}

export function buildDarkpoolBurstEmbed(input: {
  ticker: string;
  prints: readonly DarkPoolDiscordPrint[];
  windowMin: number;
  now?: Date;
}): DiscordEmbed {
  const now = input.now ?? new Date();
  const ticker = input.ticker.toUpperCase();
  const total = input.prints.reduce((s, p) => s + p.premium, 0);
  const buys = input.prints.filter((p) => p.side === "buy").length;
  const sells = input.prints.filter((p) => p.side === "sell").length;
  const et = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const lines = input.prints.slice(0, 6).map((p) => {
    const side = p.side === "buy" ? "BUY" : p.side === "sell" ? "SELL" : "—";
    const label = `${moneyShort(p.premium)}${fmtPrice(p.price)} · ${side}`;
    return `• [${label}](${darkpoolPrintToDeepLink(p)})`;
  });
  const more =
    input.prints.length > 6
      ? `\n_…and ${input.prints.length - 6} more block${input.prints.length - 6 === 1 ? "" : "s"}_`
      : "";

  return {
    title: `🌑 Dark Pool · ${ticker} burst (${input.prints.length} blocks)`,
    description:
      `**${moneyShort(total)}** in ~${input.windowMin}m · ${buys} buy / ${sells} sell\n\n` +
      `${lines.join("\n")}${more}\n\n[Open ${ticker} dark pool in HELIX](${buildHelixDarkpoolDeepLink({
        ticker,
        executed_at: input.prints[input.prints.length - 1]?.executed_at ?? "",
        premium: input.prints[input.prints.length - 1]?.premium ?? 0,
      })})`,
    color: 0x6366f1,
    footer: { text: "BlackOut Dark Pool" },
    timestamp: now.toISOString(),
    url: darkpoolPrintToDeepLink(input.prints[input.prints.length - 1] ?? { ticker, premium: total, side: "neutral", executed_at: now.toISOString() }),
  };
}
