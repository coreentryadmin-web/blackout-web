import { dbQuery, dbConfigured } from "@/lib/db";
import type { SpxAdminIssue } from "@/lib/admin-spx-issues";

export type AdminIncidentStatus = "open" | "acked" | "resolved";

export type AdminIncidentRow = {
  id: string;
  fingerprint: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  status: AdminIncidentStatus;
  opened_at: string;
  acked_at: string | null;
  resolved_at: string | null;
  acked_by: string | null;
  mtta_ms: number | null;
};

let schemaReady: Promise<void> | null = null;

async function ensureIncidentSchema(): Promise<void> {
  if (!dbConfigured()) return;
  if (!schemaReady) {
    schemaReady = dbQuery(`
      CREATE TABLE IF NOT EXISTS admin_incidents (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acked_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        acked_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents(status);
      CREATE INDEX IF NOT EXISTS idx_admin_incidents_opened ON admin_incidents(opened_at DESC);
    `).then(() => undefined);
  }
  await schemaReady;
}

function fingerprintFor(issue: SpxAdminIssue): string {
  return `${issue.category}:${issue.title}`;
}

/** Pure: a genuine "time to acknowledge" in ms, or null when no acknowledgment
 *  has happened yet. Deliberately NEVER falls back to "time elapsed since open"
 *  for a still-unacked incident — that would fabricate an ack latency for an
 *  incident nobody has acked, which is exactly what both the dashboard's
 *  aggregate "Avg MTTA" KPI and the per-row "MTTA" badge would otherwise
 *  silently display as a real measurement. */
export function computeMttaMs(ackedAtMs: number | null, openedAtMs: number): number | null {
  return ackedAtMs != null ? ackedAtMs - openedAtMs : null;
}

/** Pure: which currently open/acked fingerprints should be auto-resolved, given
 *  the active issue set and (optional) namespace-ownership scope. Split out from
 *  syncAdminIncidents so the filtering logic — the part most likely to grow an
 *  off-by-one or scope bug — is unit-testable without a live Postgres connection. */
export function computeIncidentsToResolve(
  openRows: Array<{ fingerprint: string; category: string }>,
  activeFingerprints: Set<string>,
  resolveScope?: (category: string) => boolean
): string[] {
  return openRows
    .filter((row) => (!resolveScope || resolveScope(row.category)) && !activeFingerprints.has(row.fingerprint))
    .map((row) => row.fingerprint);
}

export type PriorIncidentLifecycle = {
  status: AdminIncidentStatus;
  acked_at: string | null;
  acked_by: string | null;
  opened_at: string;
};

export type IncidentLifecycleFields = {
  status: AdminIncidentStatus;
  opened_at: string;
  acked_at: string | null;
  acked_by: string | null;
  resolved_at: string | null;
};

/**
 * Pure: the lifecycle fields an active issue's row should carry in the upsert, given what (if
 * anything) already exists for its fingerprint.
 *
 * THE BUG THIS FIXES. The previous upsert only reset `status`/`resolved_at` when the existing row
 * was `'resolved'` — it left `acked_at`/`acked_by`/`opened_at` untouched. So a fingerprint that had
 * been acked, then resolved, and later fired again (same category+title re-triggering, which is the
 * normal shape of a recurring issue, not a rare edge case) came back with `status: 'open'` but a
 * NON-NULL `acked_at`/`acked_by` carried straight over from its PREVIOUS occurrence, and an
 * `opened_at` from whenever it was first ever created.
 *
 * `computeMttaMs`'s own invariant (see its doc comment, and its own regression test) says a still-
 * open, never-acked incident must report a null MTTA — "that would fabricate an ack latency for an
 * incident nobody has acked." But `listOpenAdminIncidents` computes `mtta_ms` straight from whatever
 * `acked_at`/`opened_at` the row carries, with no awareness that this occurrence has never been
 * acked. `AdminOperationsDashboard`'s per-row "MTTA" badge is gated only on `incident.mtta_ms !=
 * null`, never on `incident.status`, and the dashboard's aggregate "Avg MTTA" KPI pools every
 * incident's `mtta_ms` unconditionally — so a reactivated-but-not-yet-acked-this-time incident would
 * silently render (and get averaged into the fleet KPI as) a real-looking ack-latency measurement
 * that belongs entirely to its last, unrelated occurrence.
 *
 * A brand-new fingerprint and a reactivated one both restart their whole lifecycle (fresh
 * `opened_at`, cleared ack/resolve state). A fingerprint that is still `open` or `acked` keeps its
 * lifecycle fields exactly as they are — only severity/detail refresh on re-detection.
 */
