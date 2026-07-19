"use client";

import { clsx } from "clsx";
import { useAdminHealth, useAdminCronHealth } from "@/hooks/use-admin-data";

type AdminHealthBannerProps = {
  /** Compact strip for the v2 admin top bar. */
  compact?: boolean;
};

export function AdminHealthBanner({ compact = false }: AdminHealthBannerProps) {
  const { data: health, error: healthError } = useAdminHealth();
  const { data: cron } = useAdminCronHealth();

  if (healthError && !health) {
    const body = (
      <>
        <span className={compact ? "admin-v2-status-label" : "admin-health-banner-label"}>System</span>
        <span className={compact ? "admin-v2-status-value" : "admin-health-banner-value"}>
          Health unavailable
        </span>
      </>
    );
    if (compact) {
      return <div className="admin-v2-status admin-v2-status-warn">{body}</div>;
    }
    return <div className="admin-health-banner admin-health-banner-warn">{body}</div>;
  }

  if (!health) return null;

  const rthStale = cron?.summary.market_hours_stale ?? 0;
  const hasCritical = health.counts.critical > 0 || rthStale > 0;
  const tone = hasCritical ? "critical" : health.counts.warning > 0 ? "warn" : "ok";
  const label = hasCritical ? "Degraded" : health.counts.warning > 0 ? "Caution" : "OK";

  if (compact) {
    return (
      <div className={clsx("admin-v2-status", `admin-v2-status-${tone}`)}>
        <span className="admin-v2-status-label">System</span>
        <span className="admin-v2-status-value">{label}</span>
        {rthStale > 0 && (
          <span className="admin-v2-status-chip admin-v2-status-chip-critical">
            {rthStale} cron stale (RTH)
          </span>
        )}
        {health.counts.critical > 0 && (
          <span className="admin-v2-status-chip admin-v2-status-chip-critical">
            {health.counts.critical} critical
          </span>
        )}
        {health.counts.warning > 0 && (
          <span className="admin-v2-status-chip admin-v2-status-chip-warn">
            {health.counts.warning} warning
          </span>
        )}
        {health.counts.api_errors > 0 && (
          <span className="admin-v2-status-chip">{health.counts.api_errors} API err</span>
        )}
        {health.route_errors.length > 0 && (
          <span className="admin-v2-status-chip admin-v2-status-chip-warn">
            {health.route_errors.length} route err
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("admin-health-banner", `admin-health-banner-${tone}`)}>
      <span className="admin-health-banner-label">SYSTEM</span>
      <span className="admin-health-banner-value">{label.toUpperCase()}</span>
      {rthStale > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-critical">
          {rthStale} CRON STALE (RTH)
        </span>
      )}
      {health.counts.critical > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-critical">
          {health.counts.critical} CRITICAL
        </span>
      )}
      {health.counts.warning > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-warn">
          {health.counts.warning} WARNING
        </span>
      )}
      {health.counts.api_errors > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-api">
          {health.counts.api_errors} API ERR
        </span>
      )}
      {health.route_errors.length > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-warn">
          {health.route_errors.length} ROUTE ERR
        </span>
      )}
    </div>
  );
}
