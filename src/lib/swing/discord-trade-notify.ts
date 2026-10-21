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
import { postDiscordWebhook } from "@/lib/discord-post";

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

/** Separate webhook for non-trade, mid-trade alerts (e.g. thesis-break) — distinct from the Chief
 *  Trade Bot's BTO/STC channel (`SWING_CHIEF_TRADE_CHANNEL_ID`/`CHIEF_TRADE_BOT_URL`), which only
 *  understands BTO/STC and feeds a FIFO PnL ledger. A still-open position has nothing to post
 *  there without fabricating a phantom close, so this posts a plain embed via the same raw-webhook
 *  path `spx-play-notify.ts`'s `DISCORD_PLAY_WEBHOOK_URL` already uses for non-FIFO desk alerts. */
export function swingAlertWebhookUrl(): string | null {
  const raw = process.env.SWING_ALERT_WEBHOOK_URL?.trim();
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

/**
 * One-shot, non-trade alert: a capital-preservation THESIS rung (`structural_stop`/`thesis_stop`,
 * see `manage.ts`'s `THESIS_BREAK_RUNGS`) fired for a position that is STILL OPEN this tick — the
 * roll executor either hasn't run yet or couldn't build a plan (no forward bars, chain fetch
 * failed, budget/cap gate, etc.). Without this, a member only learns the thesis broke once the
 * position actually closes (which can lag the detection by one or more ticks) or if they happen to
 * check the board/play-brief in between — exactly the "alerting only bookends the trade" gap
 * raised on PR #4076 (comment 6303734681). Deliberately NOT routed through `postChiefTrade`/BTO-STC
 * (see `swingAlertWebhookUrl`'s own doc) since the position hasn't closed.
 *
 * Caller is responsible for de-duplication (fire once per position — see swing-active-refresh's
 * `sharedCacheSetNx` guard) and for only calling this when the close/roll did NOT execute this
 * tick (a position that DID close/roll already gets the existing STC alert from
 * `notifySwingTerminalFromOutcome` below, which is the stronger, more specific signal).
 */
export async function notifySwingThesisBreak(
  input: SwingTradeDiscordInput,
  reason: string | null | undefined
): Promise<boolean> {
  const url = swingAlertWebhookUrl();
  if (!url) return false;

  const strike = formatZeroDteStrike(input.contract_strike, input.direction);
  const expiry = formatZeroDteExpiry(input.contract_expiry);
  const dir = input.direction === "long" ? "LONG" : "SHORT";

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (strike && expiry) fields.push({ name: "Contract", value: `${strike} ${expiry}`, inline: true });
  if (input.entry_premium != null && Number.isFinite(input.entry_premium)) {
    fields.push({ name: "Entry", value: `$${input.entry_premium.toFixed(2)}`, inline: true });
  }
  if (input.last_mark != null && Number.isFinite(input.last_mark)) {
    fields.push({ name: "Last mark", value: `$${input.last_mark.toFixed(2)}`, inline: true });
  }

  return postDiscordWebhook(
    url,
    {
      embeds: [
        {
          title: `⚠️ Thesis Break — ${input.ticker} ${dir}`,
          description: (reason?.trim() || "Structural/thesis stop triggered — management will close or roll on the next pass.").slice(0, 1000),
          color: 0xed4243,
          fields: fields.length ? fields : undefined,
          timestamp: new Date().toISOString(),
        },
      ],
    },
    "swing-thesis-break"
  );
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