export function nextIncidentLifecycle(
  prior: PriorIncidentLifecycle | undefined,
  nowIso: string
): IncidentLifecycleFields {
  if (!prior || prior.status === "resolved") {
    return { status: "open", opened_at: nowIso, acked_at: null, acked_by: null, resolved_at: null };
  }
  return {
    status: prior.status,
    opened_at: prior.opened_at,
    acked_at: prior.acked_at,
    acked_by: prior.acked_by,
    resolved_at: null,
  };
}

/**
 * Reconcile open incidents against the current active issue set.
 *
 * `options.resolveScope` makes the AUTO-RESOLVE step namespace-aware so two
 * independent reconcilers can share this table without clobbering each other:
 * each caller only resolves incidents in the categories it owns. The SPX
 * Operations dashboard owns everything EXCEPT `data-integrity*`; the
 * data-integrity cron owns only `data-integrity*`. When omitted, the legacy
 * behavior (resolve every open incident not in the active set) is preserved.
 */
export async function syncAdminIncidents(
  issues: SpxAdminIssue[],
  options?: { resolveScope?: (category: string) => boolean }
): Promise<void> {
  if (!dbConfigured()) return;
  await ensureIncidentSchema();

  const active = issues.filter((i) => i.severity === "critical" || i.severity === "warning");
  const activeFp = new Set(active.map(fingerprintFor));

  // Batched multi-row upsert — this used to be N sequential dbQuery() round trips (one
  // INSERT per active issue). Called on every /api/admin/spx/dashboard request, polled
  // every 5s from the admin terminal tab (the default section) plus two crons, the
  // per-row loop held the small per-replica connection pool (max: 5, see db.ts) open
  // long enough under concurrent admin/audit load to starve unrelated reads into the
  // generic 35s query_timeout ("Query read timeout" — traced via CloudWatch runtime logs
  // to a burst of ~111 of these across admin routes in one storm). One round trip
  // regardless of issue count fixes the contention without touching the timeout/retry
  // classification.
  if (active.length > 0) {
    const fps = active.map(fingerprintFor);
    // Pre-fetch each active fingerprint's CURRENT lifecycle (one extra batched read, keyed
    // on the same fingerprints the upsert below is about to touch) so a fingerprint
    // reactivating from 'resolved' can have its WHOLE ack/open lifecycle restarted in JS,
    // via the pure, unit-tested nextIncidentLifecycle — see its doc comment for the exact
    // stale-acked_at/fabricated-MTTA bug this closes. The decision used to live entirely
    // inside a SQL CASE on the row's live `status` column, which could reset `status`/
    // `resolved_at` but quietly left `acked_at`/`acked_by`/`opened_at` untouched.
    const priorRes = await dbQuery<{
      fingerprint: string;
      status: AdminIncidentStatus;
      acked_at: string | null;
      acked_by: string | null;
      opened_at: string;
    }>(
      `SELECT fingerprint, status, acked_at::text AS acked_at, acked_by, opened_at::text AS opened_at
       FROM admin_incidents WHERE fingerprint = ANY($1::text[])`,
      [fps]
    );
    const priorByFp = new Map(priorRes.rows.map((r) => [r.fingerprint, r]));
    const nowIso = new Date().toISOString();

    const params: Array<string | null> = [];
    // EDGE-12 fix: the incident `id` is generated by PostgreSQL via gen_random_uuid()
    // instead of being supplied by the application. This eliminates the
    // parallel-request PRIMARY KEY collision that arose when two concurrent writers
    // could derive the same application-side sequential ID. ON CONFLICT (fingerprint)
    // means only the first insert per unique fingerprint wins; subsequent upserts
    // update metadata without touching id.
    const tuples = active
      .map((row, i) => {
        const fp = fps[i];
        const lc = nextIncidentLifecycle(priorByFp.get(fp), nowIso);
        const b = i * 10;
        params.push(fp, row.severity, row.category, row.title, row.detail, lc.status, lc.opened_at, lc.acked_at, lc.acked_by, lc.resolved_at);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::timestamptz, $${b + 8}::timestamptz, $${b + 9}, $${b + 10}::timestamptz)`;
      })
      .join(", ");

    await dbQuery(
      `INSERT INTO admin_incidents (id, fingerprint, severity, category, title, detail, status, opened_at, acked_at, acked_by, resolved_at, updated_at)
       SELECT gen_random_uuid()::text, fp, sev, cat, ttl, det, st, op, ak, akby, res, NOW()
       FROM (VALUES ${tuples}) AS t(fp, sev, cat, ttl, det, st, op, ak, akby, res)
       ON CONFLICT (fingerprint) DO UPDATE SET
         severity = EXCLUDED.severity,
         detail = EXCLUDED.detail,
         updated_at = NOW(),
         status = EXCLUDED.status,
         opened_at = EXCLUDED.opened_at,
         acked_at = EXCLUDED.acked_at,
         acked_by = EXCLUDED.acked_by,
         resolved_at = EXCLUDED.resolved_at`,
      params
    );
  }

  const openRows = await dbQuery<{ fingerprint: string; category: string }>(
    `SELECT fingerprint, category FROM admin_incidents WHERE status IN ('open', 'acked')`
  );
  // Namespace ownership stays a JS predicate (unchanged semantics — skip incidents
  // this caller doesn't own so a scoped reconciler never resolves another
  // reconciler's incidents); only the resolve WRITE is batched into one UPDATE.
  const toResolve = computeIncidentsToResolve(openRows.rows, activeFp, options?.resolveScope);

  if (toResolve.length > 0) {
    await dbQuery(
      `UPDATE admin_incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
       WHERE fingerprint = ANY($1::text[]) AND status IN ('open', 'acked')`,
      [toResolve]
    );
  }
}

export async function listOpenAdminIncidents(limit = 20): Promise<AdminIncidentRow[]> {
  if (!dbConfigured()) return [];
  await ensureIncidentSchema();
  const res = await dbQuery<{
    id: string;
    fingerprint: string;
    severity: string;
    category: string;
    title: string;
    detail: string;
    status: AdminIncidentStatus;
    opened_at: Date;
    acked_at: Date | null;
    resolved_at: Date | null;
    acked_by: string | null;
  }>(
    `SELECT id, fingerprint, severity, category, title, detail, status, opened_at, acked_at, resolved_at, acked_by
     FROM admin_incidents
     WHERE status IN ('open', 'acked')
     ORDER BY opened_at DESC
     LIMIT $1`,
    [limit]
  );

  return res.rows.map((row) => {
    const openedMs = new Date(row.opened_at).getTime();
    const ackedMs = row.acked_at ? new Date(row.acked_at).getTime() : null;
    return {
      id: row.id,
      fingerprint: row.fingerprint,
      severity: row.severity,
      category: row.category,
      title: row.title,
      detail: row.detail,
      status: row.status,
      opened_at: row.opened_at.toISOString(),
      acked_at: row.acked_at?.toISOString() ?? null,
      resolved_at: row.resolved_at?.toISOString() ?? null,
      acked_by: row.acked_by,
      mtta_ms: computeMttaMs(ackedMs, openedMs),
    };
  });
}

export async function ackAdminIncident(id: string, actorEmail: string | null): Promise<boolean> {
  if (!dbConfigured()) return false;
  await ensureIncidentSchema();
  const res = await dbQuery(
    `UPDATE admin_incidents SET status = 'acked', acked_at = NOW(), acked_by = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'open'`,
    [id, actorEmail]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function resolveAdminIncident(id: string): Promise<boolean> {
  if (!dbConfigured()) return false;
  await ensureIncidentSchema();
  const res = await dbQuery(
    `UPDATE admin_incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'acked')`,
    [id]
  );
  return (res.rowCount ?? 0) > 0;
}
