import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { canonicalTicker } from "@/lib/largo/core/entities";
import { validateFlowTape } from "@/lib/largo/core/flow-validation";

export const dynamic = "force-dynamic";

/**
 * CONTEXTUAL RAIL — the live object for the instrument the conversation is about.
 *
 * WHAT IT IS FOR. Largo answers in prose; the rail is the thing that STAYS. During a follow-up
 * chain ("is that wall still there?", "what about the put side?") the member is holding five
 * numbers in their head that the previous answer already gave them and the next answer may not
 * repeat. The rail keeps those five on screen so the conversation can be about reasoning instead
 * of re-stating state.
 *
 * IT MUST NEVER DISAGREE WITH THE ANSWER, which is the entire engineering problem. Two failure
 * modes, both silent, both fatal to trust:
 *   1. A DIFFERENT TICKER. If the client re-guessed the symbol from the question text, the rail
 *      could show NVDA while Largo answered about SPX. So the caller passes the ticker Largo
 *      ITSELF resolved, and it is canonicalised through the SAME `canonicalTicker` the entity
 *      layer uses — SPXW and $SPX collapse to SPX here exactly as they do there.
 *   2. A DIFFERENT NUMBER. Every field below is read from the SAME production function the
 *      corresponding Largo tool calls. The rail is a second VIEW of one source, never a second
 *      source. A rail that fetched its own quote would drift within seconds of a volatile print
 *      and the member would have no way to know which number to believe.
 *
 * DEGRADATION IS EXPLICIT. Each block reports `null` when its read failed, and the client renders
 * a dash rather than a zero. "We could not read the call wall" and "the call wall is 0" are
 * different statements and only one of them is ever true.
 *
 * CHEAP AND SAFE: parallel reads, no Anthropic call, no tool loop, no writes — so the rail can
 * refresh on a timer without touching the AI spend ledger or the per-user query budget.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;

  const raw = (req.nextUrl.searchParams.get("ticker") ?? "").trim();
  if (!raw) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  // Canonicalised through the shared entity layer so the rail and the answer can never be looking
  // at two spellings of one instrument.
  const canon = canonicalTicker(raw);
  const ticker = canon?.key ?? raw.toUpperCase();

  const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [{ fetchVectorFullState }, { normalizeDteHorizon }, productReads, { marketPlatform }] =
    await Promise.all([
      import("@/lib/bie/vector-full-state"),
      import("@/features/vector/lib/vector-dte-horizon"),
      import("@/lib/largo/product-reads"),
      import("@/lib/platform"),
    ]);

  const [vector, flows, swing] = await Promise.all([
    settle(fetchVectorFullState(ticker, normalizeDteHorizon("all"))),
    settle(marketPlatform.flows.getFlowTapeSummary({ limit: 200, ticker })),
    settle(productReads.swingHorizonForLargo()),
  ]);

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  // Net premium from the SAME tape HELIX renders, not a separate aggregate — so "+$18.2M" on the
  // rail is the number the flow page would show for this window.
  //
  // VALIDATED FIRST. A raw premium sum treats a deep-ITM stock-replacement print as ordinary
  // directional conviction, and those prints are almost always calls with six-figure premiums.
  // Measured live on SPX 2026-08-10: 43 of 500 prints flipped the headline net from +$23.94M
  // (reads bullish) to −$11.91M (reads bearish). The rail was showing the inverted number.
  const prints = Array.isArray((flows as { recent?: unknown[] })?.recent)
    ? ((flows as { recent: Array<{ premium?: number; option_type?: string; strike?: number; expiry?: string }> })
        .recent ?? [])
    : [];
  const { summary: flowSummary } = validateFlowTape(prints, num(vector?.spot), Date.now());
  const netPremium = flowSummary.netPremium;

  const swingLane = swing as { available?: boolean; sample_plays?: Array<{ ticker?: string; status?: string }> } | null;
  const swingHits = (swingLane?.sample_plays ?? []).filter(
    (p) => String(p.ticker ?? "").toUpperCase() === ticker
  );

  return NextResponse.json(
    {
      ticker,
      as_of: new Date().toISOString(),
      // null, never 0 — "could not read" and "is zero" are different claims.
      spot: num(vector?.spot),
      regime: vector?.regime?.posture ?? null,
      call_wall: num(vector?.gexWalls?.callWalls?.[0]?.strike ?? null),
      put_wall: num(vector?.gexWalls?.putWalls?.[0]?.strike ?? null),
      gamma_flip: num(vector?.gammaFlip ?? null),
      max_pain: num(vector?.maxPain ?? null),
      net_premium: netPremium,
      print_count: flowSummary.directional,
      /** What validation removed, and why. Surfaced so a member can see that the flow number is a
       *  FILTERED read rather than discovering later that it silently disagrees with the raw tape. */
      flow_excluded: flowSummary.exclusions,
      /** True when the raw and validated nets point opposite ways — worth saying out loud. */
      flow_sign_inverted: flowSummary.signInverted,
      /**
       * Concentration of the flow number. Measured live on SPX 2026-08-10: a single 7000-strike
       * call was 24% of |net|. "Market-wide flow is bullish" and "one desk bought one contract"
       * are different claims and a bare net premium cannot tell them apart.
       */
      flow_concentrated: flowSummary.concentrated,
      flow_top_print_share: flowSummary.topPrintShareOfGross,
      // Vector's own derived play, not a re-scored one — the rail cites, it does not compute.
      play: vector?.play
        ? {
            bias: vector.play.bias ?? null,
            grade: vector.play.grade ?? null,
            conviction: num((vector.play as { conviction?: number }).conviction ?? null),
          }
        : null,
      night_hawk: swingLane?.available
        ? { hits: swingHits.length, statuses: swingHits.map((p) => p.status ?? "").filter(Boolean) }
        : null,
      // Which reads actually landed, so the client can grey a block instead of showing a dash that
      // looks like a real "no wall here".
      available: {
        vector: vector != null,
        flow: flows != null,
        swing: swingLane?.available === true,
      },
    },
    { headers: NO_STORE_HEADERS }
  );
}
