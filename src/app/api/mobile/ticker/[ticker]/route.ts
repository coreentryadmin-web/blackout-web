import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mobile per-ticker detail — the payload behind the Watchlist row tap sheet
 * in the native iOS app. Projects the LIGHT gex-positioning surface (walls,
 * flip, max pain, regime read) to a tight, stable, mobile-facing contract.
 *
 * Why its own endpoint instead of pointing the app at /api/market/
 * gex-positioning directly:
 *  - Contract stability: the desk positioning payload is 20+ fields and
 *    evolves constantly with each new lens (charm, vanna, dex...). The
 *    mobile detail sheet only needs 8 of them. Projection isolates the app
 *    binary from every desk-side rename.
 *  - Ticker validated + normalised here — the mobile app builds the URL
 *    with a user-typed ticker; centralising the guard here avoids leaking
 *    a malformed ticker to the paid gex-positioning cache-key.
 *  - Same auth gate every mobile route uses (premium OR cron).
 */

type MobileTickerDetail =
  | {
      ok: true;
      available: true;
      ticker: string;
      spot: number | null;
      changePct: number | null;
      asOf: string | null;
      levels: {
        flip: number | null;
        callWall: number | null;
        putWall: number | null;
        maxPain: number | null;
        nearestWall: { strike: number; kind: "call" | "put"; distancePts: number } | null;
      };
      regime: {
        gamma: string | null; // "positive_gamma" | "negative_gamma" | "transition"
        posture: "long" | "short" | null; // dealer gamma posture
        interpretation: string | null; // plain-English one-liner
      };
      degraded: boolean;
      fetchedAt: string;
    }
  | {
      ok: true;
      available: false;
      ticker: string;
      reason: string;
      fetchedAt: string;
    };

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

function interpretGamma(regime: string | null): string | null {
  switch ((regime ?? "").toLowerCase()) {
    case "positive_gamma":
      return "Dealer hedging suppresses moves. Expect chop; breakouts fade to structure.";
    case "negative_gamma":
      return "Dealer hedging amplifies moves. Expect trend; breakouts extend.";
    case "transition":
      return "Regime is unstable — treat both sides as tradeable, size down.";
    default:
      return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<Response> {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const raw = (await params).ticker ?? "";
  const ticker = raw.toUpperCase();
  const noStore = NO_STORE_HEADERS;

  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { ok: false, error: "Invalid ticker" },
      { status: 400, headers: noStore }
    );
  }

  try {
    // getGexPositioning is a cache-reader that never fabricates on miss —
    // returns null. That's a first-class "not covered" state for the mobile
    // sheet: SPY / SPX / etc. always available; a fresh ticker being added
    // to the watchlist for the first time may not have positioning yet.
    const p = await getGexPositioning(ticker);
    if (!p) {
      const payload: MobileTickerDetail = {
        ok: true,
        available: false,
        ticker,
        reason: "no dealer positioning available yet",
        fetchedAt: new Date().toISOString(),
      };
      return NextResponse.json(payload, { headers: noStore });
    }

    // Prefer the ranked walls for "nearest wall" — top-level `nearest_wall`
    // on the source payload is a summary; the ranked list is the authority.
    // Payload shape verified from `src/lib/providers/gex-positioning.ts`.
    const source = p as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
    const nw = source.nearest_wall as
      | { strike?: number; kind?: string; distance_pts?: number }
      | null
      | undefined;

    const kind: "call" | "put" | null =
      nw?.kind === "call" || nw?.kind === "put" ? nw.kind : null;
    const nearestWall =
      nw && num(nw.strike) != null && num(nw.distance_pts) != null && kind !== null
        ? {
            strike: num(nw.strike) as number,
            kind,
            distancePts: num(nw.distance_pts) as number,
          }
        : null;

    const gammaRegimeRead = str(source.gamma_regime_read);
    const rawGamma =
      typeof source.gamma_posture === "string" && (source.gamma_posture === "long" || source.gamma_posture === "short")
        ? source.gamma_posture
        : null;
    // Map plain-English regime read to a stable slug the app can key its
    // labels off ("Positive gamma" / "Negative gamma" / "Transition").
    let gammaSlug: string | null = null;
    if (gammaRegimeRead) {
      const low = gammaRegimeRead.toLowerCase();
      if (low.includes("positive")) gammaSlug = "positive_gamma";
      else if (low.includes("negative")) gammaSlug = "negative_gamma";
      else if (low.includes("transition")) gammaSlug = "transition";
    }

    const payload: MobileTickerDetail = {
      ok: true,
      available: true,
      ticker,
      spot: num(source.spot),
      changePct: num(source.change_pct),
      asOf: str(source.asof),
      levels: {
        flip: num(source.flip),
        callWall: num(source.call_wall),
        putWall: num(source.put_wall),
        maxPain: num(source.max_pain),
        nearestWall,
      },
      regime: {
        gamma: gammaSlug,
        posture: rawGamma,
        interpretation: interpretGamma(gammaSlug),
      },
      degraded: Boolean(source.degraded),
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(roundFloats(payload), { headers: noStore });
  } catch (err) {
    console.error("[api/mobile/ticker/", ticker, "]", err);
    // Match every other mobile route's failure contract — 200 with a
    // structured `available:false` so the app decodes cleanly, never
    // rendering an in-flight failure as an empty screen.
    const payload: MobileTickerDetail = {
      ok: true,
      available: false,
      ticker,
      reason: "temporary lookup failure",
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload, { headers: noStore });
  }
}
