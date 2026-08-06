/**
 * Best-effort context lines for HELIX + dark pool Discord embeds.
 * Never fabricates levels or volume — omit when upstream data is unavailable.
 */
import type { GexLevelSnapshot } from "@/lib/flow-gex-proximity";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { todayEt } from "@/lib/et-date";

const ADV_CACHE_TTL_SEC = 24 * 60 * 60;

function nearestGexLevel(
  strike: number,
  levels: GexLevelSnapshot
): { label: string; level: number; distPct: number } | null {
  const candidates: Array<{ label: string; level: number | null }> = [
    { label: "call wall", level: levels.call_wall },
    { label: "put wall", level: levels.put_wall },
    { label: "gamma flip", level: levels.flip },
  ];
  let best: { label: string; level: number; distPct: number } | null = null;
  for (const c of candidates) {
    if (c.level == null || !Number.isFinite(c.level) || c.level <= 0) continue;
    const distPct = ((strike - c.level) / c.level) * 100;
    const abs = Math.abs(distPct);
    if (!best || abs < Math.abs(best.distPct)) {
      best = { label: c.label, level: c.level, distPct };
    }
  }
  return best;
}

/** Distance to the nearest GEX level — shown even when not "at/near" a wall. */
export function formatGexContextLine(strike: number, levels: GexLevelSnapshot): string | null {
  if (!Number.isFinite(strike)) return null;
  const near = nearestGexLevel(strike, levels);
  if (!near) return null;
  const dir = near.distPct >= 0 ? "above" : "below";
  const strikeStr = Number.isInteger(strike) ? String(strike) : strike.toFixed(2);
  return `Structure: strike ${strikeStr} is ${Math.abs(near.distPct).toFixed(1)}% ${dir} ${near.label} (${near.level})`;
}

function subtractCalendarDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 20-session average share volume — cached per ticker (Polygon daily bars). */
export async function getTickerAdv20d(ticker: string): Promise<number | null> {
  const key = ticker.trim().toUpperCase();
  if (!key) return null;
  const cacheKey = `discord-adv20:${key}`;
  const cached = await sharedCacheGet<{ adv: number }>(cacheKey);
  if (cached?.adv != null && Number.isFinite(cached.adv) && cached.adv > 0) return cached.adv;

  try {
    const to = todayEt();
    const from = subtractCalendarDays(to, 35);
    const { fetchStockDailyBars } = await import("@/lib/providers/polygon");
    const data = await fetchStockDailyBars(key, from, to, "25");
    const bars = Array.isArray(data) ? data : [];
    const vols = bars
      .map((b) => Number(b.v ?? 0))
      .filter((v: number) => Number.isFinite(v) && v > 0);
    if (vols.length < 5) return null;
    const adv = vols.reduce((sum, v) => sum + v, 0) / vols.length;
    if (!Number.isFinite(adv) || adv <= 0) return null;
    await sharedCacheSet(cacheKey, { adv }, ADV_CACHE_TTL_SEC);
    return adv;
  } catch {
    return null;
  }
}

export function estimateDarkpoolShareSize(
  print: { premium: number; price?: number | null; share_size?: number | null }
): number | null {
  if (print.share_size != null && Number.isFinite(print.share_size) && print.share_size > 0) {
    return print.share_size;
  }
  const price = print.price != null ? Number(print.price) : NaN;
  if (Number.isFinite(price) && price > 0 && print.premium > 0) {
    return Math.round(print.premium / price);
  }
  return null;
}

/** Block size as a % of 20D ADV — omitted when ADV or size is unknown. */
export function formatAdvContextLine(
  shares: number | null,
  adv: number | null
): string | null {
  if (shares == null || adv == null || !Number.isFinite(shares) || !Number.isFinite(adv) || adv <= 0) {
    return null;
  }
  const pct = (shares / adv) * 100;
  if (!Number.isFinite(pct)) return null;
  const advLabel =
    adv >= 1_000_000
      ? `~${(adv / 1_000_000).toFixed(1)}M ADV`
      : adv >= 1_000
        ? `~${Math.round(adv / 1000)}K ADV`
        : `~${Math.round(adv).toLocaleString("en-US")} ADV`;
  return `Size: ${pct.toFixed(1)}% of 20D ${advLabel}`;
}
