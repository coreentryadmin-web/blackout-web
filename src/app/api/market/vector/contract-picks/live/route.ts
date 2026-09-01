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
import { effectivePickBias } from "@/features/vector/lib/vector-pick-effective-bias";
import type { PlaySetup } from "@/features/vector/lib/vector-play-engine";
import {
  shouldPersistVectorPickClosure,
  vectorPickClosureCommitKey,
} from "@/lib/vector/vector-pick-closure-log";
import {
  insertVectorPickClosure,
  vectorPickClosureExists,
} from "@/lib/vector/vector-pick-closures-db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { logToken } from "@/lib/log-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PickLiveInput = {
  occ: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  entryMid?: number | null;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
  rank?: number | null;
  label?: string | null;
  role?: string | null;
  premium?: number | null;
  confidence?: number | null;
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
  for (const p of picksRaw.slice(0, 8)) {
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
      rank: typeof row.rank === "number" ? row.rank : null,
      label: typeof row.label === "string" ? row.label : null,
      role: typeof row.role === "string" ? row.role : null,
      premium: typeof row.premium === "number" ? row.premium : null,
      confidence: typeof row.confidence === "number" ? row.confidence : null,
    });
  }

  const occs = picks.map((p) => p.occ);
  const snaps =
    occs.length > 0
      ? await fetchOptionsUnifiedSnapshot(occs).catch(
          () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
        )
      : new Map();

  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const play = body.play && typeof body.play === "object" ? (body.play as Record<string, unknown>) : {};
  const invalidation = typeof play.invalidation === "string" ? play.invalidation : null;
  const rawBias =
    play.bias === "long" || play.bias === "short" || play.bias === "range" || play.bias === "neutral"
      ? play.bias
      : undefined;
  const playSetup = typeof play.setup === "string" ? (play.setup as PlaySetup) : undefined;
  // A committed `pivot` play's card bias stays "neutral" by design (long above / short below
  // until spot commits) — but the invalidation checks below are gated on bias === "long"/"short",
  // so passing the raw card bias through makes every one of them unreachable for a pivot play
  // that HAS committed and generated real directional picks (2026-08-29 audit finding). Re-derive
  // the committed direction the same way vector-play-candidates.ts already does for ranking,
  // rather than trusting whatever the client posted.
  const bias =
    rawBias !== undefined
      ? (effectivePickBias({ bias: rawBias, setup: playSetup ?? "stand-aside" }, spot, numOrNull(body.gammaFlip)) ??
        rawBias)
      : undefined;

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
      pick,
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
  const sessionDate = etSessionDate(nowMs);
  const ticker = rawTicker!;
  const playJson =
    play && typeof play === "object"
      ? {
          bias: play.bias,
          conviction: play.conviction,
          grade: play.grade,
          headline: play.headline,
          thesis: play.thesis,
          invalidation: play.invalidation,
          style: play.style,
          bie_bucket:
            typeof body.bieBucket === "string"
              ? body.bieBucket
              : null,
        }
      : null;

  const bieBucketFromBody = typeof body.bieBucket === "string" ? body.bieBucket : null;

  void (async () => {
    if (!sessionDate) return;
    for (const row of live) {
      if (row.actionStatus !== "dont_buy") continue;
      const commitKey = vectorPickClosureCommitKey(sessionDate, ticker, row.occ);
      try {
        const exists = await vectorPickClosureExists(commitKey);
        if (!shouldPersistVectorPickClosure(row.actionStatus, exists, row.actionReason)) continue;
        await insertVectorPickClosure({
          commitKey,
          sessionDate,
          ticker,
          occ: row.occ,
          side: row.pick.side,
          strike: row.pick.strike,
          expiry: row.pick.expiry,
          rank: row.pick.rank ?? null,
          label: row.pick.label ?? null,
          role: row.pick.role ?? null,
          entryMid: row.pick.entryMid ?? row.pick.premium ?? null,
          closeMid: row.mid,
          premiumPctFromEntry: row.premiumPctFromEntry,
          closeReason: row.actionReason,
          setupInvalidated: row.setupInvalidated,
          spot,
          playJson,
          pickJson: {
            rank: row.pick.rank,
            label: row.pick.label,
            role: row.pick.role,
            premium: row.pick.premium,
            confidence: row.pick.confidence,
            caveat: row.pick.caveat,
            bie_bucket: bieBucketFromBody,
          },
        });
      } catch (err) {
        console.error("[vector/contract-picks/live] closure log failed", logToken(commitKey), err instanceof Error ? err.message : err);
      }
    }
  })();

  return NextResponse.json(
    {
      live: live.map(({ pick: _pick, ...row }) => row),
      asOf: etStamp(nowMs),
      session_date: sessionDate,
    },
    { headers: NO_STORE_HEADERS }
  );
}
