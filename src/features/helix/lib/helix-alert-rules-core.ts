/**
 * Pure helpers for HELIX per-ticker flow alert rules — kept in a plain (non `server-only`) module
 * so they're importable from a bare `tsx --test` run, same split as Vector's
 * vector-alert-rules-core.ts / vector-alert-rules-db.ts.
 *
 * Deliberately ONE rule per (user, ticker) — not Vector's array-of-rules-per-ticker shape. Vector
 * needs multiple *kinds* of rule (wall-touch, flip-cross) coexisting on one ticker; HELIX has
 * exactly one kind ("premium threshold on this ticker's flow"), so a second rule on the same
 * ticker would only ever be a different threshold for the same thing — modeled as an update, not
 * a second row. This is why the DB primary key is (user_id, ticker), not (user_id, id).
 */

export type HelixAlertSide = "CALL" | "PUT" | null;

export type HelixAlertRule = {
  ticker: string;
  /** Minimum print premium (USD) that fires this rule. */
  minPremium: number;
  /** null = either side. */
  side: HelixAlertSide;
  enabled: boolean;
};

export type HelixAlertRuleRow = {
  ticker: string;
  min_premium: number | string;
  side: string | null;
  enabled: boolean;
};

/** Pure: DB row → HelixAlertRule. `min_premium` is DOUBLE PRECISION (a JS number from `pg` in
 *  practice) but read defensively since this is the one seam between untyped SQL rows and the
 *  typed engine input — same defensiveness as Vector's `rowToAlertRule`. */
export function rowToHelixAlertRule(row: HelixAlertRuleRow): HelixAlertRule {
  const minPremium = Number(row.min_premium);
  return {
    ticker: row.ticker,
    minPremium: Number.isFinite(minPremium) ? minPremium : 0,
    side: row.side === "CALL" || row.side === "PUT" ? row.side : null,
    enabled: Boolean(row.enabled),
  };
}

/** Pure: validate + normalize a caller-supplied rule before persisting. A schema drift or
 *  hand-crafted payload can't corrupt the table or crash the route — mirrors the well-formedness
 *  filter Vector's `sanitizeIncomingRules` applies. Returns null for anything malformed rather
 *  than guessing a default, since a silently-defaulted premium floor would be a real dollar
 *  amount a member never chose. `ticker` is forced to the route's URL/body-scoped ticker, never
 *  trusted from a nested field a client could mismatch. */
export function sanitizeIncomingHelixAlertRule(
  ticker: string,
  incoming: unknown
): { minPremium: number; side: HelixAlertSide; enabled: boolean } | null {
  if (!incoming || typeof incoming !== "object") return null;
  const r = incoming as { minPremium?: unknown; side?: unknown; enabled?: unknown };

  const minPremium = Number(r.minPremium);
  if (!Number.isFinite(minPremium) || minPremium <= 0) return null;

  const side: HelixAlertSide = r.side === "CALL" || r.side === "PUT" ? r.side : null;

  if (typeof r.enabled !== "boolean") return null;

  void ticker; // caller supplies the ticker separately (route param/body field), not from `incoming`
  return { minPremium, side, enabled: r.enabled };
}

/** The minimal shape this needs from a flow print — a subset of FlowRow (lib/db.ts) /
 *  PublishedFlowRow (flow-persist.ts), typed locally so this stays a plain, dependency-free
 *  module rather than importing a server-only type just for its shape. */
export type HelixAlertablePrint = {
  ticker: string;
  premium: number;
  option_type: string;
};

/**
 * Pure: does this print fire this rule? Ticker equality is case-sensitive by contract — both the
 * stored rule and every print's `ticker` are already-uppercased at their respective write sites
 * (route.ts normalizes on save; parseUwFlowAlert normalizes on ingest), so a mismatch here would
 * indicate a real normalization bug upstream rather than a case difference to paper over.
 */
export function matchesHelixAlertRule(rule: HelixAlertRule, print: HelixAlertablePrint): boolean {
  if (!rule.enabled) return false;
  if (rule.ticker !== print.ticker) return false;
  if (print.premium < rule.minPremium) return false;
  if (rule.side != null && rule.side !== print.option_type) return false;
  return true;
}
