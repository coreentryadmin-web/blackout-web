// src/lib/swing/underlying-excursion.ts — shared signed favorable/adverse underlying-excursion math.
//
// EXTRACTED from manage-sync.ts (2026-10-26, Ask Largo standing mandate / Night Hawk Swings
// ownership mandate — see CLAUDE.md). `signedExcursionPct` used to live inline in manage-sync.ts
// and was called ONLY by the active-refresh cron tick that persists `running_mfe`/`running_mae`
// onto `swing_position_snapshots`. But the member/Largo-facing serve path (live-plays.ts's
// `livePlayFromSwingPosition`) needs the IDENTICAL math at a DIFFERENT, later point in time — the
// current HTTP request's own freshly-read spot, which can be materially newer than the last cron
// tick's persisted snapshot (the cron runs every 15 min during RTH; see live-plays.ts's own call
// site for the live bug this closes). Pulling it into its own module lets both the writer
// (manage-sync.ts) and this fresher reader (live-plays.ts) share one implementation instead of one
// recomputing it ad hoc or silently drifting from the other.
//
// WHY A SEPARATE FILE AND NOT A DIRECT live-plays.ts -> manage-sync.ts IMPORT: manage-sync.ts
// already imports `structuralBreakFromSpot` FROM live-plays.ts, so importing this function the
// other way around would create a live-plays.ts <-> manage-sync.ts circular import. Both modules
// import this one instead; neither imports the other for this.

/**
 * Signed favorable/adverse excursion (% vs entry), direction-aware, from the ratcheted price extremes plus
 * the given spot. The ledger keeps underlying_mfe/underlying_mae as PRICE high/low-water marks; this turns
 * those into the excursion the snapshot's running_mfe/running_mae carries (feature-store.ts's trajectory
 * studies read them as PERCENTS — `studyTwoStagnantSessions` compares running_mfe across sessions, and
 * `studyIvKillsGoodSetups` compares running_mae to a −3% threshold; both are meaningless against raw prices).
 *
 * Seeded with `entry` on both extremes so a fresh position starts at MFE ≥ 0 / MAE ≤ 0 (the documented sign
 * convention), and includes `spot` so the CALLER's own current tick counts even before whichever ratchet last
 * ran catches up to it — the whole reason this takes a live `spot` rather than trusting the prior extremes
 * alone. Honest-null when entry or spot is missing/invalid — never a fabricated 0.
 */
export function signedExcursionPct(args: {
  direction: "long" | "short";
  entryPx: number | null;
  spot: number | null;
  /** Prior ratcheted high-water PRICE (row.underlying_mfe) — optional; seeded from entry/spot when absent. */
  priorMfePx?: number | null;
  /** Prior ratcheted low-water PRICE (row.underlying_mae) — optional; seeded from entry/spot when absent. */
  priorMaePx?: number | null;
}): { mfePct: number | null; maePct: number | null } {
  const { entryPx: entry, spot } = args;
  if (entry == null || !Number.isFinite(entry) || entry <= 0 || spot == null || !Number.isFinite(spot)) {
    return { mfePct: null, maePct: null };
  }
  const fin = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
  const hi = Math.max(...[args.priorMfePx, spot, entry].filter(fin)); // favorable extreme (highest price)
  const lo = Math.min(...[args.priorMaePx, spot, entry].filter(fin)); // adverse extreme (lowest price)
  const pct = (px: number) => Math.round(((px - entry) / entry) * 100 * 1e4) / 1e4; // round — no unrounded floats
  // SHORT profits when price FALLS, so its favorable/adverse extremes are the mirror of a LONG's.
  return args.direction === "short"
    ? { mfePct: -pct(lo), maePct: -pct(hi) }
    : { mfePct: pct(hi), maePct: pct(lo) };
}
