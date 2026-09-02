/**
 * Push Legacy (Night Hawk evening playbook) plays into the Chief Trade Alert Bot —
 * same BTO/STC embed format and FIFO PnL as 0DTE Command and manual desk entries.
 *
 * Hooks:
 *   - Edition publish → BTO for every ranked play with a parseable option contract
 *   - legacy-live-sync cron → TRIM/STC on premium + stock stop/target (plan) or scale-out rule
 *   - Morning INVALIDATED → STC (clears virtual book when pre-market pulls a play)
 *   - Outcomes target/stop → STC at real option session mark (Polygon bar, heuristic fallback)
 *
 * Fire-and-forget: never throws into edition/morning/outcomes crons.
 */
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { parseOptionsContract } from "@/features/nighthawk/lib/option-contract-parse";
import {
  chiefTradeVirtualLots,
  formatZeroDteExpiry,
  formatZeroDteStrike,
  postChiefTrade,
  type BuildTradePayloadOpts,
  type ChiefTradePayload,
} from "@/lib/zerodte/discord-trade-notify";

export type LegacyTradeDiscordInput = {
  edition_for: string;
  ticker: string;
  direction: "long" | "short";
  top_strike: number;
  expiry: string;
  entry_premium: number;
  options_play?: string | null;
  last_mark?: number | null;
  trims_taken?: number;
};

