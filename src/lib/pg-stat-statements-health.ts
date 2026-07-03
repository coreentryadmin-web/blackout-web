// BLACKOUT Intelligence Engine — Layer 3 diagnostic: is pg_stat_statements
// enabled on this Postgres instance? Read-only presence check ONLY, per
// explicit instruction — this module never attempts CREATE EXTENSION.
// Enabling it is a server-level Postgres config change (the extension must
// already be in shared_preload_libraries, which this app cannot set from SQL
// alone and may require a restart) — that decision is left to the user's
// explicit go-ahead, not made here.

import { dbConfigured, dbQuery } from "@/lib/db";

export type PgStatStatementsStatus =
  | { configured: false }
  | { configured: true; enabled: false }
  | { configured: true; enabled: true; tracked_statement_count: number };

/** One-shot read-only check: does `pg_extension` list pg_stat_statements, and
 *  if so, how many distinct statements is it currently tracking. Never
 *  fabricates a slow-query list beyond this presence check — building that
 *  out is a separate, larger piece of work once (if) the extension is live. */
export async function probePgStatStatements(): Promise<PgStatStatementsStatus> {
  if (!dbConfigured()) return { configured: false };
  try {
    const ext = await dbQuery<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
    );
    if (ext.rows.length === 0) return { configured: true, enabled: false };
    const count = await dbQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM pg_stat_statements`);
    return { configured: true, enabled: true, tracked_statement_count: Number(count.rows[0]?.n ?? 0) };
  } catch {
    return { configured: true, enabled: false };
  }
}
