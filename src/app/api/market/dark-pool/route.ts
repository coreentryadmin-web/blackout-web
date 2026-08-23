import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache, TTL } from "@/lib/server-cache";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export interface DarkPoolRow {
  ticker: string;
  premium: number;
  side: string;
  /**
   * NULLABLE ON PURPOSE. This used to be a non-null `string` guaranteed by stamping `new Date()`
   * on any row upstream did not date — which is a fabricated measurement, not a default. See
   * `normalizeRow`.
   */
  executed_at: string | null;
  share_size?: number;
}

/** Exported for test — the fabricated-timestamp defect lives here and nowhere else. */
export function normalizeRow(raw: unknown): DarkPoolRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ticker = String(r.ticker ?? r.symbol ?? r.underlying ?? "").toUpperCase();
  if (!ticker) return null;

  const premium = Number(r.premium ?? r.notional ?? r.size_premium ?? 0);
  if (premium <= 0) return null;

  const sideRaw = String(r.side ?? r.sentiment ?? r.direction ?? "neutral").toLowerCase();
  const side = sideRaw.includes("buy") ? "buy" : sideRaw.includes("sell") ? "sell" : "neutral";

  // A PRINT WITHOUT A TIME HAS NO TIME. This used to fall back to `new Date().toISOString()`,
  // which does not fail — it succeeds at telling everyone downstream something false, and does so
  // in the single worst direction: an undated block is stamped with NOW, so it sorts as the newest
  // print on the tape, renders as "just now", and lands inside every COORD window that is open at
  // the moment of the request.
  //
  // Three concrete consequences, all silent:
  //   1. `hasCoincidentBlock` (helix-coord-window.ts) correlates dark-pool blocks with option
  //      prints inside a 5-minute window. A now-stamped block coincides with whatever just fired.
  //      That module already skips a null time on purpose — it was never given the chance.
  //   2. `serverCache` caches the RAW upstream rows, but `normalizeRow` runs per request, so the
  //      SAME print gets a DIFFERENT `executed_at` every time it is fetched. Dark-pool deep links
  //      are keyed on `executed_at.slice(0, 19)` (helix-flow-deep-link.ts), so a shared link to
  //      such a print can never match it again, and `darkpoolHighlight` never fires.
  //   3. It makes the lane's own evidence unfalsifiable. `helix-coord-window.ts` records
  //      "3/3 with a parseable executed_at" measured through THIS endpoint — a number that cannot
  //      tell an upstream timestamp from one invented here.
  //
  // `fetchUwDarkPoolMarketWide`, reading the SAME upstream rows, already refuses to invent one: it
  // skips any row whose `executed_at`/`date` will not parse. Two readers of one feed disagreeing
  // about whether a print has a time is the drift worth removing, and this side is the unsafe one.
  const executedRaw = r.executed_at ?? r.date ?? r.timestamp;
  const executed_at =
    executedRaw == null || String(executedRaw).trim() === "" ? null : String(executedRaw);
  const share_size = r.size != null ? Number(r.size) : undefined;

  return { ticker, premium, side, executed_at, share_size };
}

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 50), 100);
  const min_premium = Number(sp.get("min_premium") ?? 0) || 0;

  try {
    const rawRows = await serverCache(`dark-pool:recent:${limit}`, TTL.DARK_POOL, async () => {
      const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
      return fetchUwDarkPoolRecent(limit);
    });

    const prints = (Array.isArray(rawRows) ? rawRows : [])
      .map(normalizeRow)
      .filter((r): r is DarkPoolRow => r !== null)
      .filter((r) => r.premium >= min_premium)
      .sort((a, b) => b.premium - a.premium);

    return NextResponse.json({ prints, count: prints.length }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[dark-pool]", err);
    return NextResponse.json({ prints: [], count: 0 }, { status: 503 });
  }
}
