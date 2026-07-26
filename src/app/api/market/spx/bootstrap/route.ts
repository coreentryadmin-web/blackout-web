import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadBootstrapBundle, type MergedSpxDeskBundle } from "@/features/spx/lib/spx-desk-loader";
import { roundFloats } from "@/lib/round-floats";
import { auth as resolveAuthSession } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-access";
import { getSpxSimSnapshot, isSpxSimRequested, shouldServeSpxSim } from "@/lib/platform/spx-sim-desk";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

export type SpxBootstrapPayload = {
  desk: MergedSpxDeskBundle["desk"];
  flow: MergedSpxDeskBundle["flow"];
  pulse: MergedSpxDeskBundle["pulse"];
  merged: MergedSpxDeskBundle["merged"];
  /** Deprecated — matrix loads via /gex-heatmap (own cache lane). Kept for older clients. */
  gexHeatmap: null;
};

/**
 * One round-trip for dashboard first paint: merged desk lanes only.
 * SPX matrix uses /gex-heatmap (desk-warm keeps both caches hot). Bundling the full
 * matrix here caused Cloudflare 524 timeouts on cold cache (~125s) and forced the
 * client to fall back to 4 parallel lane XHRs — the main source of ~10s dashboard loads.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // ── ADMIN-ONLY simulation branch (fix/spx-desk-sim) ───────────────────────────────
  // Serve the ISOLATED sim bundle ONLY when BOTH hold: a signed-in ADMIN and `?sim=1`.
  // Every other case (no `?sim=1`, a non-admin even with `?sim=1`, a cron caller) falls
  // straight through to the UNCHANGED live path below. See spx-sim-desk.ts.
  if (isSpxSimRequested(req.nextUrl.searchParams.get("sim")) && auth.via === "user" && auth.userId) {
    const { sessionClaims } = await resolveAuthSession();
    if (shouldServeSpxSim(await isAdminUser(auth.userId, sessionClaims), true)) {
      const snap = await getSpxSimSnapshot();
      const simBootstrap =
        snap.bootstrap ?? { desk: { available: false }, flow: null, pulse: null, merged: { available: false }, gexHeatmap: null };
      return NextResponse.json(roundFloats(simBootstrap), { headers: { ...NO_STORE, "X-Spx-Sim": "1" } });
    }
    // Non-admin passed ?sim=1 → deliberately fall through to the live member path unchanged.
  }

  try {
    const bundle = await loadBootstrapBundle();

    const payload: SpxBootstrapPayload = {
      desk: bundle.desk,
      flow: bundle.flow,
      pulse: bundle.pulse,
      merged: bundle.merged,
      gexHeatmap: null,
    };

    return NextResponse.json(roundFloats(payload), { headers: NO_STORE });
  } catch (error) {
    console.error("[market/spx/bootstrap]", error);
    return NextResponse.json({ error: "Bootstrap failed" }, { status: 502, headers: NO_STORE });
  }
}
