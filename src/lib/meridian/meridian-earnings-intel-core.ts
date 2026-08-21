import type {
  MeridianErPlayRead,
  MeridianEarningsDarkPool,
  MeridianEarningsPrint,
} from "@/features/meridian/lib/meridian-types";
import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";
import { num } from "@/lib/meridian/meridian-viz-core";

function fmtPremShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** Map UW dark pool snapshot → Meridian earnings card slice (today's session prints). */
export function shapeMeridianDarkPool(snapshot: DarkPoolSnapshot | null): MeridianEarningsDarkPool {
  const hasPrints = Boolean(snapshot?.prints?.length);
  const totalPremium = snapshot?.total_premium ?? 0;

  if (!snapshot || (!hasPrints && totalPremium <= 0)) {
    return {
      available: false,
      bias: snapshot?.bias ?? "neutral",
      total_premium: totalPremium,
      total_premium_label: totalPremium > 0 ? fmtPremShort(totalPremium) : null,
      call_premium_label: null,
      put_premium_label: null,
      pcr: snapshot?.pcr ?? null,
      detail: snapshot?.detail ?? null,
      top_prints: [],
    };
  }

  if (!hasPrints && totalPremium > 0) {
    return {
      available: true,
      bias: snapshot!.bias,
      total_premium: totalPremium,
      total_premium_label: fmtPremShort(totalPremium),
      call_premium_label: snapshot!.call_premium > 0 ? fmtPremShort(snapshot!.call_premium) : null,
      put_premium_label: snapshot!.put_premium > 0 ? fmtPremShort(snapshot!.put_premium) : null,
      pcr: snapshot!.pcr,
      detail: snapshot!.detail ?? "Aggregate dark pool activity today — print tape unavailable",
      top_prints: [],
    };
  }

  return {
    available: true,
    bias: snapshot!.bias,
    total_premium: snapshot!.total_premium,
    total_premium_label: fmtPremShort(snapshot!.total_premium),
    call_premium_label: snapshot!.call_premium > 0 ? fmtPremShort(snapshot!.call_premium) : null,
    put_premium_label: snapshot!.put_premium > 0 ? fmtPremShort(snapshot!.put_premium) : null,
    pcr: snapshot!.pcr,
    detail: snapshot!.detail,
    top_prints: snapshot!.prints.slice(0, 8).map((p) => ({
      premium: p.premium,
      premium_label: fmtPremShort(p.premium),
      strike: p.strike > 0 ? p.strike : null,
      side: p.side || null,
      executed_at: p.executed_at?.slice(11, 16) ?? null,
    })),
  };
}

export type MeridianWallLevels = {
  /** Display resistance (upper structure band). */
  call_wall: number | null;
  /** Display support (lower structure band). */
  put_wall: number | null;
  /** Raw gamma argmax strike — most positive net GEX in the scoped chain. */
  gamma_call_wall: number | null;
  /** Raw gamma argmin strike — most negative net GEX in the scoped chain. */
  gamma_put_wall: number | null;
  /** True when gamma ordering is inverted (call gamma strike at or below put gamma strike). */
  walls_inverted: boolean;
};

/**
 * Coerce dealer walls into a display band where put_wall < call_wall.
 *
 * Gamma walls are defined as argmax/argmin of net GEX and CAN invert (validated live on SPX
 * 2026-08-14). Meridian panels render a "support – resistance" band, so we preserve the raw
 * gamma strikes and map the display band to [min, max] of the pair, using spot to break ties.
 */
export function coerceMeridianWallLevels(input: {
  call_wall: number | null | undefined;
  put_wall: number | null | undefined;
  spot?: number | null;
}): MeridianWallLevels {
  const gammaCall = num(input.call_wall);
  const gammaPut = num(input.put_wall);
  const spot = num(input.spot);

  if (gammaCall == null && gammaPut == null) {
    return {
      call_wall: null,
      put_wall: null,
      gamma_call_wall: null,
      gamma_put_wall: null,
      walls_inverted: false,
    };
  }
  if (gammaCall == null) {
    return {
      call_wall: gammaPut,
      put_wall: gammaPut,
      gamma_call_wall: null,
      gamma_put_wall: gammaPut,
      walls_inverted: false,
    };
  }
  if (gammaPut == null) {
    return {
      call_wall: gammaCall,
      put_wall: gammaCall,
      gamma_call_wall: gammaCall,
      gamma_put_wall: null,
      walls_inverted: false,
    };
  }

  const inverted = gammaCall <= gammaPut;
  if (!inverted) {
    return {
      call_wall: gammaCall,
      put_wall: gammaPut,
      gamma_call_wall: gammaCall,
      gamma_put_wall: gammaPut,
      walls_inverted: false,
    };
  }

  const lo = Math.min(gammaCall, gammaPut);
  const hi = Math.max(gammaCall, gammaPut);

  if (hi > lo) {
    return {
      call_wall: hi,
      put_wall: lo,
      gamma_call_wall: gammaCall,
      gamma_put_wall: gammaPut,
      walls_inverted: true,
    };
  }

  // Pinned single strike — use spot to split support/resistance when possible.
  if (spot != null && spot !== hi) {
    const call_wall = Math.max(hi, spot);
    const put_wall = Math.min(hi, spot);
    if (call_wall > put_wall) {
      return {
        call_wall,
        put_wall,
        gamma_call_wall: gammaCall,
        gamma_put_wall: gammaPut,
        walls_inverted: true,
      };
    }
  }

  return {
    call_wall: hi,
    put_wall: lo,
    gamma_call_wall: gammaCall,
    gamma_put_wall: gammaPut,
    walls_inverted: true,
  };
}

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
  dark_pool_bias?: string | null;
  gamma_regime: string | null;
  expected_move_pct: number | null;
  days_until: number | null;
  beat_rate: number | null;
  /** How many graded prints `beat_rate` came from. A rate off one print is not evidence. */
  beat_rate_graded?: number | null;
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

  const dpBias = (input.dark_pool_bias ?? "").toLowerCase();
  if (dpBias === "bullish") {
    bullish += 1;
    rationale.push("Dark pool tape skews bullish on today's institutional prints");
  } else if (dpBias === "bearish") {
    bearish += 1;
    rationale.push("Dark pool tape skews bearish on today's institutional prints");
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
    rationale.push(`Historical beat rate ${Math.round(input.beat_rate * 100)}%${cohortSuffix(input.beat_rate_graded)}`);
  } else if (input.beat_rate != null && input.beat_rate <= 0.35) {
    bearish += 1;
    rationale.push(
      `Recent prints skew misses (${Math.round(input.beat_rate * 100)}% beat rate${cohortSuffix(input.beat_rate_graded)})`
    );
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
/**
 * " over N prints" — or nothing when the count is unknown.
 *
 * Deliberately silent rather than guessing: an absent count means we were handed a rate without
 * its cohort, and inventing "over 0 prints" beside a real percentage would be worse than saying
 * nothing. Callers that have the count get it rendered; callers that do not are unchanged.
 */
function cohortSuffix(graded: number | null | undefined): string {
  if (graded == null || !Number.isFinite(graded) || graded <= 0) return "";
  return ` over ${graded} print${graded === 1 ? "" : "s"}`;
}

export function beatRateFromPrints(prints: MeridianEarningsPrint[]): number | null {
  return beatRateWithCohort(prints).rate;
}

/**
 * The same rate, with the number of prints it came from.
 *
 * `beatRateFromPrints` returns a bare number, and both of its consumers turned it into a
 * directional verdict AND a rendered percentage — at a 0.65/0.35 threshold that a single graded
 * print satisfies outright. Measured live, 10.2% of names that get an EPS beat rate at all get
 * it from one or two prints, so "100% beat rate on recent prints" is a real string this surface
 * produces off a sample of one. The cohort has to travel with the rate for a reader to discount
 * it; the bare accessor stays for callers that genuinely only want the number.
 */
export function beatRateWithCohort(prints: MeridianEarningsPrint[]): {
  rate: number | null;
  graded: number;
} {
  const graded = prints.filter((p) => p.beat != null);
  if (!graded.length) return { rate: null, graded: 0 };
  return { rate: graded.filter((p) => p.beat).length / graded.length, graded: graded.length };
}
