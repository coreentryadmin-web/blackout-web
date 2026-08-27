import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import {
  evaluateVectorPickLiveStatus,
  resolveVectorPickLiveMid,
  type VectorPickLiveQuote,
} from "@/features/vector/lib/vector-pick-live-status";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PickLiveInput = {
  occ: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  entryMid?: number | null;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
};

function quoteFromSources(
  occ: string,
  snap: import("@/lib/providers/options-snapshot").OptionSnapshot | undefined,
  side: "call" | "put"
): VectorPickLiveQuote {
  const ws = getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS);
  if (ws) {
    const mid = resolveVectorPickLiveMid({ bid: ws.bid, ask: ws.ask, mark: ws.mark });
    if (mid != null || ws.bid != null || ws.ask != null) {
      return {
        bid: ws.bid,
        ask: ws.ask,
        mid,
        delta: null,
        markStale: mid == null,
      };
    }
  }
  if (snap) {
    const mid = resolveVectorPickLiveMid({ bid: snap.bid, ask: snap.ask, mark: snap.mark ?? null });
    const rawDelta = snap.delta;
    return {
      bid: snap.bid,
      ask: snap.ask,
      mid,
      delta:
        rawDelta != null
          ? side === "put"
            ? -Math.abs(rawDelta)
            : rawDelta
          : null,
      gamma: snap.gamma ?? null,
      theta: snap.theta ?? null,
      iv: snap.iv ?? null,
      markStale: mid == null,
    };
  }
  return { bid: null, ask: null, mid: null, delta: null, markStale: true };
}

export async function POST(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const rawTicker = typeof body.ticker === "string" ? body.ticker : null;
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const spot = Number(body.spot);
  if (!Number.isFinite(spot) || spot <= 0) {
    return NextResponse.json({ error: "Invalid spot" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const picksRaw = body.picks;
  if (!Array.isArray(picksRaw) || !picksRaw.length) {
    return NextResponse.json({ live: [] }, { headers: NO_STORE_HEADERS });
  }

  const picks: PickLiveInput[] = [];
  for (const p of picksRaw.slice(0, 3)) {
    const row = p as Record<string, unknown>;
    const occ = typeof row.occ === "string" ? row.occ : null;
    const side = row.side === "call" || row.side === "put" ? row.side : null;
    const strike = Number(row.strike);
    const expiry = typeof row.expiry === "string" ? row.expiry : null;
    if (!occ || !side || !expiry || !Number.isFinite(strike)) continue;
    picks.push({
      occ,
      side,
      strike,
      expiry,
      entryMid: typeof row.entryMid === "number" ? row.entryMid : null,
      caveat:
        row.caveat === "premium_high" ||
        row.caveat === "low_liquidity" ||
        row.caveat === "premium_high_low_liquidity"
          ? row.caveat
          : undefined,
    });
  }

  const occs = picks.map((p) => p.occ);
  const snaps =
    occs.length > 0
      ? await fetchOptionsUnifiedSnapshot(occs).catch(
          () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
        )
      : new Map();

  const play = body.play && typeof body.play === "object" ? (body.play as Record<string, unknown>) : {};
  const invalidation = typeof play.invalidation === "string" ? play.invalidation : null;
  const bias =
    play.bias === "long" || play.bias === "short" || play.bias === "range" || play.bias === "neutral"
      ? play.bias
      : undefined;

  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const live = picks.map((pick) => {
    const snap = snaps.get(pick.occ);
    const quote = quoteFromSources(pick.occ, snap, pick.side);
    const evalResult = evaluateVectorPickLiveStatus({
      spot,
      side: pick.side,
      entryMid: pick.entryMid ?? null,
      caveat: pick.caveat,
      invalidation,
      bias,
      callWall: numOrNull(body.callWall),
      putWall: numOrNull(body.putWall),
      gammaFlip: numOrNull(body.gammaFlip),
      quote,
    });

    return {
      occ: pick.occ,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      delta: quote.delta,
      gamma: quote.gamma ?? null,
      theta: quote.theta ?? null,
      iv: quote.iv ?? null,
      actionStatus: evalResult.status,
      actionReason: evalResult.reason,
      premiumPctFromEntry: evalResult.premiumPctFromEntry,
      setupInvalidated: evalResult.setupInvalidated,
    };
  });

  const nowMs = Date.now();
  return NextResponse.json(
    { live, asOf: etStamp(nowMs), session_date: etSessionDate(nowMs) },
    { headers: NO_STORE_HEADERS }
  );
}
