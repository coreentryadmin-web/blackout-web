import type {
  MeridianErPlayRead,
  MeridianEarningsPrint,
} from "@/features/meridian/lib/meridian-types";

/** HELIX flow window scaled to days until print (cap 7d). */
export function flowWindowHours(daysUntil: number | null | undefined): number {
  if (daysUntil == null || !Number.isFinite(daysUntil)) return 72;
  if (daysUntil <= 0) return 24;
  if (daysUntil <= 1) return 48;
  if (daysUntil <= 3) return 72;
  return Math.min(168, 24 + daysUntil * 12);
}

export function beatArrow(beat: boolean | null): "↑" | "↓" | "→" | null {
  if (beat == null) return null;
  return beat ? "↑" : "↓";
}

export function moveArrow(pct: number | null): "↑" | "↓" | "→" | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0.25) return "↑";
  if (pct < -0.25) return "↓";
  return "→";
}

type PlayInput = {
  flow_bias: string;
  gamma_regime: string | null;
  expected_move_pct: number | null;
  days_until: number | null;
  beat_rate: number | null;
  spot: number | null;
  call_wall: number | null;
  put_wall: number | null;
  king_strike: number | null;
};

/**
 * Advisory ER read — structure/context only, not a trade ticket.
 * Always flags elevated gap risk on imminent prints.
 */
export function buildErPlayRead(input: PlayInput): MeridianErPlayRead {
  const rationale: string[] = [];
  const imminent = input.days_until != null && input.days_until <= 1;

  let bullish = 0;
  let bearish = 0;

  if (input.flow_bias === "bullish") {
    bullish += 2;
    rationale.push("HELIX flow skew is call-heavy into the print");
  } else if (input.flow_bias === "bearish") {
    bearish += 2;
    rationale.push("HELIX flow skew is put-heavy into the print");
  }

  const regime = (input.gamma_regime ?? "").toLowerCase();
  if (/positive|long gamma|support/.test(regime)) {
    bullish += 1;
    rationale.push("Gamma regime reads supportive — moves may mean-revert toward king levels");
  } else if (/negative|short gamma|vol expansion|accelerate/.test(regime)) {
    bearish += 1;
    rationale.push("Short-gamma regime — post-print moves can extend quickly");
  }

  if (input.beat_rate != null && input.beat_rate >= 0.65) {
    bullish += 1;
    rationale.push(`Historical beat rate ${Math.round(input.beat_rate * 100)}% over recent prints`);
  } else if (input.beat_rate != null && input.beat_rate <= 0.35) {
    bearish += 1;
    rationale.push(`Recent prints skew misses (${Math.round(input.beat_rate * 100)}% beat rate)`);
  }

  if (input.spot != null && input.call_wall != null && input.put_wall != null) {
    rationale.push(
      `Structure band ${input.put_wall.toLocaleString()} – ${input.call_wall.toLocaleString()} (spot ${input.spot.toLocaleString()})`
    );
  }

  let lean: MeridianErPlayRead["lean"] = "neutral";
  if (imminent) {
    lean = "avoid_directional";
    rationale.unshift("Print is imminent — gap risk dominates; size down or wait for reaction");
  } else if (bullish - bearish >= 2) lean = "bullish";
  else if (bearish - bullish >= 2) lean = "bearish";

  const em = input.expected_move_pct;
  let structure_hint: string | null = null;
  if (em != null && em > 0) {
    structure_hint = `If playing directionally, keep risk inside the ~${em}% options-implied band`;
    if (input.king_strike != null) {
      structure_hint += ` · king node ${input.king_strike.toLocaleString()}`;
    }
  }

  const headline =
    lean === "avoid_directional"
      ? "Imminent print — favor reaction over prediction"
      : lean === "bullish"
        ? "Flow + structure lean bullish into earnings"
        : lean === "bearish"
          ? "Flow + structure lean bearish into earnings"
          : "Mixed signals — no clean directional lean";

  return {
    available: rationale.length > 0,
    lean,
    confidence: imminent ? "low" : bullish + bearish >= 3 ? "medium" : "low",
    headline,
    rationale: rationale.slice(0, 5),
    structure_hint,
    risk_note:
      "Earnings gaps can exceed implied move. This is context, not a trade recommendation.",
  };
}

/** Beat rate from print history (0–1). */
export function beatRateFromPrints(prints: MeridianEarningsPrint[]): number | null {
  const graded = prints.filter((p) => p.beat != null);
  if (!graded.length) return null;
  return graded.filter((p) => p.beat).length / graded.length;
}
