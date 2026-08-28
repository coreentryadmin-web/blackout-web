import { aiSpendKillSwitchUsd, aiSpendAlertThresholdUsd } from "@/lib/ai-spend-ledger";

export type OpsConfigStatus = {
  ai_spend_kill_switch_armed: boolean;
  ai_spend_kill_usd: number | null;
  ai_spend_alert_usd: number;
  discord_ops_webhook: boolean;
  discord_play_webhook: boolean;
  /** Thermal triple-desk PNG cron (`DISCORD_THERMAL_WEBHOOK_URL`). */
  discord_thermal_webhook: boolean;
  /** HELIX community flow embeds (`DISCORD_HELIX_WEBHOOK_URL`). */
  discord_helix_webhook: boolean;
  helix_discord_alerts_enabled: boolean;
  pg_pool_max: number;
  database_via_pooler: boolean;
  pg_pooler_hint: string;
};

/**
 * Recognizes a pooled DB host from `DATABASE_URL` alone (no network call). Two eras of hostname
 * patterns matter here: the Railway-era PgBouncer patterns (`proxy.rlwy`, `-pool.`, `pooler`,
 * `pgbouncer`) predate the 2026-07 migration to Amazon RDS + RDS Proxy — see
 * docs/PGBOUNCER-SETUP.md's deprecation note — and were never updated to recognize an RDS Proxy
 * endpoint, which follows AWS's own fixed shape `<proxy-name>.proxy-<id>.<region>.rds.amazonaws.com`
 * (confirmed live: `blackout-production-proxy.proxy-c89mwake2by8.us-east-1.rds.amazonaws.com`).
 * Without this, the admin health panel reported `database_via_pooler: false` with a "enable
 * PgBouncer" hint even though RDS Proxy was already correctly wired — a false negative on a
 * connection-pooling posture indicator pointing at a deprecated runbook.
 */
export function isPooledDbHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower.includes("pgbouncer") ||
    lower.includes("pooler") ||
    lower.includes("proxy.rlwy") ||
    lower.includes("-pool.") ||
    (lower.includes(".proxy-") && lower.endsWith(".rds.amazonaws.com"))
  );
}

function databaseViaPooler(): { viaPooler: boolean; hint: string } {
  const raw =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    process.env.DATABASE_PUBLIC_URL?.trim() ||
    "";
  if (!raw) {
    return { viaPooler: false, hint: "DATABASE_URL unset" };
  }
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const viaPooler = isPooledDbHost(host);
    return {
      viaPooler,
      hint: viaPooler
        ? `pooler host (${host})`
        : `direct Postgres host (${host}) — enable RDS Proxy or PgBouncer (docs/PGBOUNCER-SETUP.md is the deprecated Railway-era version)`,
    };
  } catch {
    return { viaPooler: false, hint: "DATABASE_URL not parseable" };
  }
}

/** Non-secret ops guardrail posture for admin dashboard (audit R-2/R-6/R-18). */
export function buildOpsConfigStatus(): OpsConfigStatus {
  const kill = aiSpendKillSwitchUsd();
  const pool = databaseViaPooler();
  const pgMax = Number(process.env.PG_POOL_MAX ?? "5");
  return {
    ai_spend_kill_switch_armed: kill != null,
    ai_spend_kill_usd: kill,
    ai_spend_alert_usd: aiSpendAlertThresholdUsd(),
    discord_ops_webhook: Boolean(process.env.DISCORD_OPS_WEBHOOK_URL?.trim()),
    discord_play_webhook: Boolean(process.env.DISCORD_PLAY_WEBHOOK_URL?.trim()),
    discord_thermal_webhook: Boolean(process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim()),
    discord_helix_webhook: Boolean(process.env.DISCORD_HELIX_WEBHOOK_URL?.trim()),
    helix_discord_alerts_enabled: Boolean(
      ["1", "true", "yes"].includes(process.env.HELIX_DISCORD_ALERTS?.trim().toLowerCase() ?? "")
    ),
    pg_pool_max: Number.isFinite(pgMax) && pgMax > 0 ? pgMax : 5,
    database_via_pooler: pool.viaPooler,
    pg_pooler_hint: pool.hint,
  };
}
