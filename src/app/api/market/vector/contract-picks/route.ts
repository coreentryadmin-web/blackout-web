import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { buildRankedVectorPicks, type VectorPlayPickContext } from "@/features/vector/lib/vector-contract-picks";
import type { VectorPlay, VectorPlayBias, VectorPlayGrade, VectorPlayStyle } from "@/features/vector/lib/vector-play-engine";
import type { PlayPlatformInputs } from "@/features/vector/lib/vector-play-platform";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_BIAS = new Set<VectorPlayBias>(["long", "short", "range", "neutral"]);
const VALID_STYLE = new Set<VectorPlayStyle>(["scalp", "swing", "position"]);
const VALID_GRADE = new Set<VectorPlayGrade>(["A", "B", "C"]);

function clampConviction(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

function parsePlay(body: Record<string, unknown>): VectorPlay | null {
  const bias = body.bias;
  if (typeof bias !== "string" || !VALID_BIAS.has(bias as VectorPlayBias)) return null;
  const style = typeof body.style === "string" && VALID_STYLE.has(body.style as VectorPlayStyle)
    ? (body.style as VectorPlayStyle)
    : "swing";
  const grade = typeof body.grade === "string" && VALID_GRADE.has(body.grade as VectorPlayGrade)
    ? (body.grade as VectorPlayGrade)
    : "B";
  return {
    style,
    bias: bias as VectorPlayBias,
    conviction: clampConviction(body.conviction),
    grade,
    headline: typeof body.headline === "string" ? body.headline : "",
    thesis: typeof body.thesis === "string" ? body.thesis : "",
    entryZone: typeof body.entryZone === "string" ? body.entryZone : undefined,
    targets: Array.isArray(body.targets) ? body.targets.filter((t): t is string => typeof t === "string") : [],
    starred: [],
  };
}

function parsePlatform(body: Record<string, unknown>): PlayPlatformInputs | null {
  const flows = body.flows;
  if (!Array.isArray(flows)) return null;
  return {
    sessionFlows: flows.map((f) => {
      const row = f as Record<string, unknown>;
      return {
        option_type: typeof row.option_type === "string" ? row.option_type : null,
        premium: typeof row.premium === "number" ? row.premium : null,
        strike: typeof row.strike === "number" ? row.strike : null,
        expiry: typeof row.expiry === "string" ? row.expiry : null,
      };
    }),
  };
}

function parseContext(body: Record<string, unknown>, ticker: string): VectorPlayPickContext | null {
  const play = parsePlay(body.play && typeof body.play === "object" ? (body.play as Record<string, unknown>) : body);
  if (!play) return null;
  const spot = Number(body.spot);
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    play,
    spot,
    callWall: numOrNull(body.callWall),
    putWall: numOrNull(body.putWall),
    magnetStrike: numOrNull(body.magnetStrike),
    platformInputs: parsePlatform(body),
  };
}

async function handlePicks(req: NextRequest, ticker: string, ctx: VectorPlayPickContext | null) {
  const chain = await resolveTickerChainRows(ticker);
  if (!chain) {
    return NextResponse.json({ picks: [] }, { headers: NO_STORE_HEADERS });
  }
  const picks = buildRankedVectorPicks(ctx, chain);
  return NextResponse.json({ picks }, { headers: NO_STORE_HEADERS });
}

/**
 * Rank 1–3 strong contract picks for the Vector play rail. POST body carries the full play
 * context (walls, spot, HELIX flow) so picks are scored independently across DTE windows —
 * not forced to the chart horizon or duplicated at one conviction.
 */
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

  const ctx = parseContext(body, rawTicker!);
  if (!ctx) {
    return NextResponse.json({ error: "Invalid play context" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  return handlePicks(req, rawTicker!, ctx);
}

/** Legacy GET — minimal context; prefer POST with full play + walls. */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const bias = req.nextUrl.searchParams.get("bias");
  if (!bias || !VALID_BIAS.has(bias as VectorPlayBias)) {
    return NextResponse.json({ error: "Invalid bias" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const ctx: VectorPlayPickContext = {
    play: {
      style: "swing",
      bias: bias as VectorPlayBias,
      conviction: clampConviction(req.nextUrl.searchParams.get("conviction")),
      grade: "B",
      headline: "",
      thesis: "",
      targets: [],
      starred: [],
    },
    spot: 0,
    platformInputs: null,
  };

  const chain = await resolveTickerChainRows(rawTicker!);
  if (!chain) {
    return NextResponse.json({ picks: [] }, { headers: NO_STORE_HEADERS });
  }
  ctx.spot = chain.spot;

  const picks = buildRankedVectorPicks(ctx, chain);
  return NextResponse.json({ picks }, { headers: NO_STORE_HEADERS });
}
