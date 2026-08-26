import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { buildRankedVectorPicks, type VectorPlayPickContext } from "@/features/vector/lib/vector-contract-picks";
import type { VectorPlay, VectorPlayBias, VectorPlayGrade, VectorPlayStyle, PlayTechnicals } from "@/features/vector/lib/vector-play-engine";
import type { PlayPlatformInputs } from "@/features/vector/lib/vector-play-platform";
import type { VectorRegimePosture } from "@/features/vector/lib/vector-regime";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { loadVectorPickEnrichment } from "@/features/vector/lib/vector-pick-enrichment";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_BIAS = new Set<VectorPlayBias>(["long", "short", "range", "neutral"]);
const VALID_STYLE = new Set<VectorPlayStyle>(["scalp", "swing", "position"]);
const VALID_GRADE = new Set<VectorPlayGrade>(["A", "B", "C"]);
const VALID_POSTURE = new Set<VectorRegimePosture>(["long", "short", "transition", "unknown"]);

function clampConviction(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

function parsePlay(raw: Record<string, unknown>): VectorPlay | null {
  const bias = raw.bias;
  if (typeof bias !== "string" || !VALID_BIAS.has(bias as VectorPlayBias)) return null;
  const style = typeof raw.style === "string" && VALID_STYLE.has(raw.style as VectorPlayStyle)
    ? (raw.style as VectorPlayStyle)
    : "swing";
  const grade = typeof raw.grade === "string" && VALID_GRADE.has(raw.grade as VectorPlayGrade)
    ? (raw.grade as VectorPlayGrade)
    : "B";
  return {
    style,
    bias: bias as VectorPlayBias,
    conviction: clampConviction(raw.conviction),
    grade,
    headline: typeof raw.headline === "string" ? raw.headline : "",
    thesis: typeof raw.thesis === "string" ? raw.thesis : "",
    entryZone: typeof raw.entryZone === "string" ? raw.entryZone : undefined,
    targets: Array.isArray(raw.targets) ? raw.targets.filter((t): t is string => typeof t === "string") : [],
    starred: Array.isArray(raw.starred) ? raw.starred.filter((t): t is string => typeof t === "string") : [],
  };
}

function parseTechnicals(raw: unknown): PlayTechnicals | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ema = o.emaStack;
  const macd = o.macd;
  const gp = o.goldenPocket;
  const st = o.structure;
  return {
    vwap: typeof o.vwap === "number" ? o.vwap : null,
    emaStack: ema === "up" || ema === "down" || ema === "mixed" ? ema : null,
    rsi: typeof o.rsi === "number" ? o.rsi : null,
    macd: macd === "bull" || macd === "bear" ? macd : null,
    goldenPocket:
      gp && typeof gp === "object"
        ? {
            low: Number((gp as Record<string, unknown>).low),
            high: Number((gp as Record<string, unknown>).high),
          }
        : null,
    structure:
      st && typeof st === "object"
        ? {
            type: String((st as Record<string, unknown>).type ?? ""),
            direction: String((st as Record<string, unknown>).direction ?? ""),
            level: Number((st as Record<string, unknown>).level),
          }
        : null,
  };
}

function parseConfluence(raw: unknown): ConfluenceZone[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfluenceZone[] = [];
  for (const z of raw) {
    const row = z as Record<string, unknown>;
    const center = Number(row.center);
    const score = Number(row.score);
    if (!Number.isFinite(center) || !Number.isFinite(score)) continue;
    out.push({
      center,
      low: center,
      high: center,
      score,
      kinds: Array.isArray(row.kinds)
        ? (row.kinds.filter((k) => typeof k === "string") as ConfluenceZone["kinds"])
        : [],
      levels: [],
    });
  }
  return out;
}

function parseDarkPool(raw: unknown): VectorDarkPoolLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => {
      const row = d as Record<string, unknown>;
      const strike = Number(row.strike);
      const premium = Number(row.premium);
      const pct = Number(row.pct);
      if (!Number.isFinite(strike) || strike <= 0) return null;
      return { strike, premium: premium || 0, pct: pct || 0 };
    })
    .filter((d): d is VectorDarkPoolLevel => d != null);
}

function parsePlatform(body: Record<string, unknown>): PlayPlatformInputs {
  const flows = body.flows;
  const darkPoolLevels = parseDarkPool(body.darkPoolLevels);
  return {
    sessionFlows: Array.isArray(flows)
      ? flows.map((f) => {
          const row = f as Record<string, unknown>;
          return {
            option_type: typeof row.option_type === "string" ? row.option_type : null,
            premium: typeof row.premium === "number" ? row.premium : null,
            strike: typeof row.strike === "number" ? row.strike : null,
            expiry: typeof row.expiry === "string" ? row.expiry : null,
          };
        })
      : [],
    darkPoolLevels,
  };
}

function parseContext(body: Record<string, unknown>): VectorPlayPickContext | null {
  const play = parsePlay(body.play && typeof body.play === "object" ? (body.play as Record<string, unknown>) : body);
  if (!play) return null;
  const spot = Number(body.spot);
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const posture = body.regimePosture;
  return {
    play,
    spot,
    callWall: numOrNull(body.callWall),
    putWall: numOrNull(body.putWall),
    magnetStrike: numOrNull(body.magnetStrike),
    gammaFlip: numOrNull(body.gammaFlip),
    regimePosture:
      typeof posture === "string" && VALID_POSTURE.has(posture as VectorRegimePosture)
        ? (posture as VectorRegimePosture)
        : null,
    technicals: parseTechnicals(body.technicals),
    confluenceZones: parseConfluence(body.confluenceZones),
    platformInputs: parsePlatform(body),
  };
}

async function handlePicks(ctx: VectorPlayPickContext | null, ticker: string) {
  const chain = await resolveTickerChainRows(ticker);
  if (!chain) {
    return NextResponse.json({ picks: [] }, { headers: NO_STORE_HEADERS });
  }
  const enrichment = await loadVectorPickEnrichment(ticker);
  const enrichedCtx: VectorPlayPickContext | null = ctx
    ? {
        ...ctx,
        enrichment: {
          gexKingStrike: enrichment.gexKingStrike,
          maxPain: enrichment.maxPain,
          strikeTotals: enrichment.strikeTotals,
          catalysts: enrichment.catalysts,
          newsHeadline: enrichment.newsHeadline,
        },
      }
    : null;
  const picks = buildRankedVectorPicks(enrichedCtx, chain);
  return NextResponse.json({ picks }, { headers: NO_STORE_HEADERS });
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

  const ctx = parseContext(body);
  if (!ctx) {
    return NextResponse.json({ error: "Invalid play context" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  return handlePicks(ctx, rawTicker!);
}

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

  const chain = await resolveTickerChainRows(rawTicker!);
  if (!chain) {
    return NextResponse.json({ picks: [] }, { headers: NO_STORE_HEADERS });
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
    spot: chain.spot,
    platformInputs: { sessionFlows: [], darkPoolLevels: [] },
  };

  const picks = buildRankedVectorPicks(ctx, chain);
  return NextResponse.json({ picks }, { headers: NO_STORE_HEADERS });
}
