import { dbQuery } from "@/lib/db";

/**
 * Server-side persistence for HELIX per-ticker flow alert rules. One row per (user, ticker) —
 * see helix-alert-rules-core.ts's header for why this differs from Vector's array-per-ticker
 * shape. Shared by the CRUD route (`/api/helix/alerts/rules`) and the inline evaluation hook
 * (`notifyHelixAlertSubscribers` in `helix-alert-notify.ts`, called from `flow-persist.ts` on
 * every newly-persisted print) so the row<->rule mapping and the lazy-create DDL exist in exactly
 * ONE place.
 *
 * Deliberately no `import "server-only"` guard (unlike Vector's vector-alert-rules-db.ts): this
 * module is reachable from flow-persist.ts's dependency graph (via helix-alert-notify.ts), which
 * has its own plain `node --test` suite (flow-persist.test.ts) run outside Next.js's module
 * resolution — `server-only` throws unconditionally there, not just in an actual client bundle.
 * `@/lib/db` itself (dbQuery, imported below) carries no such guard for the identical reason;
 * this module follows that same established precedent for anything on this import path.
 */

export {
  rowToHelixAlertRule,
  sanitizeIncomingHelixAlertRule,
  matchesHelixAlertRule,
  type HelixAlertRule,
  type HelixAlertRuleRow,
  type HelixAlertSide,
  type HelixAlertablePrint,
} from "./helix-alert-rules-core";

// Lazily ensure the table exists without touching the global migration set — same pattern as
// Vector's ensureVectorAlertRulesTable() / src/app/api/push/subscribe/route.ts's ensurePushTable().
// Idempotent; cheap; only runs when a member actually reads/writes a rule or a print evaluates
// against the table.
export async function ensureHelixAlertRulesTable(): Promise<void> {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS helix_alert_rules (
      user_id      TEXT NOT NULL,
      ticker       TEXT NOT NULL,
      min_premium  DOUBLE PRECISION NOT NULL,
      side         TEXT,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, ticker)
    )
  `);
  // Partial index: the inline evaluation hook (helix-alert-notify.ts) queries
  // `WHERE ticker = $1 AND enabled = true` on EVERY persisted flow print when the feature is
  // activated — this is the one query path that runs on the hot ingest loop, not the low-volume
  // CRUD route, so it's the one that needs an index. Partial (enabled-only) keeps it small and
  // skips disabled rows the query would filter out anyway.
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS helix_alert_rules_ticker_idx
      ON helix_alert_rules (ticker) WHERE enabled = true
  `);
}
