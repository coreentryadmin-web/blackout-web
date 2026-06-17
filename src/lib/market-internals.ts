/** Breadth-based estimates when Polygon does not return I:TICK / I:TRIN / I:ADD. */

export type BreadthSample = { change_pct: number };

const FLAT_THRESHOLD = 0.03;

function countAdvDec(samples: BreadthSample[]): { adv: number; dec: number; total: number } {
  let adv = 0;
  let dec = 0;
  for (const s of samples) {
    if (s.change_pct > FLAT_THRESHOLD) adv++;
    else if (s.change_pct < -FLAT_THRESHOLD) dec++;
  }
  return { adv, dec, total: samples.length };
}

/** Map adv/dec spread to a TICK-like reading (-1000..+1000). */
export function estimateTickFromBreadth(samples: BreadthSample[]): number | null {
  if (!samples.length) return null;
  const { adv, dec, total } = countAdvDec(samples);
  if (adv + dec === 0) return 0;
  const net = adv - dec;
  return Math.round((net / total) * 750);
}

/** Map adv/dec spread to an ADD-like reading. */
export function estimateAddFromBreadth(samples: BreadthSample[]): number | null {
  if (!samples.length) return null;
  const { adv, dec } = countAdvDec(samples);
  return (adv - dec) * 200;
}

/** Rough TRIN proxy from adv/dec ratio (typical range 0.5–2.0). */
export function estimateTrinFromBreadth(samples: BreadthSample[]): number | null {
  if (!samples.length) return null;
  const { adv, dec } = countAdvDec(samples);
  if (adv === 0 && dec === 0) return 1;
  if (dec === 0) return 0.65;
  if (adv === 0) return 1.45;
  const ratio = adv / dec;
  return Math.round(Math.min(2, Math.max(0.5, ratio)) * 100) / 100;
}

export function estimateInternalsFromBreadth(samples: BreadthSample[]): {
  tick: number | null;
  trin: number | null;
  add: number | null;
} {
  return {
    tick: estimateTickFromBreadth(samples),
    trin: estimateTrinFromBreadth(samples),
    add: estimateAddFromBreadth(samples),
  };
}

export function resolveMarketInternals(
  fromIndex: { tick: number | null; trin: number | null; add: number | null },
  breadthSamples: BreadthSample[]
): { tick: number | null; trin: number | null; add: number | null } {
  const est = estimateInternalsFromBreadth(breadthSamples);
  return {
    tick: fromIndex.tick ?? est.tick,
    trin: fromIndex.trin ?? est.trin,
    add: fromIndex.add ?? est.add,
  };
}
