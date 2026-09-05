/**
 * Push committed Banger (Engine B) positions into the Chief Trade Alert Bot so members get
 * the same BTO/STC embed format and FIFO PnL tracking as 0DTE, Legacy, and Swing.
 *
 * Hooks:
 *   - banger-discovery commit → BTO on fresh real-money open
 *   - banger-live-sync scale-out → partial STC on TAKE_PARTIAL; terminal STC on EXIT_RUNNER/STOP_OUT
 *
 * Fire-and-forget: never throws into discovery/live-sync crons.
 */
import type { BangerPositionInsert, BangerPositionRow } from "@/lib/banger/positions-db";
import type { ScaleOutAction } from "@/lib/zerodte/scale-out";
import { SCALE_OUT_RULES } from "@/lib/zerodte/scale-out";
import {
  chiefTradeVirtualLots,
  formatZeroDteExpiry,
  formatZeroDteStrike,
  postChiefTrade,
  type BuildTradePayloadOpts,
  type ChiefTradePayload,
} from "@/lib/zerodte/discord-trade-notify";

export type BangerTradeDiscordInput = {
  session_date: string;
  position_id: number;
  ticker: string;
  contract_strike: number;
  contract_expiry: string;
  entry_premium: number;
  last_mark?: number | null;
  scaled_already?: boolean;
};

export function bangerDiscordAlertsEnabled(): boolean {
  const raw = process.env.BANGER_DISCORD_ALERTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Banger desk channel — separate from 0DTE, Legacy, and Swing. */
export function bangerChiefTradeChannelId(): string | null {
  const raw = process.env.BANGER_CHIEF_TRADE_CHANNEL_ID?.trim();
  return raw || null;
}

function bangerAuthorName(): string {
  return process.env.BANGER_DISCORD_AUTHOR_NAME?.trim() || "banger-desk";
}

/** Engine B breakout plays are always long calls. */
const BANGER_DIRECTION = "long" as const;

export function bangerInputFromRow(row: BangerPositionRow): BangerTradeDiscordInput | null {
  const premium = row.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  return {
    session_date: row.session_date,
    position_id: row.id,
    ticker: row.ticker.toUpperCase(),
    contract_strike: row.contract_strike,
    contract_expiry: row.contract_expiry,
    entry_premium: premium,
    last_mark: row.last_mark,
    scaled_already: row.scaled_already,
  };
}

export function bangerInputFromInsert(
  positionId: number,
  insert: BangerPositionInsert
): BangerTradeDiscordInput | null {
  const premium = insert.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  return {
    session_date: insert.session_date,
    position_id: positionId,
    ticker: insert.ticker.toUpperCase(),
    contract_strike: insert.contract_strike,
    contract_expiry: insert.contract_expiry,
    entry_premium: premium,
  };
}

export function buildBangerTradePayload(
  row: BangerTradeDiscordInput,
  action: "BTO" | "STC",
  price: number,
  opts: BuildTradePayloadOpts = {}
): ChiefTradePayload | null {
  const strike = formatZeroDteStrike(row.contract_strike, BANGER_DIRECTION);
  const expiry = formatZeroDteExpiry(row.contract_expiry);
  if (!strike || !expiry || !Number.isFinite(price) || price <= 0) return null;

  const ticker = row.ticker.toUpperCase();
  const virtualLots = chiefTradeVirtualLots();
  let qty = opts.qty ?? (action === "BTO" ? virtualLots : virtualLots);
  qty = Math.max(1, Math.floor(qty));

  const suffix = opts.idempotencySuffix ?? action.toLowerCase();
  const channelId = bangerChiefTradeChannelId();

  return {
    action,
    qty,
    ticker,
    strike,
    expiry,
    price,
    idempotency_key: `banger:${row.position_id}:${suffix}`,
    author_name: bangerAuthorName(),
    ...(channelId ? { channel_id: channelId } : {}),
  };
}

/** Fresh COMMIT → BTO embed under the banger desk author. */
export async function notifyBangerTradeOpen(input: BangerTradeDiscordInput): Promise<boolean> {
  if (!bangerDiscordAlertsEnabled()) return false;
  const price = input.entry_premium;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildBangerTradePayload(input, "BTO", price, { idempotencySuffix: "bto" });
  if (!payload) return false;
  return postChiefTrade(payload);
}

export async function notifyBangerTradeOpenFromInsert(
  positionId: number,
  insert: BangerPositionInsert
): Promise<boolean> {
  const input = bangerInputFromInsert(positionId, insert);
  if (!input) return false;
  return notifyBangerTradeOpen(input);
}

/** Partial scale-out at 2× — banks scale_fraction of the virtual book. */
export async function notifyBangerTradePartial(
  input: BangerTradeDiscordInput,
  mark?: number | null
): Promise<boolean> {
  if (!bangerDiscordAlertsEnabled()) return false;
  const price = mark ?? input.last_mark ?? input.entry_premium * SCALE_OUT_RULES.scale_at_mult;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;

  const virtualLots = chiefTradeVirtualLots();
  const qty = Math.max(1, Math.floor(virtualLots * SCALE_OUT_RULES.scale_fraction));
  const payload = buildBangerTradePayload(input, "STC", price, {
    qty,
    idempotencySuffix: "partial",
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Terminal EXIT_RUNNER / STOP_OUT — STC remaining virtual lots. */
export async function notifyBangerTradeClose(
  input: BangerTradeDiscordInput,
  action: "EXIT_RUNNER" | "STOP_OUT",
  exitPrice?: number | null,
  opts: Pick<BuildTradePayloadOpts, "idempotencySuffix"> = {}
): Promise<boolean> {
  if (!bangerDiscordAlertsEnabled()) return false;

  const virtualLots = chiefTradeVirtualLots();
  const scaled = input.scaled_already ?? false;
  const remainingQty = scaled
    ? Math.max(1, Math.floor(virtualLots * (1 - SCALE_OUT_RULES.scale_fraction)))
    : virtualLots;

  let price = exitPrice ?? input.last_mark ?? input.entry_premium;
  if (action === "STOP_OUT") {
    price = input.entry_premium * SCALE_OUT_RULES.hard_stop_mult;
  }
  if (price == null || !Number.isFinite(price) || price <= 0) return false;

  const suffix =
    opts.idempotencySuffix ??
    (action === "EXIT_RUNNER" ? "exit_runner" : action === "STOP_OUT" ? "stop_out" : "stc");

  const payload = buildBangerTradePayload(input, "STC", price, {
    qty: remainingQty,
    idempotencySuffix: suffix,
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Live-sync scale-out transition → partial or terminal STC. */
export async function notifyBangerFromScaleOutAction(
  input: BangerTradeDiscordInput,
  scaleAction: ScaleOutAction,
  mark?: number | null
): Promise<boolean> {
  if (!bangerDiscordAlertsEnabled() || scaleAction === "HOLD") return false;

  if (scaleAction === "TAKE_PARTIAL") {
    return notifyBangerTradePartial(input, mark);
  }
  if (scaleAction === "EXIT_RUNNER") {
    return notifyBangerTradeClose(input, "EXIT_RUNNER", mark, { idempotencySuffix: "exit_runner" });
  }
  if (scaleAction === "STOP_OUT") {
    return notifyBangerTradeClose(input, "STOP_OUT", mark, { idempotencySuffix: "stop_out" });
  }
  return false;
}
