import type { AlertKind, AlertRule } from "./vector-alerts";

/**
 * Pure helpers for the Vector alert-rules DB mapping — kept in a plain (non `server-only`) module
 * so they're importable from a bare `tsx --test` run. `vector-alert-rules-db.ts` re-exports these
 * alongside the actual `dbQuery`-touching code (same split as `vector-dte-walls-server.ts` /
 * `vector-dte-walls-core.ts`).
 */

export const VALID_ALERT_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(["wall-touch", "flip-cross"]);

export type VectorAlertRuleRow = {
  id: string;
  ticker: string;
  kind: string;
  tolerance_pct: number | string | null;
  enabled: boolean;
};

/**
 * Pure: DB row → AlertRule. `tolerance_pct` comes back from `pg` as a JS number for
 * DOUBLE PRECISION (never a string in practice), but the type is kept permissive/defensive
 * since this is the one seam between untyped SQL rows and the typed engine input. Only
 * well-formed rows are ever inserted (see `sanitizeIncomingRules`), so this doesn't re-validate
 * `kind` — a row with a corrupted kind would only exist from a hand-edit of the table.
 */
export function rowToAlertRule(row: VectorAlertRuleRow): AlertRule {
  const rawTol = row.tolerance_pct;
  const tol = rawTol == null ? undefined : Number(rawTol);
  return {
    id: row.id,
    ticker: row.ticker,
    kind: row.kind as AlertKind,
    enabled: Boolean(row.enabled),
    ...(tol != null && Number.isFinite(tol) ? { tolerancePct: tol } : {}),
  };
}

/**
 * Pure: validate + normalize a caller-supplied rules array before persisting. Mirrors the same
 * well-formedness filter `vector-alerts-store.ts`'s `loadAlertRules` applies to localStorage JSON —
 * a schema drift or hand-crafted payload can't corrupt the table or crash the route. The `ticker`
 * on every returned rule is forced to the route's URL-scoped ticker (never trusts a client-supplied
 * `rule.ticker` that might not match), and `tolerancePct` is dropped for non-wall-touch rules.
 */
export function sanitizeIncomingRules(ticker: string, incoming: unknown): AlertRule[] {
  if (!Array.isArray(incoming)) return [];
  const out: AlertRule[] = [];
  for (const r of incoming) {
    if (
      r &&
      typeof r === "object" &&
      typeof (r as { id?: unknown }).id === "string" &&
      (r as { id: string }).id.trim().length > 0 &&
      VALID_ALERT_KINDS.has((r as { kind?: AlertKind }).kind as AlertKind) &&
      typeof (r as { enabled?: unknown }).enabled === "boolean"
    ) {
      const rule = r as AlertRule;
      const tol =
        rule.kind === "wall-touch" && typeof rule.tolerancePct === "number" && Number.isFinite(rule.tolerancePct)
          ? rule.tolerancePct
          : undefined;
      out.push({
        id: rule.id,
        ticker,
        kind: rule.kind,
        enabled: rule.enabled,
        ...(tol != null ? { tolerancePct: tol } : {}),
      });
    }
  }
  return out;
}
