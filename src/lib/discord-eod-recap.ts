/**
 * End-of-day (~4:05 PM ET) Discord recap embeds for HELIX + dark pool channels.
 */
import { moneyShort, type HelixDiscordFlowInput } from "@/lib/helix-discord-format";
import type { DiscordEmbed } from "@/lib/helix-discord-format";
import type { DarkPoolDiscordPrint } from "@/lib/darkpool-discord-format";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/lib/et-date";
import { sharedCacheSetNx } from "@/lib/shared-cache";

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

/** ~4:05 PM ET window — dark pool cron (2m) and HELIX digest (15m) both land here. */
export function isDiscordEodRecapWindow(now = new Date()): boolean {
  if (isEtCashRth(now)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return hour === 16 && minute >= 4 && minute <= 14;
}

export function eodRecapDedupKey(channel: "helix" | "darkpool", sessionDate: string): string {
  return `discord-eod:${channel}:${sessionDate}`;
}

export async function claimDiscordEodRecap(
  channel: "helix" | "darkpool",
  sessionDate: string,
  bypass = false
): Promise<boolean> {
  if (bypass) return true;
  return sharedCacheSetNx(eodRecapDedupKey(channel, sessionDate), { at: new Date().toISOString() }, 20 * 60 * 60);
}

function sessionOpenMs(sessionDate: string): number {
  return Date.parse(`${sessionDate}T13:30:00.000Z`); // 9:30 AM ET (EDT approx; filter is coarse)
}

export function filterHelixSessionFlows(
  flows: readonly HelixDiscordFlowInput[],
  sessionDate: string,
  now = new Date()
): HelixDiscordFlowInput[] {
  const openMs = sessionOpenMs(sessionDate);
  const endMs = now.getTime();
  return flows.filter((f) => {
    const iso = f.event_at || f.alerted_at;
    if (!iso) return false;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) && ms >= openMs && ms <= endMs;
  });
}

export function filterDarkpoolSessionPrints(
  prints: readonly DarkPoolDiscordPrint[],
  sessionDate: string,
  now = new Date()
): DarkPoolDiscordPrint[] {
  const openMs = sessionOpenMs(sessionDate);
  const endMs = now.getTime();
  return prints.filter((p) => {
    const ms = new Date(p.executed_at).getTime();
    return Number.isFinite(ms) && ms >= openMs && ms <= endMs;
  });
}

export function buildHelixEodRecapEmbed(input: {
  flows: readonly HelixDiscordFlowInput[];
  sessionDate: string;
  now?: Date;
}): DiscordEmbed {
  const now = input.now ?? new Date();
  const et = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    month: "short",
    day: "numeric",
  });
  const session = filterHelixSessionFlows(input.flows, input.sessionDate, now);
  const ranked = [...session].sort((a, b) => Number(b.premium) - Number(a.premium)).slice(0, 5);
  const totalPrem = session.reduce((s, f) => s + Number(f.premium), 0);

  if (!ranked.length) {
    return {
      title: "📋 HELIX · Session recap",
      description: `No qualifying whale prints today (${input.sessionDate}).`,
      color: 0x64748b,
      footer: { text: `BlackOut HELIX · ${et} ET` },
      timestamp: now.toISOString(),
    };
  }

  const body = ranked
    .map((f, i) => {
      const side = String(f.option_type || "").toUpperCase().startsWith("C") ? "C" : "P";
      const fill =
        f.fill_price != null && Number.isFinite(Number(f.fill_price))
          ? ` @ $${Number(f.fill_price) % 1 ? Number(f.fill_price).toFixed(2) : Number(f.fill_price)}`
          : "";
      return `**${i + 1}. ${String(f.ticker).toUpperCase()}** ${f.strike}${side}${fill} · ${moneyShort(Number(f.premium))}`;
    })
    .join("\n");

  return {
    title: "📋 HELIX · Session recap",
    description:
      `**${session.length}** qualifying prints · **${moneyShort(totalPrem)}** total premium\n\n` +
      `${body}\n\n[Open in HELIX](${APP_BASE}/flows)`,
    color: 0x22d3ee,
    footer: { text: `BlackOut HELIX · ${et} ET · ${input.sessionDate}` },
    timestamp: now.toISOString(),
    url: `${APP_BASE}/flows`,
  };
}

export function buildDarkpoolEodRecapEmbed(input: {
  prints: readonly DarkPoolDiscordPrint[];
  sessionDate: string;
  now?: Date;
}): DiscordEmbed {
  const now = input.now ?? new Date();
  const et = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    month: "short",
    day: "numeric",
  });
  const session = filterDarkpoolSessionPrints(input.prints, input.sessionDate, now);
  const ranked = [...session].sort((a, b) => b.premium - a.premium).slice(0, 5);
  const total = session.reduce((s, p) => s + p.premium, 0);
  const buys = session.filter((p) => p.side === "buy").length;
  const sells = session.filter((p) => p.side === "sell").length;

  if (!ranked.length) {
    return {
      title: "📋 Dark Pool · Session recap",
      description: `No qualifying blocks today (${input.sessionDate}).`,
      color: 0x64748b,
      footer: { text: `BlackOut Dark Pool · ${et} ET` },
      timestamp: now.toISOString(),
    };
  }

  const body = ranked
    .map((p, i) => {
      const side = p.side === "buy" ? "BUY" : p.side === "sell" ? "SELL" : "—";
      return `**${i + 1}. ${p.ticker}** · ${moneyShort(p.premium)} · ${side}`;
    })
    .join("\n");

  return {
    title: "📋 Dark Pool · Session recap",
    description:
      `**${session.length}** blocks · **${moneyShort(total)}** notional · ${buys} buy / ${sells} sell\n\n` +
      `${body}\n\n[Open in HELIX](${APP_BASE}/flows)`,
    color: 0x6366f1,
    footer: { text: `BlackOut Dark Pool · ${et} ET · ${input.sessionDate}` },
    timestamp: now.toISOString(),
    url: `${APP_BASE}/flows`,
  };
}

/** Convenience for cron routes. */
export function currentSessionDateEt(now = new Date()): string {
  return todayEt(now);
}
