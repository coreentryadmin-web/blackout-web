// Wave C4 — dynamic BREAKOUT chain-fetch cap from breadth + qualifying pool size.
// DEFAULT-OFF via BREAKOUT_DYNAMIC_CAP; static ceiling when unset.

const DEFAULT_CEILING = 40;
const FLOOR = 15;

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export const BREAKOUT_DYNAMIC_CAP_ENABLED = envFlag("BREAKOUT_DYNAMIC_CAP");

export function resolveBreakoutCandidateCap(args: {
  qualifyingMovers: number;
  breadthPctAdvancing?: number | null;
  floor?: number;
  ceiling?: number;
}): number {
  if (!BREAKOUT_DYNAMIC_CAP_ENABLED) {
    return args.ceiling ?? DEFAULT_CEILING;
  }
  const floor = args.floor ?? FLOOR;
  const ceiling = args.ceiling ?? DEFAULT_CEILING;
  let cap = floor;
  const q = args.qualifyingMovers;
  if (q > 60) cap += Math.min(15, Math.floor((q - 60) / 200));
  const pct = args.breadthPctAdvancing;
  if (pct != null && Number.isFinite(pct) && pct > 0.55) cap += 5;
  return Math.max(floor, Math.min(ceiling, cap));
}
