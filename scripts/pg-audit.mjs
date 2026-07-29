/**
 * Shared Postgres helpers for ops audit scripts (cron-audit, ops-collect, validate-deploy).
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadProdSecretsFromAws } from "./audit/lib/prod-secrets.mjs";

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

/** Legacy Railway / pre-AWS-migration URLs still linger in GitHub secrets — ignore them. */
export function isStaleRailwayDbUrl(connectionString) {
  try {
    const u = new URL(connectionString);
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username).toLowerCase();
    return (
      user === "postgres" &&
      (host.includes("railway") || host.includes("proxy.rlwy") || host.includes("rlwy.net"))
    );
  } catch {
    return false;
  }
}

function envAuditDbUrl() {
  for (const key of ["DATABASE_PUBLIC_URL", "DATABASE_URL"]) {
    const url = process.env[key]?.trim();
    if (url && !isStaleRailwayDbUrl(url)) return url;
  }
  return null;
}

/** Prefer AWS Secrets Manager over env — stale GitHub DATABASE_PUBLIC_URL caused P1 auth noise. */
export function auditDbUrl() {
  const secrets = loadProdSecretsFromAws();
  const fromAws =
    secrets.DATABASE_PUBLIC_URL?.trim() || secrets.DATABASE_URL?.trim() || "";
  if (fromAws) return fromAws;
  return envAuditDbUrl();
}

/** Resolve DATABASE_PUBLIC_URL from AWS, env, or legacy Railway variables. */
export function resolveAuditDbUrl() {
  const fromAudit = auditDbUrl();
  if (fromAudit) return fromAudit;

  let dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
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
  const trimmed = dbUrl?.trim() || null;
  if (trimmed && isStaleRailwayDbUrl(trimmed)) return null;
  return trimmed;
}

/** True when Postgres is unreachable from this host (private RDS / cloud agent sandbox). */
export function isPrivateDbUnreachableError(message) {
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout|ECONNREFUSED/i.test(String(message ?? ""));
}

/** True when env still points at a dead Railway URL (auth fails before TCP reset). */
export function isStaleEnvDbAuthError(message) {
  return /password authentication failed for user "postgres"/i.test(String(message ?? ""));
}

export function createAuditClient(connectionString) {
  return new Client({
    connectionString,
    ssl: auditPgSsl(connectionString),
    connectionTimeoutMillis: 10_000,
  });
}
