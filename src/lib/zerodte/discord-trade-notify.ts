/**
 * Push committed 0DTE Command plays into the Chief Trade Alert Bot so members get
 * the same BTO/STC embed format and FIFO PnL tracking as manual desk entries.
 *
 * Qty model (CHIEF_TRADE_VIRTUAL_LOTS):
 *   1 (default) — one normalized "desk lot"; PnL % matches the board. TRIM/HOLD are
 *                 status-only on the board; only OPEN + final CLOSE hit Discord.
 *   3           — virtual 3-lot book for trim_scale: BTO×3, STC×1 per trim bank,
 *                 STC×remainder on close. Matches partial-banking guidance.
 *
 * Fire-and-forget: never throws into scan.ts.
 */
import type { ZeroDteSetupLogRow } from "@/lib/db";

export type ZeroDteTradeDiscordInput = Pick<
  ZeroDteSetupLogRow,
  "session_date" | "ticker" | "direction" | "top_strike" | "expiry" | "entry_premium"
> & {
  last_mark?: number | null;
  play_type?: string | null;
  trims_taken?: number;
};

export type ChiefTradePayload = {
  action: "BTO" | "STC";
  qty: number;
  ticker: string;
  strike: string;
  expiry: string;
  price: number;
  idempotency_key: string;
  author_name?: string;
  /** Discord channel snowflake — bot posts here when set; else CHIEF_TRADE_CHANNEL_ID. */
  channel_id?: string;
};

export type BuildTradePayloadOpts = {
  qty?: number;
  idempotencySuffix?: string;
};

export function zerodteDiscordAlertsEnabled(): boolean {
  const raw = process.env.ZERODTE_DISCORD_ALERTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Virtual contract count for the desk book (default 1 = normalized lot). */
export function chiefTradeVirtualLots(): number {
  const raw = process.env.CHIEF_TRADE_VIRTUAL_LOTS?.trim();
  const n = raw ? Number(raw) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(10, Math.floor(n));
}

export function chiefTradeBotUrl(): string | null {
  const url = process.env.CHIEF_TRADE_BOT_URL?.trim();
  return url || null;
}

export function chiefTradeApiSecret(): string | null {
  const secret = process.env.CHIEF_TRADE_API_SECRET?.trim();
  return secret || null;
}

/** YYYY-MM-DD → M/D (matches manual desk format: `10/10`). */
export function formatZeroDteExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** Ledger strike + direction → `7650C` / `180P`. */
export function formatZeroDteStrike(
  strike: number | null | undefined,
  direction: "long" | "short"
): string | null {
  if (strike == null || !Number.isFinite(strike)) return null;
  const cp = direction === "long" ? "C" : "P";
  const strikeStr = Number.isInteger(strike) ? String(Math.trunc(strike)) : String(strike);
  return `${strikeStr}${cp}`;
}

export function buildZeroDteTradePayload(
  row: ZeroDteTradeDiscordInput,
  action: "BTO" | "STC",
  price: number,
  opts: BuildTradePayloadOpts = {}
): ChiefTradePayload | null {
  if (row.play_type === "CONDOR") return null;
  const strike = formatZeroDteStrike(row.top_strike, row.direction);
  const expiry = formatZeroDteExpiry(row.expiry);
  if (!strike || !expiry || !Number.isFinite(price) || price <= 0) return null;

  const ticker = row.ticker.toUpperCase();
  const virtualLots = chiefTradeVirtualLots();
  const trimmed = row.trims_taken ?? 0;

  let qty = opts.qty ?? (action === "BTO" ? virtualLots : Math.max(1, virtualLots - trimmed));
  qty = Math.max(1, Math.floor(qty));

  const suffix = opts.idempotencySuffix ?? action.toLowerCase();

  return {
    action,
    qty,
    ticker,
    strike,
    expiry,
    price,
    idempotency_key: `zerodte:${row.session_date}:${ticker}:${suffix}`,
    author_name: process.env.CHIEF_TRADE_AUTHOR_NAME?.trim() || "Night-Hawk-Bot",
  };
}

export async function postChiefTrade(payload: ChiefTradePayload): Promise<boolean> {
  const base = chiefTradeBotUrl();
  const secret = chiefTradeApiSecret();
  if (!base || !secret) {
    console.warn("[zerodte-discord] CHIEF_TRADE_BOT_URL or CHIEF_TRADE_API_SECRET not set — alert dropped");
    return false;
  }

  const url = `${base.replace(/\/$/, "")}/api/trade`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[zerodte-discord] chief trade POST ${res.status}: ${text.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[zerodte-discord] chief trade POST error:", err);
    return false;
  }
}

/** Fresh COMMIT → BTO embed under the desk author (PnL opens). */
export async function notifyZeroDteTradeOpen(row: ZeroDteTradeDiscordInput): Promise<boolean> {
  if (!zerodteDiscordAlertsEnabled()) return false;
  const price = row.entry_premium;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildZeroDteTradePayload(row, "BTO", price);
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** trim_scale tranche banked → partial STC (only when CHIEF_TRADE_VIRTUAL_LOTS > 1). */
export async function notifyZeroDteTradeTrim(
  row: ZeroDteTradeDiscordInput,
  trimIndex: number,
  trimPrice?: number | null
): Promise<boolean> {
  if (!zerodteDiscordAlertsEnabled()) return false;
  if (chiefTradeVirtualLots() <= 1) return false;
  const price = trimPrice ?? row.last_mark;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildZeroDteTradePayload(row, "STC", price, {
    qty: 1,
    idempotencySuffix: `trim:${trimIndex}`,
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}

/** Ratchet / first TRIM latch → bank one virtual lot when lots ≥ 2. */
export async function notifyZeroDteTradeTrimLatch(
  row: ZeroDteTradeDiscordInput,
  trimPrice?: number | null
): Promise<boolean> {
  if (!zerodteDiscordAlertsEnabled()) return false;
  if (chiefTradeVirtualLots() < 2) return false;
  if ((row.trims_taken ?? 0) > 0) return false;
  return notifyZeroDteTradeTrim(row, 1, trimPrice);
}

/** Lifecycle CLOSED → STC remaining virtual lots at exit mark. */
export async function notifyZeroDteTradeClose(
  row: ZeroDteTradeDiscordInput,
  exitPrice?: number | null
): Promise<boolean> {
  if (!zerodteDiscordAlertsEnabled()) return false;
  const price = exitPrice ?? row.last_mark;
  if (price == null || !Number.isFinite(price) || price <= 0) return false;
  const payload = buildZeroDteTradePayload(row, "STC", price, {
    idempotencySuffix: "stc",
  });
  if (!payload) return false;
  return postChiefTrade(payload);
}
