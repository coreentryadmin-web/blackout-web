import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { VECTOR_DEFAULT_DTE_HORIZON, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import {
  resolveVectorPlayBieContext,
  vectorPlayBieBucketKey,
} from "@/lib/bie/vector-play-bie";
import type { VectorPlayInput } from "@/features/vector/lib/vector-play-engine";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseHorizon(raw: unknown): VectorDteHorizon {
  if (raw === "0dte" || raw === "weekly" || raw === "monthly" || raw === "all") return raw;
  return VECTOR_DEFAULT_DTE_HORIZON;
}

function parseSnapshot(body: Record<string, unknown>): VectorPlayInput | null {
  const ticker = typeof body.ticker === "string" ? body.ticker : null;
  if (!isVectorTickerAllowed(ticker)) return null;
  const spot = Number(body.spot);
  if (!Number.isFinite(spot) || spot <= 0) return null;

  const regimeRaw = body.regime as Record<string, unknown> | undefined;
  const posture =
    regimeRaw?.posture === "long" ||
    regimeRaw?.posture === "short" ||
    regimeRaw?.posture === "transition" ||
    regimeRaw?.posture === "unknown"
      ? regimeRaw.posture
      : "unknown";

  return {
    ticker: ticker!,
    horizon: parseHorizon(body.horizon),
    timeframeMin: Number(body.timeframeMin) > 0 ? Number(body.timeframeMin) : 5,
    spot,
    regime: { posture },
    gexWalls: (body.gexWalls as VectorPlayInput["gexWalls"]) ?? null,
    gammaFlip: typeof body.gammaFlip === "number" ? body.gammaFlip : null,
    magnet: (body.magnet as VectorPlayInput["magnet"]) ?? null,
    proximity: (body.proximity as VectorPlayInput["proximity"]) ?? null,
    expectedMove: null,
    maxPain: null,
    confluenceZones: null,
    wallIntegrity: null,
    technicals: (body.technicals as VectorPlayInput["technicals"]) ?? null,
  };
}

/** Historical BIE grounding for a Vector play bucket — cache-reader over vector_pick_closures. */
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

  const snapshot = parseSnapshot(body);
  if (!snapshot) {
    return NextResponse.json({ error: "Invalid snapshot" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const bucketKey = vectorPlayBieBucketKey(snapshot);
  const bie = await resolveVectorPlayBieContext(snapshot);

  return NextResponse.json(
    {
      bucketKey,
      bie,
      insufficientSample: bie == null,
    },
    { headers: NO_STORE_HEADERS }
  );
}
