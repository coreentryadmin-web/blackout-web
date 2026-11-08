/**
 * End-of-day (~4:05 PM ET) Discord recap embeds for HELIX + dark pool channels.
 */
import { moneyShort, type HelixDiscordFlowInput } from "@/lib/helix-discord-format";
import type { DiscordEmbed } from "@/lib/helix-discord-format";
import type { DarkPoolDiscordPrint } from "@/lib/darkpool-discord-format";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/lib/et-date";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { sharedCacheSetNx } from "@/lib/shared-cache";

import { buildHelixFlowDeepLink, buildHelixDarkpoolDeepLink } from "@/lib/helix-flow-deep-link";

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

/**
 * ~4:05-4:15 PM ET window — dark pool cron (`*\/2` UTC minute, every 2min) and HELIX digest
 * (`*\/15` UTC minute, every 15min — railway.helix-discord-digest.toml / cron-registry.ts) both
 * land here.
 *
 * Upper bound is 15, not 14: the HELIX digest cron ticks at exact ET quarter-hours (:00/:15/:30/
 * :45 — the UTC->ET offset is always a whole number of hours, so the minute component is
 * identical in both zones). A bound of 14 excludes BOTH of its ticks nearest the 4 PM close —
 * :00 (still inside isEtCashRth, since isEtCashRth's close boundary is inclusive, so that tick
 * never reaches this window-check at all) and :15 (1 minute past the old 14-minute cutoff) — so
 * the HELIX EOD recap branch in helix-discord-digest/route.ts could never execute: every real
 * cron tick landed either before minute 4 (:00, swallowed by the RTH gate upstream) or after
 * minute 14 (:15, where this function itself returned false and the route's outer
 * `!isEtCashRth && !isDiscordEodRecapWindow` check skipped the whole request as "Outside cash
 * RTH" before the EOD branch ever ran). The dark pool EOD recap was unaffected because its 2min
 * cron already has ticks at :04/:06/.../:14, all inside the old window. Confirmed live via the
 * deployed schedules: 15<=14 was a latent dead-window — isDiscordEodRecapWindow(16:00)===false
 * and isDiscordEodRecapWindow(16:15)===false, the HELIX cron's only two candidate ticks.
 */
