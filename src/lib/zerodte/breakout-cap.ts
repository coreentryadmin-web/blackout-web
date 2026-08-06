// Wave C4 → dynamic-N (2026-08-04) — BREAKOUT chain-fetch cap sized to the qualifying pool's
// breadth, replacing a fixed slice(0, N).
//
// WHY: `BREAKOUT_MAX_CANDIDATES` (`breakout-discovery.ts`) had already been raised 6→15→25→40
// chasing `discovery-recall-probe.mjs` evidence, and whole-market qualifying pools genuinely run
// several times the cap (302-554/day measured over 13 sessions). Raising the static number a 4th
// time would just repeat the pattern (a big-breadth day always outgrows whatever number is picked);
// this instead sizes N to the day's own breadth so a thin day still gets the safety-rail floor and a
// wide day recovers a real share of what the fixed cap was cutting off.
//
// FORMULA: N = clamp(ceil(qualifying * 0.30), floor, ceiling). floor=40 preserves today's worst-case
// behavior on quiet days (never worse than the status quo); ceiling=100 bounds worst-case chain-fetch
// growth to 2.5x today's static cap (`BREAKOUT_SCREEN_POOL` raised alongside it in
// breakout-discovery.ts so the upstream screen doesn't itself truncate the pool the formula reads).
//
// ⚠ EVIDENCE CORRECTION (2026-08-06) — the numbers this header used to cite were INVALID and have
// been removed. They claimed the dropped (rank 41+) cohort "matched or beat" the kept top-40 cohort
// on 3 of 5 sessions with "26-145 winning movers cut off per day". Both harnesses that produced them
// (`discovery-recall-probe.mjs`, `breakout-dynamic-n-ab.mjs`) split their cohorts with
// `screenBreakoutMovers(...).slice(0, KEEP)` — i.e. by **$-VOLUME**, the order that function returns
// — whereas production re-ranks by MOMENTUM QUALITY (`rankMoversForChainFetch`) before applying this
// cap (`breakout-discovery.ts:378-379`). The measured cohorts were not the cohorts the board forms.
//
// Corrected re-run (13 sessions 2026-07-20…2026-08-05, production ordering, same favorable-first
// grading): the slice dynamic-N adds (momentum ranks 41…N) grades **44.9% WR (n=767)** vs the static
// top-40's **43.1% (n=520)** — indistinguishable. So dynamic-N does NOT dilute candidate quality
// (the original worry) and does NOT upgrade it either: its value is MORE SHOTS AT THE SAME HIT RATE,
// not better names. The formula is therefore retained on that (weaker, honest) basis. Two facts from
// the same run are worth knowing before touching this file:
//   · N resolves to the CEILING (100) on 10/13 sessions and 91-99 on the rest — the 30% term and the
//     floor never bind in practice, so only the ceiling is a live lever.
//   · win rate does not decay with momentum rank (ranks 1-40: 43.1%, 41-100: 44.9%, 101+: 50.0%),
//     i.e. the RANKING, not the cap size, is the component without demonstrated signal.
// Full write-up + re-run commands: `docs/audit/INTENTIONAL-DESIGN.md` §4.
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
