import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { shouldBootDataSockets } from "@/lib/process-role";
import { indexStore } from "@/lib/ws/polygon-socket";
import { getStockLiveCandle } from "@/lib/ws/stock-candle-store";
import { resolveOptionsRoot } from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot, fetchIndexSnapshot, type IndexQuote } from "@/lib/providers/polygon";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { resolveSpotFromUwStockState } from "@/lib/providers/spot-fallback";
import { withFreshPrice } from "@/lib/providers/change-pct";
import { overlayRestIndexWithWs } from "@/lib/providers/index-snapshot-overlay";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/quote?ticker=SPY
 *
 * A tiny, scalable spot-price tape for the Heat Maps GEX header — designed to be
 * polled fast (~1.5s) WITHOUT pressuring upstream, so the header price updates live
 * while the gamma matrix stays on its own 20s cache.
 *
 * Two resolution paths:
 *  - INDEX (SPX/NDX/RUT/VIX → I:*): when a TRUE real-time WS price exists in the
 *    `indexStore` (fed by wss://socket.massive.com/indices), read it directly →
 *    `source:'ws'`. No upstream call at all. If that store entry is missing/stale
 *    (socket cold, or an index like NDX/RUT that has no WS subscription), fall back
 *    to the index REST snapshot, shared-cached ~1.5s.
 *  - STOCK/ETF (SPY, QQQ, IWM, NVDA, …): `fetchStockSnapshot`, shared-cached ~1.5s
 *    (in-memory Map + Redis `quote:{ticker}`) so 500 users collapse to ~one REST
 *    call per ticker per ~1.5s → `source:'rest'`.
 *
 * Never throws, never fabricates: any failure/empty → `{ available:false }` (200).
 */

type QuotePayload = {
  available: true;
  ticker: string;
  price: number;
  change_pct: number | null;
  source: "ws" | "rest";
  asof: string;
};

/** Index roots that have a LIVE WS subscription in `indexStore`. */
const WS_INDEX_KEYS = new Set(Object.keys(indexStore));
/** A WS index entry older than this is treated as cold → REST fallback. */
const WS_STALE_MS = 10_000;
/** Shared REST cache window — one upstream call per ticker per 1.5s across all users. */
const QUOTE_CACHE_MS = 1_500;
/** Redis TTL must be an integer ≥1s; 3s comfortably covers the 1.5s window. */
const QUOTE_REDIS_TTL_SEC = 3;
/**
 * Negative-result cache window. Without this, a sustained upstream outage (vendor 404s,
 * timeouts) meant every poll from every open tab, on every replica, re-hit the upstream with
 * zero backoff — wasted vendor-call budget for the duration of the outage. Shorter than
 * QUOTE_CACHE_MS since a failure is more time-sensitive to clear than a healthy quote is to
 * refresh (a real recovery should be picked up quickly once the vendor is back).
 */
const QUOTE_FAILURE_CACHE_MS = 3_000;

/** Per-process REST cache (in-memory L1), shared across all concurrent requests. */
const quoteMem = new Map<string, { at: number; payload: QuotePayload }>();
/** Coalesce concurrent REST fetches for the same ticker into one upstream call. */
const inflight = new Map<string, Promise<QuotePayload | null>>();
/** Per-ticker timestamp of the most recent REST quote failure — see QUOTE_FAILURE_CACHE_MS. */
const quoteFailureMem = new Map<string, number>();
/**
 * Tickers currently mid-outage that have already logged a warning. Cleared on the next
 * success, so a genuine break still surfaces exactly one log line per outage (not silenced
 * forever), while a sustained vendor outage doesn't produce a wall of repeat warnings.
 */
const quoteFailureWarned = new Set<string>();

function isIndexRoot(optionsRoot: string): boolean {
  return optionsRoot.startsWith("I:");
}

/**
 * Records a REST quote failure for the negative cache and logs at most once per outage
 * (see quoteFailureWarned) — a sustained vendor outage (e.g. a snapshot-cache blip over a
 * long weekend) produces one warning at the start, not one per poll for the outage's duration.
 */
function recordQuoteFailure(ticker: string, detail: string): void {
  quoteFailureMem.set(ticker, Date.now());
  if (quoteFailureMem.size > 200) quoteFailureMem.clear();
  if (!quoteFailureWarned.has(ticker)) {
    quoteFailureWarned.add(ticker);
    console.warn(`[market/quote] REST quote failing for ${ticker} (further repeats suppressed until it recovers): ${detail}`);
  }
}

/**
 * Shared-cached REST quote: in-memory L1 → Redis L2 → coalesced upstream fetch.
 * Used for BOTH stocks (stock snapshot) and the index REST fallback (index snapshot).
 * Returns null on failure/empty (caller emits { available:false }). Never throws.
 */
async function getRestQuote(
  ticker: string,
  optionsRoot: string,
  isIndex: boolean
): Promise<QuotePayload | null> {
  const now = Date.now();

  // Negative cache — a recent failure for this ticker skips straight to { available:false }
  // instead of re-hitting a possibly-still-down upstream on every poll.
  const failedAt = quoteFailureMem.get(ticker);
  if (failedAt != null && now - failedAt < QUOTE_FAILURE_CACHE_MS) return null;

  // L1 — in-memory, fresh within the ~1.5s window.
  const mem = quoteMem.get(ticker);
  if (mem && now - mem.at < QUOTE_CACHE_MS) return mem.payload;

  // L2 — Redis (cross-replica), so staggered polls across instances also collapse.
  try {
    const hit = await sharedCacheGet<{ at: number; payload: QuotePayload }>(`quote:${ticker}`);
    if (hit && now - hit.at < QUOTE_CACHE_MS) {
      quoteMem.set(ticker, hit);
      return hit.payload;
    }
  } catch {
    /* redis optional — fall through to upstream */
  }

  // Coalesce concurrent upstream fetches for this ticker into one in-flight promise.
  const existing = inflight.get(ticker);
  if (existing) return existing;

  const task = (async (): Promise<QuotePayload | null> => {
    try {
      // Index REST fallback uses the indices snapshot endpoint (I:* roots aren't on
      // the stocks snapshot); stocks/ETFs use the stocks snapshot endpoint.
      const snap = isIndex
        ? await fetchIndexSnapshot(optionsRoot)
        : await fetchStockSnapshot(ticker);
      if (!snap || !(snap.price > 0)) {
        recordQuoteFailure(ticker, "empty/zero-price snapshot");
        return null;
      }

      const payload: QuotePayload = {
        available: true,
        ticker,
        price: snap.price,
        change_pct: snap.change_pct,
        source: "rest",
        asof: new Date().toISOString(),
      };
      const entry = { at: Date.now(), payload };
      // Bound the in-memory map so an unusual spread of tickers can't grow it unbounded.
      if (quoteMem.size > 200) quoteMem.clear();
      quoteMem.set(ticker, entry);
      void sharedCacheSet(`quote:${ticker}`, entry, QUOTE_REDIS_TTL_SEC).catch(() => {});
      quoteFailureMem.delete(ticker);
      quoteFailureWarned.delete(ticker);
      return payload;
    } catch (err) {
      recordQuoteFailure(ticker, err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      inflight.delete(ticker);
    }
  })();

  inflight.set(ticker, task);
  return task;
}

/**
 * Index WS ticks carry `open_source` provenance (see polygon-socket). A ws-bar anchor measures
 * change% from the first bar seen at boot — wrong on a mid-session cold start. Overlay the live
 * WS price on a REST baseline (shared quote cache when hot, else one coalesced fetch) so the
 * Thermal header tape matches indices/route and spx-desk.
 */
async function buildIndexWsQuote(
  ticker: string,
  optionsRoot: string,
  entry: {
    price: number;
    change_pct: number;
    open_source: string;
    updatedAt: number;
  }
): Promise<QuotePayload> {
  let restSnap: IndexQuote | null = null;
  const mem = quoteMem.get(ticker);
  if (mem && Date.now() - mem.at < QUOTE_CACHE_MS) {
    restSnap = {
      symbol: optionsRoot,
      price: mem.payload.price,
      change_pct: mem.payload.change_pct,
      prev_close: null,
    };
  } else {
    const rest = await getRestQuote(ticker, optionsRoot, true);
    if (rest) {
      restSnap = {
        symbol: optionsRoot,
        price: rest.price,
        change_pct: rest.change_pct,
        prev_close: null,
      };
    }
  }

  if (restSnap) {
    const overlaid = overlayRestIndexWithWs(
      restSnap,
      {
        price: entry.price,
        change_pct: entry.change_pct,
        open_source: entry.open_source,
        updatedAt: entry.updatedAt,
      },
      Date.now(),
      WS_STALE_MS
    );
    return {
      available: true,
      ticker,
      price: overlaid.price,
      change_pct: overlaid.change_pct,
      source: "ws",
      asof: new Date(entry.updatedAt).toISOString(),
    };
  }

  // No REST baseline — only trust WS change when the anchor is authoritative.
  const changePct =
    entry.open_source === "rest" && Number.isFinite(entry.change_pct)
      ? entry.change_pct
      : null;

  return {
    available: true,
    ticker,
    price: entry.price,
    change_pct: changePct,
    source: "ws",
    asof: new Date(entry.updatedAt).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeMarketDeskApi(req);
  if (authResult instanceof Response) return authResult;

  // Boot the index WS lazily on ingest only — web tier reads cluster/UW fallbacks.
  if (shouldBootDataSockets()) {
    ensureDataSockets();
  }

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();
  // §3.4: validate BEFORE any paid upstream call / cache key / telemetry key. An arbitrary-length
  // or arbitrary-charset ticker would waste a paid Massive snapshot and inflate telemetry/cache
  // cardinality. Same allowlist as ticker-search; 400 so bad input is loud, not silently absorbed.
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const { optionsRoot } = resolveOptionsRoot(ticker);
  const isIndex = isIndexRoot(optionsRoot);

  try {
    // ── WS path: true real-time index price straight from the live indexStore. ──
    if (isIndex && WS_INDEX_KEYS.has(optionsRoot)) {
      const entry = indexStore[optionsRoot];
      const ageMs = Date.now() - entry.updatedAt;
      // Future timestamps (clock skew) must not read as infinitely fresh.
      if (entry.price > 0 && ageMs >= -WS_STALE_MS && Math.max(0, ageMs) < WS_STALE_MS) {
        const payload = await buildIndexWsQuote(ticker, optionsRoot, entry);
        return NextResponse.json(roundFloats(payload), { headers: NO_STORE_HEADERS });
      }
      // else: store cold/stale → fall through to the shared-cached index REST snapshot.
    }

    // ── WS path: stock/ETF tickers from the A.* stock candle store. ──
    // Uses getStockLiveCandle (not wsSpotPrice) so follower replicas read from
    // Redis where the leader writes on-demand — without this, followers always
    // fall through to REST because wsSpotPrice is local-memory-only.
    if (!isIndex) {
      const candle = getStockLiveCandle(ticker);
      const ageMs = Date.now() - (candle.updatedAt ?? 0);
      if (
        candle.current &&
        candle.current.close > 0 &&
        ageMs >= -WS_STALE_MS &&
        Math.max(0, ageMs) < WS_STALE_MS
      ) {
        // WS price is live; rebase change_pct off the shared REST cache when available so the
        // header doesn't show session-open–anchored drift before the REST seed lands.
        const mem = quoteMem.get(ticker);
        let changePct = candle.changePct;
        if (mem && Date.now() - mem.at < QUOTE_CACHE_MS) {
          const rebased = withFreshPrice(
            { price: mem.payload.price, change_pct: mem.payload.change_pct },
            candle.current.close
          );
          if (typeof rebased.change_pct === "number" && Number.isFinite(rebased.change_pct)) {
            changePct = rebased.change_pct;
          }
        }
        const payload: QuotePayload = {
          available: true,
          ticker,
          price: candle.current.close,
          change_pct: changePct,
          source: "ws",
          asof: new Date(candle.updatedAt).toISOString(),
        };
        return NextResponse.json(roundFloats(payload), { headers: NO_STORE_HEADERS });
      }
    }

    // ── REST path: stocks/ETFs without a live WS tick, plus index roots without
    //    a live WS feed (NDX/RUT) or a cold index store. ──
    const payload = await getRestQuote(ticker, optionsRoot, isIndex);
    if (payload) return NextResponse.json(roundFloats(payload), { headers: NO_STORE_HEADERS });

    const uw = await resolveSpotFromUwStockState(optionsRoot);
    if (uw && uw.price > 0) {
      const uwPayload: QuotePayload = {
        available: true,
        ticker,
        price: uw.price,
        change_pct: uw.change_pct,
        source: "rest",
        asof: new Date().toISOString(),
      };
      return NextResponse.json(roundFloats(uwPayload), { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ available: false, ticker }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    // Defensive — getRestQuote already swallows; never throw, never fabricate.
    console.error("[market/quote]", error);
    return NextResponse.json({ available: false, ticker }, { status: 200, headers: NO_STORE_HEADERS });
  }
}
