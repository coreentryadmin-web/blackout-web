/**
 * Collapse rapid Discord alerts per ticker into one embed when prints land inside a
 * short rolling window (default 4m). Pure helpers are unit-tested; Redis IO is best-effort.
 */
import { sharedCacheGet, sharedCacheSet, sharedCacheDel } from "@/lib/shared-cache";

export type DiscordBurstChannel = "helix" | "darkpool";

export type DiscordBurstBuffer<T> = {
  ticker: string;
  items: T[];
  windowStartMs: number;
  lastAtMs: number;
};

type BurstIndex = { tickers: string[]; updatedAtMs: number };

export function discordBurstWindowSec(): number {
  const raw = Number(process.env.DISCORD_BURST_WINDOW_SEC ?? 240);
  return Number.isFinite(raw) && raw >= 60 && raw <= 600 ? Math.floor(raw) : 240;
}

export function burstBufferKey(channel: DiscordBurstChannel, ticker: string): string {
  return `discord-burst:${channel}:${ticker.trim().toUpperCase()}`;
}

function burstIndexKey(channel: DiscordBurstChannel): string {
  return `discord-burst-index:${channel}`;
}

/** True when the buffer's last item is older than the burst window. */
export function burstWindowExpired(
  buf: DiscordBurstBuffer<unknown>,
  nowMs: number,
  windowSec: number
): boolean {
  return nowMs - buf.lastAtMs > windowSec * 1000;
}

/**
 * Pure ingest — returns items to flush (previous window) and the next buffer state.
 * Caller posts `flush` when non-null; the current item lives in `next` until a later flush.
 */
export function ingestBurstItemPure<T>(
  existing: DiscordBurstBuffer<T> | null,
  ticker: string,
  item: T,
  nowMs: number,
  windowSec: number
): { flush: T[] | null; next: DiscordBurstBuffer<T> } {
  const t = ticker.trim().toUpperCase();
  if (!existing || burstWindowExpired(existing, nowMs, windowSec)) {
    const flush = existing && existing.items.length > 0 ? [...existing.items] : null;
    return {
      flush,
      next: { ticker: t, items: [item], windowStartMs: nowMs, lastAtMs: nowMs },
    };
  }
  const next: DiscordBurstBuffer<T> = {
    ...existing,
    items: [...existing.items, item],
    lastAtMs: nowMs,
  };
  return { flush: null, next };
}

async function trackBurstIndex(channel: DiscordBurstChannel, ticker: string): Promise<void> {
  const key = burstIndexKey(channel);
  const idx = (await sharedCacheGet<BurstIndex>(key)) ?? { tickers: [], updatedAtMs: 0 };
  const t = ticker.trim().toUpperCase();
  if (!idx.tickers.includes(t)) idx.tickers.push(t);
  idx.updatedAtMs = Date.now();
  await sharedCacheSet(key, idx, discordBurstWindowSec() + 360);
}

/** Push one alert into the per-ticker burst buffer; flush prior window when it rolls. */
export async function ingestDiscordBurst<T>(
  channel: DiscordBurstChannel,
  ticker: string,
  item: T,
  now = new Date()
): Promise<{ flush: T[] | null }> {
  const windowSec = discordBurstWindowSec();
  const nowMs = now.getTime();
  const bufKey = burstBufferKey(channel, ticker);
  const existing = await sharedCacheGet<DiscordBurstBuffer<T>>(bufKey);
  const { flush, next } = ingestBurstItemPure(existing, ticker, item, nowMs, windowSec);
  await sharedCacheSet(bufKey, next, windowSec + 120);
  await trackBurstIndex(channel, ticker);
  return { flush };
}

/** Flush buffers whose window has expired — cron safety net for single-print tails. */
export async function flushStaleDiscordBursts<T>(
  channel: DiscordBurstChannel,
  now = new Date()
): Promise<Array<{ ticker: string; items: T[] }>> {
  const windowSec = discordBurstWindowSec();
  const nowMs = now.getTime();
  const idx = await sharedCacheGet<BurstIndex>(burstIndexKey(channel));
  if (!idx?.tickers.length) return [];

  const out: Array<{ ticker: string; items: T[] }> = [];
  const remaining: string[] = [];

  for (const ticker of idx.tickers) {
    const bufKey = burstBufferKey(channel, ticker);
    const buf = await sharedCacheGet<DiscordBurstBuffer<T>>(bufKey);
    if (!buf?.items.length) continue;
    if (!burstWindowExpired(buf, nowMs, windowSec)) {
      remaining.push(ticker);
      continue;
    }
    out.push({ ticker: buf.ticker, items: [...buf.items] });
    await sharedCacheDel(bufKey);
  }

  if (remaining.length !== idx.tickers.length) {
    await sharedCacheSet(
      burstIndexKey(channel),
      { tickers: remaining, updatedAtMs: nowMs },
      windowSec + 360
    );
  }

  return out;
}
