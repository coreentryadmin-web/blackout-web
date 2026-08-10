/**
 * Shared Postgres helpers for ops audit scripts (cron-audit, ops-collect, validate-deploy).
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { auditSecret } from "./audit/lib/prod-secrets.mjs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

/** SSL config matching db.ts posture for public proxy vs private VPC. */
export function auditPgSsl(connectionString) {
  if (process.env.DATABASE_SSL === "0") return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) return false;
  if (connectionString.includes(".railway.internal")) return false;
  // Legacy TCP proxy (proxy.rlwy.net) does not negotiate TLS — plain TCP.
  if (connectionString.includes("proxy.rlwy")) return false;
  const strict = process.env.DATABASE_SSL_STRICT === "1";
  return { rejectUnauthorized: strict };
}

/** Resolve DATABASE_PUBLIC_URL from AWS Secrets Manager, env, or legacy Railway variables. */
export function resolveAuditDbUrl() {
  let dbUrl = auditSecret("DATABASE_PUBLIC_URL") || auditSecret("DATABASE_URL");
  if (!dbUrl) {
    try {
      const raw = execSync("railway variables --service blackout-web --json 2>/dev/null", {
        encoding: "utf8",
      });
      const vars = JSON.parse(raw);
      dbUrl = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
    } catch {
      /* optional */
    }
  }
  return dbUrl?.trim() || null;
}

/**
 * Render ANY thrown value into a diagnostic string that is never empty.
 *
 * WHY THIS EXISTS. The cron audit failed every run from 2026-08-10 onward logging exactly
 * `[cron-audit] Postgres connect failed: ` — nothing after the colon. `e.message` was empty, so
 * the log said only that something went wrong, and the message-matching classifiers below could
 * not match anything either, which silently disabled the watchdog fallback (see cron-audit-query).
 *
 * An error whose message is empty is not rare: `AggregateError` from Node's happy-eyeballs dual
 * -stack dialling carries its detail in `.errors`, TLS failures carry theirs in `.cause`, and
 * driver errors often carry only a `.code`. Reading `.message` alone throws all of that away at
 * exactly the moment it is needed. This walks every carrier and always returns something
 * actionable — falling back to the constructor name rather than "".
 */
export function describeConnectError(e) {
  const parts = [];
  const seen = new Set();

  const walk = (err, depth) => {
    if (!err || depth > 4 || seen.has(err)) return;
    seen.add(err);
    const msg = typeof err?.message === "string" ? err.message.trim() : "";
    const code = err?.code ? String(err.code) : "";
    if (code && msg) parts.push(`${code}: ${msg}`);
    else if (msg) parts.push(msg);
    else if (code) parts.push(code);
    // AggregateError (dual-stack dial) hides every real reason in .errors.
    if (Array.isArray(err?.errors)) for (const sub of err.errors) walk(sub, depth + 1);
    if (err?.cause) walk(err.cause, depth + 1);
  };
  walk(e, 0);

  if (!parts.length) {
    // Never return "" — an empty diagnostic is what caused this whole failure mode.
    const name = e?.constructor?.name ?? e?.name ?? typeof e;
    return `${name} with no message`;
  }
  return [...new Set(parts)].join(" | ");
}

/** True when Postgres is unreachable from this host (private RDS / cloud agent sandbox). */
export function isPrivateDbUnreachableError(message) {
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|self.signed|certificate/i.test(
    String(message ?? "")
  );
}

/** Stale GitHub/env DATABASE_PUBLIC_URL (wrong user/password) — not a prod outage. */
export function isStaleAuditDbAuthError(message) {
  return /password authentication failed/i.test(String(message ?? ""));
}

/** True when the URL targets the private ECS/RDS proxy (not reachable from GHA / cloud agents). */
export function isPrivateVpcDbUrl(connectionString) {
  const s = String(connectionString ?? "");
  if (!s) return false;
  if (s.includes("proxy.rlwy")) return false; // legacy Railway public TCP proxy
  if (s.includes("localhost") || s.includes("127.0.0.1")) return false;
  return /\.proxy[.-]/.test(s) || /\.rds\.amazonaws\.com/.test(s);
}

export function createAuditClient(connectionString) {
  return new Client({
    connectionString,
    ssl: auditPgSsl(connectionString),
    connectionTimeoutMillis: 10_000,
  });
}
