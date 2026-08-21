/**
 * WHICH CHAIN each dealer-structure level describes.
 *
 * `thermal` carries eleven fields under one `expiry_scope` badge, and they do not all have the
 * same scope. When a listed expiry covers the print, `scopeStructureToExpiry` re-sums the WALLS
 * and MAX PAIN from that expiry alone — but the king node, the gamma flip, net GEX, the top-strike
 * table, the nearest wall and the regime sentence are passed through from the whole-book
 * aggregate, because they are not re-derived from `scoped.strikeTotals`. The badge claimed the
 * whole object.
 *
 * Measured on prod 2026-08-21 (BEKE, 0DTE print, spot 17.61), under a badge reading
 * "2026-08-21 expiry — settles the day of the print" / "Levels re-summed from the expiry that
 * covers this print":
 *
 *   King node  19.00 (+7.9%)     <- whole book across 12 expiries
 *   Call wall  17.50 (-0.6%)     <- the 2026-08-21 expiry, as the badge says
 *   net GEX $977K · "...long gamma: range-bound, fade extremes. Resistance 19, support 15."
 *                                <- whole book
 *   nearest resistance 19        <- whole book
 *
 * So the panel names TWO resistances at once — 17.50 and 19 — and tells a reader of a 0DTE print
 * that the dominant gamma strike is 19. Recomputed independently from the live chain, strike 19
 * carries ~$3.8K of dealer gamma on the 2026-08-21 expiry against ~$173K at 17.50; the $244K it
 * is credited with is the sum across twelve expiries, most of it in contracts that outlive the
 * print entirely. Every individual number is correct. The description of them was not.
 *
 * This module is the ONE place that says which is which, so the answer cannot drift between the
 * payload and the panel that renders it. It deliberately does NOT change any level: re-scoping
 * the king and the flip changes numbers members are reading during market hours, and it is a
 * product decision (an event-scoped king is the more useful reading for a print) rather than a
 * correction. Labelling what is already served is the honest half, and it is the half that can
 * ship mid-session without moving a single displayed price.
 */

/** Whether a level was re-summed from the print's own expiry, or taken from the whole book. */
export type ThermalLevelScope = "event_expiry" | "aggregate";

/** The levels whose scope can differ. `spot` is excluded — it is not chain-derived. */
export type ScopedThermalLevel =
  | "call_wall"
  | "put_wall"
  | "gamma_call_wall"
  | "gamma_put_wall"
  | "max_pain"
  | "gex_king_strike"
  | "flip";

export type ThermalScopes = {
  /** Per-level truth, for a UI that renders several of them in one list. */
  level_scopes: Record<ScopedThermalLevel, ThermalLevelScope>;
  /**
   * Scope of the DERIVED structure block — net GEX, the top-strike table, the nearest wall and
   * the regime sentence. Always the whole book: none of them is re-derived per expiry today.
   */
  structure_scope: ThermalLevelScope;
  /** Reader-facing description of that block's basis. */
  structure_scope_label: string;
};

/**
 * Which levels are re-summed from the event expiry when one is usable.
 *
 * Kept as data rather than branches so the set is auditable at a glance, and so a future change
 * that scopes the king node has exactly one line to move — and a test that will notice.
 */
const EVENT_SCOPED_WHEN_USABLE: ReadonlySet<ScopedThermalLevel> = new Set([
  "call_wall",
  "put_wall",
  "gamma_call_wall",
  "gamma_put_wall",
  "max_pain",
]);

/** Levels that come from the whole-book aggregate no matter what — they are never re-summed. */
export const ALWAYS_AGGREGATE_LEVELS: readonly ScopedThermalLevel[] = ["gex_king_strike", "flip"];

export function thermalScopes(
  scopeUsable: boolean,
  aggregateExpiryCount: number | null | undefined
): ThermalScopes {
  const walls: ThermalLevelScope = scopeUsable ? "event_expiry" : "aggregate";
  const level_scopes = {} as Record<ScopedThermalLevel, ThermalLevelScope>;
  for (const level of [...EVENT_SCOPED_WHEN_USABLE, ...ALWAYS_AGGREGATE_LEVELS]) {
    level_scopes[level] = EVENT_SCOPED_WHEN_USABLE.has(level) ? walls : "aggregate";
  }

  const n = Number(aggregateExpiryCount);
  // "several" rather than a number when the count is absent — a fabricated count in a sentence
  // whose whole job is to say what the number is built from would defeat the point.
  const count = Number.isFinite(n) && n > 0 ? `${n}` : "several";
  return {
    level_scopes,
    structure_scope: "aggregate",
    structure_scope_label: `whole-book aggregate across ${count} near-term expiries`,
  };
}

/** True when a panel mixes scopes and therefore must label its levels individually. */
export function scopesAreMixed(scopes: ThermalScopes): boolean {
  const seen = new Set(Object.values(scopes.level_scopes));
  return seen.size > 1;
}
