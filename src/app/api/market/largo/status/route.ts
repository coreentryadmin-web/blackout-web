import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { buildIntelligenceStatus, type SystemId, type SystemRead } from "@/lib/largo/core/system-status";

export const dynamic = "force-dynamic";

/**
 * LARGO INTELLIGENCE STATUS — the data behind the strip above the terminal.
 *
 * Every value is DERIVED from a real read. That is not a nicety: the strip's entire job is to say
 * "Largo is wired into the machine", and a row of dots that are green because they are hard-coded
 * green says the opposite the first time a member sees one lit during an outage.
 *
 * Each system's dot comes from calling that system's OWN production reader and asking two
 * questions — did it answer, and did it carry anything. No new data path, no parallel definition
 * of health; if a lane is broken for the desk it is broken here.
 *
 * NO ANTHROPIC CALL, no tool loop, no cost. This is a cheap deterministic fan-out, so the strip
 * can poll without touching the AI spend ledger — deliberately NOT routed through the Largo query
 * endpoint, which is gated, budgeted and expensive for good reasons that all apply to questions
 * and none of which apply to a heartbeat.
 */
export async function GET() {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;

  const startedAt = Date.now();
  const reads: Partial<Record<SystemId, SystemRead>> = {};
  let zerodteOpen: number | null = null;
  let swingCommitted: number | null = null;
  let bangerOpen: number | null = null;

  const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [{ marketPlatform }, productReads, { fetchVectorFullState }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/largo/product-reads"),
    import("@/lib/bie/vector-full-state"),
  ]);

  const [flows, gex, vector, swing, spxPlay, zerodte, banger] = await Promise.all([
    settle(marketPlatform.flows.getFlowTapeSummary({ limit: 20 })),
    settle(import("@/lib/largo/gex-heatmap-for-largo").then((m) => m.gexHeatmapForLargo("SPX"))),
    // Explicit "all": every other lane's health check here reads the canonical all-expiry
    // picture (gexHeatmapForLargo has no horizon concept at all). fetchVectorFullState's OWN
    // default param is "0dte" (Vector's chart opens on 0DTE by product design), so omitting
    // horizon here would silently scope this specific health probe to today's 0DTE expiries
    // only — a mismatch with what THERMAL's row on the same strip checks.
    settle(fetchVectorFullState("SPX", "all")),
    settle(productReads.swingHorizonForLargo()),
    settle(marketPlatform.spx.getSpxPlayState()),
    settle(import("@/lib/platform/zerodte-service").then((m) => m.zeroDtePlaysForLargo())),
    settle(productReads.bangerBoardForLargo(40)),
  ]);

  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

  reads.HELIX = { ok: flows != null, hasData: count((flows as { recent?: unknown[] })?.recent) > 0 };
  reads.THERMAL = { ok: gex != null, hasData: Boolean(gex && (gex as { available?: boolean }).available !== false) };
  reads.VECTOR = { ok: vector != null, hasData: Boolean(vector && vector.spot != null) };
  reads["NIGHT HAWK"] = {
    ok: swing != null,
    hasData: Boolean(swing && (swing as { available?: boolean }).available),
  };
  reads.SLAYER = { ok: spxPlay != null, hasData: spxPlay != null };

  const zPlays = (zerodte as { plays?: Array<{ status?: string }> } | null)?.plays ?? [];
  const zOpen = zPlays.filter((p) => !/closed|graded/i.test(String(p.status ?? "")));
  reads["0DTE"] = { ok: zerodte != null, hasData: zPlays.length > 0 };

  zerodteOpen = zerodte != null ? zOpen.length : null;
  swingCommitted =
    swing != null ? Number((swing as { committed_count?: number }).committed_count ?? 0) : null;
  bangerOpen =
    banger != null ? Number((banger as { open_count?: number }).open_count ?? 0) : null;

  // ET wall-clock via Intl — the session boundaries are ET, and the server is UTC.
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const part = (t: string) => et.find((p) => p.type === t)?.value ?? "";
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const etDay = DAYS[part("weekday")] ?? 1;
  const etMinutes = Number(part("hour")) * 60 + Number(part("minute"));

  const status = buildIntelligenceStatus({
    reads,
    zerodteOpen,
    swingCommitted,
    bangerOpen,
    dataAgeSec: (Date.now() - startedAt) / 1000,
    etDay,
    etMinutes,
  });

  const { helixThermalCompareForLargo } = await import("@/lib/largo/helix-thermal-compare");
  const compare = await helixThermalCompareForLargo("SPX").catch(() => null);

  return NextResponse.json(
    {
      ...status,
      toolConflict: compare
        ? {
            conflict: compare.conflict,
            note: compare.conflict_note,
            helix_bias: compare.helix.bias,
            thermal_bias: compare.thermal.bias,
          }
        : null,
    },
    { headers: NO_STORE_HEADERS }
  );
}