export function legacyDiscordAlertsEnabled(): boolean {
  const raw = process.env.LEGACY_DISCORD_ALERTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Legacy desk channel — separate from 0DTE Command (CHIEF_TRADE_CHANNEL_ID on the bot). */
export function legacyChiefTradeChannelId(): string | null {
  const raw = process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID?.trim();
  return raw || null;
}

function legacyAuthorName(): string {
  return process.env.LEGACY_DISCORD_AUTHOR_NAME?.trim() || "night-hawk-legacy";
}

/** Map options_play side (+ play direction fallback) → Chief Trade long/short strike suffix. */
export function legacyOptionDirection(
  play: Pick<PlaybookPlay, "direction" | "options_play">
): "long" | "short" | null {
  const parsed = parseOptionsContract(play.options_play ?? "");
  if (parsed?.side === "call") return "long";
  if (parsed?.side === "put") return "short";
  const dir = String(play.direction ?? "LONG").toUpperCase();
  if (dir.includes("SHORT")) return "short";
  if (dir.includes("LONG")) return "long";
  return null;
}

export function legacyInputFromPlaybookPlay(
  editionFor: string,
  play: PlaybookPlay
): LegacyTradeDiscordInput | null {
  const parsed = parseOptionsContract(play.options_play ?? "");
  if (!parsed?.expiryYmd || !Number.isFinite(parsed.strike) || parsed.strike <= 0) return null;

  const premium = play.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;

  const direction = legacyOptionDirection(play);
  if (!direction) return null;

  return {
    edition_for: editionFor,
    ticker: play.ticker.toUpperCase(),
    direction,
    top_strike: parsed.strike,
    expiry: parsed.expiryYmd,
    entry_premium: premium,
    options_play: play.options_play,
  };
}

export function legacyInputFromOutcomeRow(
  row: NighthawkPlayOutcomeRow
): LegacyTradeDiscordInput | null {
  const ctx = row.publish_context as { final_output?: Record<string, unknown> } | null | undefined;
  const finalOut = ctx?.final_output;
  const optionsPlay = typeof finalOut?.options_play === "string" ? finalOut.options_play : null;
  const entryPremium =
    typeof finalOut?.entry_premium === "number" && Number.isFinite(finalOut.entry_premium)
      ? finalOut.entry_premium
      : null;
  if (!optionsPlay || entryPremium == null || entryPremium <= 0) return null;

  const parsed = parseOptionsContract(optionsPlay);
  if (!parsed?.expiryYmd || !Number.isFinite(parsed.strike) || parsed.strike <= 0) return null;

  const direction =
    parsed.side === "put"
      ? "short"
      : parsed.side === "call"
        ? "long"
        : row.direction === "SHORT"
          ? "short"
          : "long";

  return {
    edition_for: row.edition_for,
    ticker: row.ticker.toUpperCase(),
    direction,
    top_strike: parsed.strike,
    expiry: parsed.expiryYmd,
    entry_premium: entryPremium,
    options_play: optionsPlay,
  };
}

export function buildLegacyTradePayload(
  row: LegacyTradeDiscordInput,
  action: "BTO" | "STC",
  price: number,
  opts: BuildTradePayloadOpts = {}
): ChiefTradePayload | null {
  const strike = formatZeroDteStrike(row.top_strike, row.direction);
  const expiry = formatZeroDteExpiry(row.expiry);
  if (!strike || !expiry || !Number.isFinite(price) || price <= 0) return null;

  const ticker = row.ticker.toUpperCase();
  const virtualLots = chiefTradeVirtualLots();
  const trimmed = row.trims_taken ?? 0;

  let qty = opts.qty ?? (action === "BTO" ? virtualLots : Math.max(1, virtualLots - trimmed));
  qty = Math.max(1, Math.floor(qty));

  const suffix = opts.idempotencySuffix ?? action.toLowerCase();

  const channelId = legacyChiefTradeChannelId();
  return {
    action,
    qty,
    ticker,
    strike,
    expiry,
    price,
    idempotency_key: `legacy:${row.edition_for}:${ticker}:${suffix}`,
    author_name: legacyAuthorName(),
    ...(channelId ? { channel_id: channelId } : {}),
  };
}

/** Rough option exit fallback when no live/session mark is available. */
export function legacyOutcomeExitPremium(
  entryPremium: number,
  outcome: "target" | "stop" | "open" | "ambiguous" | "unfilled"
): number {
  if (outcome === "target") return Number((entryPremium * 1.35).toFixed(2));
  if (outcome === "stop") return Number((entryPremium * 0.65).toFixed(2));
  return entryPremium;
}

/** Fetch the option session close mark for EOD grade / STC. Falls back to heuristic. */
export async function resolveLegacyOutcomeExitPremium(
  input: LegacyTradeDiscordInput,
  outcome: "target" | "stop" | "open" | "ambiguous" | "unfilled",
  sessionDate: string
): Promise<number> {
  const fallback = legacyOutcomeExitPremium(input.entry_premium, outcome);
  if (!input.options_play) return fallback;

  try {
    const { resolveLegacyPlayOcc } = await import("@/features/nighthawk/lib/legacy-play-contract");
    const occ = resolveLegacyPlayOcc(input.ticker, input.options_play);
    if (!occ) return fallback;

    const { fetchPolygonOptionBars } = await import("@/lib/providers/polygon-largo");
    const bars = await fetchPolygonOptionBars(occ, 1, "day", sessionDate, sessionDate, "5");
    const close = bars[bars.length - 1]?.c;
    if (close != null && Number.isFinite(close) && close > 0) {
      return Number(close.toFixed(2));
    }

    const { fetchLegacyOptionMarksServer } = await import(
      "@/features/nighthawk/lib/legacy-option-marks-server"
    );
    const marks = await fetchLegacyOptionMarksServer([occ], { includeStale: true });
    const live = marks.get(occ.toUpperCase())?.mark;
    if (live != null && Number.isFinite(live) && live > 0) {
      return Number(live.toFixed(2));
    }
  } catch {
    // fail-soft — heuristic below
  }
  return fallback;
}

/** Edition publish → BTO every ranked play with a valid option contract. */
export async function notifyLegacyEditionPlays(
  editionFor: string,
  plays: PlaybookPlay[]
): Promise<{ posted: number; skipped: number }> {
  if (!legacyDiscordAlertsEnabled()) return { posted: 0, skipped: plays.length };

  let posted = 0;
  let skipped = 0;
  for (const play of plays) {
    const ok = await notifyLegacyTradeOpen(editionFor, play);
    if (ok) posted += 1;
    else skipped += 1;
  }
  return { posted, skipped };
}

/** Single play BTO at publish / confirm. */
export async function notifyLegacyTradeOpen(
  editionFor: string,
  play: PlaybookPlay
): Promise<boolean> {
  if (!legacyDiscordAlertsEnabled()) return false;
  const input = legacyInputFromPlaybookPlay(editionFor, play);
  if (!input) return false;
  const payload = buildLegacyTradePayload(input, "BTO", input.entry_premium);
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** trim_scale tranche banked → partial STC (only when CHIEF_TRADE_VIRTUAL_LOTS > 1). */
export async function notifyLegacyTradeTrim(
  input: LegacyTradeDiscordInput,
  trimIndex: number,
  trimPrice?: number | null
): Promise<boolean> {
  if (!legacyDiscordAlertsEnabled()) return false;
  if (chiefTradeVirtualLots() <= 1) return false;
  const price = trimPrice ?? input.last_mark;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildLegacyTradePayload(input, "STC", price, {
    qty: 1,
    idempotencySuffix: `trim:${trimIndex}`,
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Ratchet / first TRIM latch → bank one virtual lot when lots ≥ 2. */
export async function notifyLegacyTradeTrimLatch(
  input: LegacyTradeDiscordInput,
  trimPrice?: number | null
): Promise<boolean> {
  if (!legacyDiscordAlertsEnabled()) return false;
  if (chiefTradeVirtualLots() < 2) return false;
  if ((input.trims_taken ?? 0) > 0) return false;
  return notifyLegacyTradeTrim(input, 1, trimPrice);
}

/** Scale-out partial at 2× → STC one lot (virtual lots ≥ 2) or status-only. */
export async function notifyLegacyScaleOutPartial(
  input: LegacyTradeDiscordInput,
  trimIndex: number,
  trimPrice?: number | null
): Promise<boolean> {
  if (!legacyDiscordAlertsEnabled()) return false;
  if (chiefTradeVirtualLots() <= 1) return false;
  return notifyLegacyTradeTrim({ ...input, trims_taken: trimIndex - 1 }, trimIndex, trimPrice);
}

/** Morning pull or EOD grade → STC. */
export async function notifyLegacyTradeClose(
  input: LegacyTradeDiscordInput,
  exitPrice?: number | null,
  opts: Pick<BuildTradePayloadOpts, "idempotencySuffix"> = {}
): Promise<boolean> {
  if (!legacyDiscordAlertsEnabled()) return false;
  const price = exitPrice ?? input.entry_premium;
  if (!Number.isFinite(price) || price <= 0) return false;
  const payload = buildLegacyTradePayload(input, "STC", price, {
    idempotencySuffix: opts.idempotencySuffix ?? "stc",
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Outcome row resolved to target/stop → STC with real session option mark. */
export async function notifyLegacyOutcomeClose(
  row: NighthawkPlayOutcomeRow,
  outcome: "target" | "stop"
): Promise<boolean> {
  const input = legacyInputFromOutcomeRow(row);
  if (!input) return false;
  const { outcomeSessionDate } = await import("@/features/nighthawk/lib/play-outcomes");
  const exit = await resolveLegacyOutcomeExitPremium(input, outcome, outcomeSessionDate(row));
  return notifyLegacyTradeClose(input, exit, { idempotencySuffix: `stc:${outcome}` });
}