export function isDiscordEodRecapWindow(now = new Date()): boolean {
  if (isEtCashRth(now)) return false;
  const sessionDay = todayEt(now);
  if (!isTradingDayEt(sessionDay)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return hour === 16 && minute >= 4 && minute <= 15;
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
  // fail OPEN on a Redis error — a missed dedup window is a harmless duplicate post
  return sharedCacheSetNx(eodRecapDedupKey(channel, sessionDate), { at: new Date().toISOString() }, 20 * 60 * 60).catch(
    () => true
  );
}

/**
 * UTC offset (whole hours, negative) America/New_York observes on `sessionDate` — -4 under
 * EDT, -5 under EST. Read at noon UTC on that calendar date, safely past the 2 AM local DST
 * transition, so the one date-dependent read never straddles the flip itself.
 */
function etUtcOffsetHours(sessionDate: string): number {
  const noonUtc = new Date(`${sessionDate}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(noonUtc);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = raw.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) : -5;
}

/**
 * 9:30 AM ET in UTC ms for `sessionDate` — DST-correct (was a hardcoded "T13:30:00.000Z",
 * which is only 9:30 AM ET under EDT; under EST, 9:30 AM ET is 14:30 UTC, so the old
 * constant read as 8:30 AM ET and let an hour of pre-market flow leak into the EOD
 * session-recap filter as if it were regular-session activity).
 */
function sessionOpenMs(sessionDate: string): number {
  const offsetHours = etUtcOffsetHours(sessionDate);
  const utcHour = String(9 - offsetHours).padStart(2, "0");
  return Date.parse(`${sessionDate}T${utcHour}:30:00.000Z`);
}

/**
 * Hours elapsed since 9:30 AM ET on `sessionDate`, as of `now`. Exists so a caller building
 * the EOD recap can size its own DB fetch window to cover the WHOLE session — a fixed
 * `since_hours` sized for a 15/30-minute live digest (e.g. 6h) silently excludes the first
 * ~35-45 minutes of the session by the time the EOD window opens at ~4:04 PM ET (6h34m-6h44m
 * after a 9:30 open), at the SQL `WHERE` clause, before any in-process session filter ever
 * sees those rows. Floors at 0 so a call before session open never returns negative.
 */
export function hoursSinceSessionOpenEt(sessionDate: string, now = new Date()): number {
  return Math.max(0, (now.getTime() - sessionOpenMs(sessionDate)) / 3_600_000);
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
  /**
   * True when `flows` is itself a LIMIT-capped fetch that returned exactly its cap (i.e. the
   * caller's DB query hit its row ceiling for the whole session, not just for the narrow
   * 15/30-min live-digest window the same ceiling was originally sized for). See the caller's
   * own comment (helix-discord-digest/route.ts) and the regression test below for the concrete
   * shape: on a busy session, more whale prints can clear the $500k/≤30DTE filter over a full
   * ~6-7h RTH session than the 400-row cap sized for a 15-minute slice ever allows through, so
   * `session.length`/`totalPrem` below silently UNDERCOUNT rather than reporting the session's
   * true total — exactly the "total capped at sample-query LIMIT" shape this file's sibling
   * fixes (error-sink.ts's countAuthFailures, admin-gex-health.ts's summarizeRegimeEvents)
   * already closed for their own dashboards. Reproducing the EXACT qualifying count here would
   * require re-deriving `fill_price` in raw SQL (a nontrivial JSON-payload cast the row fetch
   * itself needs several CASE branches for — see db.ts's `fetchRecentFlows`), so rather than
   * duplicate that logic and risk it drifting out of sync, an honest "+" suffix is used instead:
   * never silently present a certainly-incomplete sample as an exact total.
   */
  truncated?: boolean;
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
  const plus = input.truncated ? "+" : "";

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
      const label = `${String(f.ticker).toUpperCase()} ${f.strike}${side}${fill} · ${moneyShort(Number(f.premium))}`;
      return `**${i + 1}.** [${label}](${buildHelixFlowDeepLink({
        ticker: f.ticker,
        alert_id: f.alert_id ?? null,
        strike: f.strike,
        expiry: f.expiry,
        option_type: f.option_type,
        at: f.event_at ?? f.alerted_at ?? null,
        premium: f.premium,
      })})`;
    })
    .join("\n");

  const lead = ranked[0]!;
  const leadUrl = buildHelixFlowDeepLink({
    ticker: lead.ticker,
    alert_id: lead.alert_id ?? null,
    strike: lead.strike,
    expiry: lead.expiry,
    option_type: lead.option_type,
    at: lead.event_at ?? lead.alerted_at ?? null,
    premium: lead.premium,
  });

  return {
    title: "📋 HELIX · Session recap",
    description:
      `**${session.length}${plus}** qualifying prints · **${moneyShort(totalPrem)}${plus}** total premium\n\n` +
      `${body}\n\n[Open HELIX desk](${APP_BASE}/flows)`,
    color: 0x22d3ee,
    footer: { text: `BlackOut HELIX · ${et} ET · ${input.sessionDate}` },
    timestamp: now.toISOString(),
    url: leadUrl,
  };
}

export function buildDarkpoolEodRecapEmbed(input: {
  prints: readonly DarkPoolDiscordPrint[];
  sessionDate: string;
  now?: Date;
  /** Same meaning as `buildHelixEodRecapEmbed`'s own `truncated` — true when `prints` is a
   *  capped provider fetch (see the caller's own known cap) that returned exactly its cap, so
   *  the session's real block count/notional may exceed what is shown here. */
  truncated?: boolean;
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
  const plus = input.truncated ? "+" : "";

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
      const label = `${p.ticker} · ${moneyShort(p.premium)} · ${side}`;
      return `**${i + 1}.** [${label}](${buildHelixDarkpoolDeepLink({
        ticker: p.ticker,
        executed_at: p.executed_at,
        premium: p.premium,
      })})`;
    })
    .join("\n");

  const lead = ranked[0]!;

  return {
    title: "📋 Dark Pool · Session recap",
    description:
      `**${session.length}${plus}** blocks · **${moneyShort(total)}${plus}** notional · ${buys} buy / ${sells} sell\n\n` +
      `${body}\n\n[Open HELIX desk](${APP_BASE}/flows)`,
    color: 0x6366f1,
    footer: { text: `BlackOut Dark Pool · ${et} ET · ${input.sessionDate}` },
    timestamp: now.toISOString(),
    url: buildHelixDarkpoolDeepLink({
      ticker: lead.ticker,
      executed_at: lead.executed_at,
      premium: lead.premium,
    }),
  };
}

/** Convenience for cron routes. */
export function currentSessionDateEt(now = new Date()): string {
  return todayEt(now);
}
