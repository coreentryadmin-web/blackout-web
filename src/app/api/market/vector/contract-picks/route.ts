import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { resolveDteHorizonParam } from "@/features/vector/lib/vector-dte-horizon";
import { buildVectorContractPicks } from "@/features/vector/lib/vector-contract-picks";
import type { VectorPlayBias } from "@/features/vector/lib/vector-play-engine";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_BIAS = new Set<VectorPlayBias>(["long", "short", "range", "neutral"]);

function parseBias(raw: string | null): VectorPlayBias | null {
  return raw != null && (VALID_BIAS as Set<string>).has(raw) ? (raw as VectorPlayBias) : null;
}

/**
 * Real contract picks for the Vector Suggested Play rail. The client already computed the play
 * (bias + conviction) from live chart state — this endpoint's only job is fetching the ticker's
 * real chain and running it through `pickChainContract`, the SAME picker Night Hawk publishes
 * with, so a member never sees a Vector-only picker disagree with Night Hawk's read of the same
 * chain. Confidence is passed through as `conviction`, not recomputed — see
 * `vector-contract-picks.ts`'s module doc for why that's a rule, not an oversight.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const bias = parseBias(req.nextUrl.searchParams.get("bias"));
  if (!bias) {
    return NextResponse.json({ error: "Invalid bias" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const convictionRaw = Number(req.nextUrl.searchParams.get("conviction"));
  const conviction = Number.isFinite(convictionRaw) ? Math.max(0, Math.min(100, Math.round(convictionRaw))) : 0;

  const horizon = resolveDteHorizonParam(req.nextUrl.searchParams);

  const chain = await resolveTickerChainRows(rawTicker!);
  if (!chain) {
    // Honest empty, not an error — no chain reachable right now means no picks, same as any
    // other Vector overlay's degrade-to-absent rule.
    return NextResponse.json({ picks: [] }, { headers: NO_STORE_HEADERS });
  }

  const picks = buildVectorContractPicks({ bias, conviction }, chain, horizon);
  return NextResponse.json({ picks }, { headers: NO_STORE_HEADERS });
}
