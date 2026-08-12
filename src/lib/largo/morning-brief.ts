/**
 * Cron-generated morning brief — regime, flip, open plays. One Largo-style summary block.
 */

import { helixThermalCompareForLargo } from "@/lib/largo/helix-thermal-compare";
import { roundFloats } from "@/lib/round-floats";
import { todayEtYmd } from "@/lib/providers/spx-session";

export type LargoMorningBrief = {
  session_date: string;
  as_of: string;
  market_phase: string;
  spx: {
    spot: number | null;
    flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    gamma_regime: string | null;
  };
  flow_vs_gex: {
    conflict: boolean;
    note: string | null;
    helix_bias: string;
    thermal_bias: string;
  };
  open_plays: {
    zerodte_open: number;
    swing_committed: number;
  };
  summary: string;
};

export async function buildLargoMorningBrief(): Promise<LargoMorningBrief> {
  const sessionDate = todayEtYmd();
  const compare = await helixThermalCompareForLargo("SPX");

  const [zerodte, swing] = await Promise.all([
    import("@/lib/platform/zerodte-service").then((m) => m.zeroDtePlaysForLargo()).catch(() => null),
    import("@/lib/largo/product-reads").then((m) => m.swingHorizonForLargo()).catch(() => null),
  ]);

  const zPlays = (zerodte as { plays?: Array<{ status?: string }> } | null)?.plays ?? [];
  const zOpen = zPlays.filter((p) => !/closed|graded/i.test(String(p.status ?? ""))).length;
  const swingCommitted = Number((swing as { committed_count?: number } | null)?.committed_count ?? 0);

  const spot = compare.thermal.spot;
  const flip = compare.thermal.flip;
  const summaryParts = [
    `SPX ${spot != null ? spot.toFixed(0) : "—"} · flip ${flip ?? "—"}`,
    compare.thermal.gamma_regime ? String(compare.thermal.gamma_regime) : compare.thermal.summary,
    compare.conflict ? `Conflict: ${compare.conflict_note}` : "Flow and gamma aligned",
    `${zOpen} open 0DTE · ${swingCommitted} swing committed`,
  ];

  return roundFloats({
    session_date: sessionDate,
    as_of: new Date().toISOString(),
    market_phase: "PRE-MARKET",
    spx: {
      spot: compare.thermal.spot ?? null,
      flip: compare.thermal.flip ?? null,
      call_wall: compare.thermal.call_wall ?? null,
      put_wall: compare.thermal.put_wall ?? null,
      gamma_regime: compare.thermal.gamma_regime ?? null,
    },
    flow_vs_gex: {
      conflict: compare.conflict,
      note: compare.conflict_note,
      helix_bias: compare.helix.bias,
      thermal_bias: compare.thermal.bias,
    },
    open_plays: {
      zerodte_open: zOpen,
      swing_committed: swingCommitted,
    },
    summary: summaryParts.filter(Boolean).join(" · "),
  });
}

export function formatMorningBriefPush(brief: LargoMorningBrief): { title: string; body: string } {
  return {
    title: "Largo morning brief",
    body: brief.summary.slice(0, 240),
  };
}
