// Wave C4 → dynamic-N (2026-08-04) — BREAKOUT chain-fetch cap sized to the qualifying pool's
// breadth, replacing a fixed slice(0, N).
//
// WHY: `BREAKOUT_MAX_CANDIDATES` (the static ceiling, `breakout-discovery.ts`) had already been
// raised 6→15→25→40 chasing `discovery-recall-probe.mjs` evidence, and was STILL leaky at 40 — the
// corrected multi-session probe run (2026-08-04, see FINDINGS.md, "screenBreakoutMovers(results,
// SCAN_TOP)" fix) found real whole-market qualifying pools of 100-390 candidates/day, with the
// dropped (rank 41+) cohort matching or beating the kept top-40 cohort's win rate on 3 of 5 sampled
// sessions and 26-145 real winning movers cut off per day purely by rank. Raising the static number
// a 4th time would just repeat the pattern (a big-breadth day always outgrows whatever number is
// picked); this instead sizes N to the day's own breadth so a thin day still gets the safety-rail
// floor and a wide day recovers a real share of what the fixed cap was cutting off.
//
// FORMULA: N = clamp(ceil(qualifying * 0.30), floor, ceiling). floor=40 preserves today's worst-case
// behavior on quiet days (never worse than the status quo); ceiling=100 bounds worst-case chain-fetch
// growth to 2.5x today's static cap (`BREAKOUT_SCREEN_POOL` raised alongside it in
// breakout-discovery.ts so the upstream screen doesn't itself truncate the pool the formula reads).
// See `scripts/audit/breakout-dynamic-n-ab.mjs` for the A/B evidence (static-40 vs dynamic-N) across
// the same 5 sessions the recall-probe fix validated.
const DEFAULT_FLOOR = 40;
const DEFAULT_CEILING = 100;
/** Fraction of the qualifying pool kept before the floor/ceiling clamp. */
const POOL_PCT = 0.3;

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** Emergency kill-switch: set to revert to the static floor (today's pre-2026-08-04 behavior)
 *  without a redeploy, in case dynamic sizing misbehaves live. Default OFF (dynamic-N is live). */
export const BREAKOUT_DYNAMIC_CAP_DISABLED = envFlag("BREAKOUT_DYNAMIC_CAP_DISABLED");

/**
 * Size the BREAKOUT chain-fetch cap from the qualifying pool's breadth. Pure, deterministic.
 * - Disabled (kill-switch on): returns `floor` (the static pre-dynamic value) unconditionally.
 * - Enabled (default): `max(floor, min(ceiling, ceil(qualifyingMovers * 0.30)))` — a thin day never
 *   drops below the safety-rail floor; a huge-breadth day is bounded at the ceiling rather than
 *   exploding 1:1 with the pool (which would blow out the chain-fetch/Polygon-call budget).
 */
export function resolveBreakoutCandidateCap(args: {
  qualifyingMovers: number;
  floor?: number;
  ceiling?: number;
  /** Test-only override for the module-level kill-switch; production omits it. */
  disabled?: boolean;
}): number {
  const floor = args.floor ?? DEFAULT_FLOOR;
  const disabled = args.disabled ?? BREAKOUT_DYNAMIC_CAP_DISABLED;
  if (disabled) {
    return floor;
  }
  const ceiling = args.ceiling ?? DEFAULT_CEILING;
  const raw = Math.ceil(args.qualifyingMovers * POOL_PCT);
  return Math.max(floor, Math.min(ceiling, raw));
}
