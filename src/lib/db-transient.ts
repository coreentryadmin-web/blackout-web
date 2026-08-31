/**
 * Classify Postgres/PgBouncer errors that are safe to retry once the pool reconnects.
 * PgBouncer surfaces brief backend-login blips as "server login has been failing" — a
 * single retry on a fresh connection usually succeeds (see provider-health-reconcile
 * cron failures in ops issue #242).
 */
export function isTransientPgError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code)
      : "";

  if (/server login has been failing|server_login_retry/i.test(msg)) return true;
  if (/connect failed|connection terminated|Connection terminated/i.test(msg)) return true;
  if (/timeout exceeded|too many clients|remaining connection slots/i.test(msg)) return true;
  // db.ts's resetPoolForRetry() tears down the shared module-level pool as soon as ANY
  // caller sees a transient error, with no coordination against other concurrent callers
  // still holding/awaiting that same pool reference. A caller mid-flight on the pool
  // another caller just ended gets this synchronous pg-library throw — a client-side
  // use-after-teardown, not a real DB failure. Treating it as transient lets the victim
  // retry (dbQuery's retry loop re-derives a fresh pool via getPool()) instead of failing
  // outright on an error the DB itself never raised (found 2026-08-31: a 17s live burst
  // where 5 unrelated subsystems, including the error-capture pipeline itself, all failed
  // on this exact race from one genuine transient blip).
  if (/Cannot use a pool after calling end on the pool/i.test(msg)) return true;

  const transientCodes = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "57P01", // admin_shutdown
    "53300", // too_many_connections
    "08006", // connection_failure
    "08001", // sqlclient_unable_to_establish_sqlconnection
    "08003", // connection_does_not_exist
  ]);
  if (code && transientCodes.has(code)) return true;

  return false;
}
