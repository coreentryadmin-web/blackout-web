import "server-only";

import { dbQuery } from "@/lib/db";

/**
 * Server-side persistence for Vector alert rules — the missing piece `vector-alerts.ts`'s header
 * comment calls out ("member rules persisted server-side + a cron that calls sendWebPush"). Rules
 * still live primarily in browser localStorage (`vector-alerts-store.ts`); this table is a
 * best-effort SERVER MIRROR of the same rules so a cron with no open tab can evaluate them.
 *
 * Shared by both the CRUD route (`/api/vector/alerts/rules`) and the evaluation cron
 * (`/api/cron/vector-alerts`) so the row<->AlertRule mapping and the lazy-create DDL exist in
 * exactly ONE place — no duplicated schema/parsing logic between the two call sites. The pure
 * row<->AlertRule mapping lives in `vector-alert-rules-core.ts` (no `server-only`) so it stays
 * importable from a bare `tsx --test` run, same split as `vector-dte-walls-server.ts` /
 * `vector-dte-walls-core.ts`.
 */

export {
  VALID_ALERT_KINDS,
  rowToAlertRule,
  sanitizeIncomingRules,
  type VectorAlertRuleRow,
} from "./vector-alert-rules-core";

// Lazily ensure the table exists without touching the global migration set — same pattern as
// src/app/api/push/subscribe/route.ts's ensurePushTable(). Idempotent; cheap; only runs when a
// member actually adds/reads a rule or the cron ticks.
export async function ensureVectorAlertRulesTable(): Promise<void> {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS vector_alert_rules (
      id             TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      ticker         TEXT NOT NULL,
      kind           TEXT NOT NULL,
      tolerance_pct  DOUBLE PRECISION,
      enabled        BOOLEAN NOT NULL DEFAULT true,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, id)
    )
  `);
}
