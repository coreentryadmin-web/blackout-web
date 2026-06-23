/** 0DTE gamma desk — flip level & GEX walls (ported from engine gamma_desk.py). */

export type GexStrikeLevel = {
  strike: number;
  net_gex: number;
  call_gex: number;
  put_gex: number;
};

export type GexWall = {
  strike: number;
  net_gex: number;
  kind: "support" | "resistance";
  distance_pts: number;
};

export function analyzeStrikeGexRows(rows: Record<string, unknown>[]): {
  net_gex: number;
  gex_king_strike: number | null;
  ranked_levels: GexStrikeLevel[];
} {
  const levels: GexStrikeLevel[] = [];
  let totalCall = 0;
  let totalPut = 0;

  for (const row of rows) {
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    const callG = Number(row.call_gamma_oi ?? row.call_gex ?? 0);
    const putG = Number(row.put_gamma_oi ?? row.put_gex ?? 0);
    const net = callG + putG;
    // Drop ONLY genuinely empty (0/0) strikes. Since net = callG + putG, the test
    // (callG === 0 && putG === 0) already implies net === 0, so the old `net === 0 &&`
    // clause was redundant. A balanced strike (callG = -putG, net = 0) deliberately
    // SURVIVES: it adds 0 to computeGammaFlip's cumulative sum (output-neutral), so it
    // never distorts the flip. Do NOT change this to `if (net === 0) continue;` — that
    // would delete real balanced strikes and shift flip anchoring.
    if (callG === 0 && putG === 0) continue;
    totalCall += callG;
    totalPut += putG;
    levels.push({ strike, net_gex: net, call_gex: callG, put_gex: putG });
  }

  const ranked = [...levels].sort((a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex));
  const king = ranked[0]?.strike ?? null;

  return {
    net_gex: totalCall + totalPut,
    gex_king_strike: king,
    ranked_levels: ranked,
  };
}

export function computeGammaFlip(
  levels: Array<{ strike: number; net_gex: number }>,
  spot: number
): number | null {
  if (!levels.length || spot <= 0) return null;

  const sorted = [...levels].sort((a, b) => a.strike - b.strike);
  let cum = 0;
  let prevStrike: number | null = null;
  let prevCum = 0;
  let bestFlip: number | null = null;
  let bestDist = Infinity;

  for (const lv of sorted) {
    const strike = lv.strike;
    const net = lv.net_gex;
    const newCum = cum + net;

    if (prevStrike != null) {
      if (prevCum === 0) {
        const flip = prevStrike;
        const dist = Math.abs(spot - flip);
        if (dist < bestDist) {
          bestDist = dist;
          bestFlip = flip;
        }
      } else if (newCum === 0) {
        const flip = strike;
        const dist = Math.abs(spot - flip);
        if (dist < bestDist) {
          bestDist = dist;
          bestFlip = flip;
        }
      } else if (prevCum * newCum < 0) {
        const denom = Math.abs(prevCum) + Math.abs(newCum);
        const frac = denom > 0 ? Math.abs(prevCum) / denom : 0.5;
        const flip = prevStrike + frac * (strike - prevStrike);
        const dist = Math.abs(spot - flip);
        if (dist < bestDist) {
          bestDist = dist;
          bestFlip = Math.round(flip * 100) / 100;
        }
      }
    }

    cum = newCum;
    prevStrike = strike;
    prevCum = newCum;
  }

  return bestFlip;
}

export function gammaRegime(spot: number, flip: number | null): string {
  if (flip == null) return "unknown";
  return spot > flip ? "mean_revert" : "amplification";
}

export function topGexWalls(levels: GexStrikeLevel[], spot: number, limit = 6): GexWall[] {
  if (!levels.length || spot <= 0) return [];

  const band = Math.max(spot * 0.012, 75);
  const near = levels.filter((l) => Math.abs(l.strike - spot) <= band);
  const pool =
    near.length >= 3
      ? near
      : [...levels]
          .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
          .slice(0, Math.max(limit * 4, 24));

  const above = pool
    .filter((l) => l.strike > spot)
    .sort((a, b) => a.strike - b.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));
  const below = pool
    .filter((l) => l.strike <= spot)
    .sort((a, b) => b.strike - a.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));

  const half = Math.ceil(limit / 2);
  const walls: GexWall[] = [];

  for (const lv of below.slice(0, half)) {
    walls.push({
      strike: lv.strike,
      net_gex: lv.net_gex,
      kind: "support",
      distance_pts: Math.round((lv.strike - spot) * 100) / 100,
    });
  }
  for (const lv of above.slice(0, half)) {
    walls.push({
      strike: lv.strike,
      net_gex: lv.net_gex,
      kind: "resistance",
      distance_pts: Math.round((lv.strike - spot) * 100) / 100,
    });
  }

  return walls.sort((a, b) => b.strike - a.strike);
}
