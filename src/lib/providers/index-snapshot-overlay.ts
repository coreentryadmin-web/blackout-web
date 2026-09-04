import type { IndexQuote } from "@/lib/providers/polygon";
import { rebaseChangePct } from "@/lib/providers/change-pct";

/** Mirrors spx-desk INDEX_STORE_STALE_MS / GEX_INDEX_WS_STALE_MS — one knob for all index WS overlays. */
export const INDEX_WS_STALE_MS = (() => {
  const raw = process.env.SPX_INDEX_WS_STALE_SEC?.trim();
  const sec = raw ? Number(raw) : 120;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 120_000;
})();

export type WsIndexEntry = {
  price: number;
  change_pct?: number | null;
  open_source?: string;
  updatedAt?: number;
};

/**
 * Overlay a REST index snapshot with a fresher indices-WS tick (I:SPX / I:VIX).
 *
 * Stock-candle-store ticks (A.*) must NOT be used here — their session-open anchor differs from
 * the official prior-close basis Polygon reports on `/v3/snapshot/indices`, which is how
 * data-validator grounds VIX change_pct.
 */
export function overlayRestIndexWithWs(
  restSnap: IndexQuote,
  ws: WsIndexEntry | null | undefined,
  now = Date.now(),
  maxAgeMs = INDEX_WS_STALE_MS
): IndexQuote {
  if (!restSnap || !ws?.updatedAt || now - ws.updatedAt >= maxAgeMs || !(ws.price > 0)) {
    return restSnap;
  }

  const wsChangeAuthoritative = ws.open_source === "rest";
  const restChangePct = rebaseChangePct(ws.price, restSnap) ?? restSnap.change_pct;

  return {
    ...restSnap,
    price: ws.price,
    change_pct: wsChangeAuthoritative && Number.isFinite(ws.change_pct)
      ? Number(ws.change_pct)
      : restChangePct,
  };
}

/** In-process indices WS store (ingest leader / dev). */
export function localWsIndexEntry(
  indexStore: Record<string, WsIndexEntry & { price: number }> | null | undefined,
  root: string,
  now = Date.now()
): WsIndexEntry | null {
  const sym = root.toUpperCase();
  const ws = indexStore?.[sym];
  if (!ws?.updatedAt || now - ws.updatedAt >= INDEX_WS_STALE_MS) return null;
  if (!(ws.price > 0)) return null;
  return ws;
}

/** Web-tier fallback: ingest leader writes the full indexStore to Redis every ~30s. */
export async function clusterWsIndexEntry(
  root: string,
  now = Date.now(),
  maxAgeMs = INDEX_WS_STALE_MS
): Promise<WsIndexEntry | null> {
  const sym = root.toUpperCase();
  try {
    const { getUwCacheRedis } = await import("@/lib/providers/uw-shared-cache");
    const redis = await getUwCacheRedis();
    const raw = redis ? await redis.get("spx:pulse:snapshot") : null;
    if (!raw) return null;
    const snap = JSON.parse(raw) as Record<string, WsIndexEntry>;
    const entry = snap[sym];
    if (!entry?.updatedAt || now - entry.updatedAt >= maxAgeMs) return null;
    if (!(entry.price != null && entry.price > 0)) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Prefer local WS on ingest; web tier reads the Redis cluster snapshot. */
export async function resolveLiveIndexWsEntry(
  root: string,
  now = Date.now()
): Promise<WsIndexEntry | null> {
  try {
    const { indexStore } = await import("@/lib/ws/polygon-socket");
    const local = localWsIndexEntry(indexStore, root, now);
    if (local) return local;
  } catch {
    /* fall through to Redis */
  }
  return clusterWsIndexEntry(root, now);
}
