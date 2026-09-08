/**
 * Push committed Swing positions into the Chief Trade Alert Bot so members get
 * the same BTO/STC embed format and FIFO PnL tracking as 0DTE Command and Legacy.
 *
 * Hooks:
 *   - swing-discovery commit → BTO on fresh real-money open
 *   - swing-active-refresh gating roll/close → STC (and BTO on roll child)
 *
 * Fire-and-forget: never throws into discovery/active-refresh crons.
 */
import type { SwingPositionInsert, SwingPositionRow } from "@/lib/db";
import type { RollOutcome } from "./roll";
import {
  chiefTradeVirtualLots,
  formatZeroDteExpiry,
  formatZeroDteStrike,
  postChiefTrade,
  type BuildTradePayloadOpts,
  type ChiefTradePayload,
} from "@/lib/zerodte/discord-trade-notify";

export type SwingTradeDiscordInput = {
  session_date: string;
  position_id: number;
  roll_seq: number;
  ticker: string;
  direction: "long" | "short";
  contract_strike: number | null;
  contract_expiry: string | null;
  entry_premium: number | null;
  last_mark?: number | null;
};

export function swingDiscordAlertsEnabled(): boolean {
  const raw = process.env.SWING_DISCORD_ALERTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Swing desk channel — separate from 0DTE Command and Legacy. */
export function swingChiefTradeChannelId(): string | null {
  const raw = process.env.SWING_CHIEF_TRADE_CHANNEL_ID?.trim();
  return raw || null;
}

function swingAuthorName(): string {
  return process.env.SWING_DISCORD_AUTHOR_NAME?.trim() || "swing-desk";
}

export function swingInputFromRow(row: SwingPositionRow): SwingTradeDiscordInput | null {
  if (row.contract_strike == null || !row.contract_expiry) return null;
  const premium = row.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  return {
    session_date: row.session_date,
    position_id: row.id,
    roll_seq: row.roll_seq,
    ticker: row.ticker.toUpperCase(),
    direction: row.direction,
    contract_strike: row.contract_strike,
    contract_expiry: row.contract_expiry,
    entry_premium: premium,
    last_mark: row.last_mark,
  };
}

export function swingInputFromInsert(
  positionId: number,
  insert: SwingPositionInsert
): SwingTradeDiscordInput | null {
  if (insert.contract_strike == null || !insert.contract_expiry) return null;
  const premium = insert.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  return {
    session_date: insert.session_date,
    position_id: positionId,
    roll_seq: insert.roll_seq ?? 0,
    ticker: insert.ticker.toUpperCase(),
    direction: insert.direction,
    contract_strike: insert.contract_strike,
    contract_expiry: insert.contract_expiry,
    entry_premium: premium,
  };
}

export function buildSwingTradePayload(
  row: SwingTradeDiscordInput,
  action: "BTO" | "STC",
  price: number,
  opts: BuildTradePayloadOpts = {}
): ChiefTradePayload | null {
  const strike = formatZeroDteStrike(row.contract_strike, row.direction);
  const expiry = formatZeroDteExpiry(row.contract_expiry);
  if (!strike || !expiry || !Number.isFinite(price) || price <= 0) return null;

  const ticker = row.ticker.toUpperCase();
  const virtualLots = chiefTradeVirtualLots();
  let qty = opts.qty ?? (action === "BTO" ? virtualLots : virtualLots);
  qty = Math.max(1, Math.floor(qty));

  const suffix = opts.idempotencySuffix ?? action.toLowerCase();
  const channelId = swingChiefTradeChannelId();

  return {
    action,
    qty,
    ticker,
    strike,
    expiry,
    price,
    idempotency_key: `swing:${row.position_id}:${suffix}`,
    author_name: swingAuthorName(),
    ...(channelId ? { channel_id: channelId } : {}),
  };
}

/** Fresh COMMIT → BTO embed under the swing desk author. */
export async function notifySwingTradeOpen(input: SwingTradeDiscordInput): Promise<boolean> {
  if (!swingDiscordAlertsEnabled()) return false;
  const price = input.entry_premium;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildSwingTradePayload(input, "BTO", price, { idempotencySuffix: "bto" });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Convenience for executeSwingCommits — maps insert + new id. */
export async function notifySwingTradeOpenFromInsert(
  positionId: number,
  insert: SwingPositionInsert
): Promise<boolean> {
  const input = swingInputFromInsert(positionId, insert);
  if (!input) return false;
  return notifySwingTradeOpen(input);
}

/** Capital-preservation CLOSE or parent leg of a ROLL → STC at exit mark. */
export async function notifySwingTradeClose(
  input: SwingTradeDiscordInput,
  exitPrice?: number | null,
  opts: Pick<BuildTradePayloadOpts, "idempotencySuffix"> = {}
): Promise<boolean> {
  if (!swingDiscordAlertsEnabled()) return false;
  const price = exitPrice ?? input.last_mark ?? input.entry_premium;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildSwingTradePayload(input, "STC", price, {
    idempotencySuffix: opts.idempotencySuffix ?? "stc",
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Gating roll/close outcome from active-refresh — STC parent; on ROLL also BTO child. */
export async function notifySwingTerminalFromOutcome(
  parentRow: SwingPositionRow,
  roll: RollOutcome,
  exitPrice?: number | null
): Promise<{ stc: boolean; bto: boolean }> {
  if (!swingDiscordAlertsEnabled() || !roll.parentGraded) {
    return { stc: false, bto: false };
  }

  const parentInput = swingInputFromRow(parentRow);
  if (!parentInput) return { stc: false, bto: false };

  const stcSuffix =
    roll.action === "ROLL"
      ? `roll:${parentRow.roll_seq}:stc`
      : roll.action === "CLOSE"
        ? `close`
        : "stc";

  const stc = await notifySwingTradeClose(parentInput, exitPrice, { idempotencySuffix: stcSuffix });
  if (roll.action !== "ROLL" || roll.childId == null) {
    return { stc, bto: false };
  }

  const { fetchSwingPositionById } = await import("@/lib/db");
  const childRow = await fetchSwingPositionById(roll.childId).catch(() => null);
  const childInput = childRow ? swingInputFromRow(childRow) : null;
  if (!childInput) return { stc, bto: false };

  const bto = await notifySwingTradeOpen(childInput);
  return { stc, bto };
}
