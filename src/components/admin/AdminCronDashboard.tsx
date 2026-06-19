"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { CronHealthPayload, CronJobHealth } from "@/lib/admin-cron-health";
import { ActionButton, LivePill, MegaStat } from "@/components/admin/AdminUi";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function statusDot(status: CronJobHealth["status"]) {
  const cls = {
    healthy: "admin-cron-dot-ok",
    warning: "admin-cron-dot-warn",
    stale: "admin-cron-dot-stale",
    failed: "admin-cron-dot-fail",
    unknown: "admin-cron-dot-unknown",
  }[status];
  return <span className={clsx("admin-cron-dot", cls)} />;
}

function statusLabel(status: CronJobHealth["status"]): string {
  return {
    healthy: "HEALTHY",
    warning: "WARNING",
    stale: "STALE",
    failed: "FAILED",
    unknown: "UNKNOWN",
  }[status];
}

function nhJobMeta(job: CronJobHealth): string | null {
  const nh = job.meta?.nighthawk_job as
    | {
        edition_for?: string;
        status?: string;
        current_stage?: string;
        error?: string | null;
      }
    | undefined;
  if (!nh) return null;
  if (nh.error) return `Error: ${nh.error}`;
  if (nh.status && nh.current_stage) return `${nh.status} · ${nh.current_stage}`;
  if (nh.status && nh.edition_for) return `${nh.status} · ${nh.edition_for}`;
  return nh.status ?? null;
}

export function AdminCronDashboard() {
  const [data, setData] = useState<CronHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ageSec, setAgeSec] = useState(0);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/cron-health", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized" : `HTTP ${res.status}`);
      setData(await res.json());
      setAgeSec(0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(), 10_000);
    const tick = setInterval(() => setAgeSec((s) => s + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  if (loading && !data) {
    return <p className="admin-muted">Loading cron health…</p>;
  }

  if (error && !data) {
    return (
      <div className="admin-coming-soon admin-coming-soon-neon">
        <h2 className="admin-deck-heading">Cron health unavailable</h2>
        <p>{error}</p>
        <ActionButton variant="primary" onClick={() => load()}>
          Retry
        </ActionButton>
      </div>
    );
  }

  if (!data) return null;

  const healthyPct = data.summary.total
    ? data.summary.healthy / data.summary.total
    : 0;

  return (
    <div className="admin-cron-dashboard">
      <div className="admin-cron-hero">
        <div>
          <p className="admin-kicker">Operations</p>
          <h2 className="admin-deck-heading">Cron job health</h2>
          <p className="admin-muted">
            Refreshed {ageSec}s ago · auto-poll every 10s
            {data.generated_at ? ` · snapshot ${fmtTime(data.generated_at)} ET` : ""}
          </p>
        </div>
        <div className="admin-cron-hero-chips">
          <LivePill label={refreshing ? "SYNC" : "LIVE"} active={!refreshing} />
          <ActionButton variant="default" onClick={() => load(true)}>
            Refresh now
          </ActionButton>
          <span className="admin-cron-chip">
            DB {data.db_configured ? "OK" : "MISSING"}
          </span>
          <span className="admin-cron-chip">
            SECRET {data.cron_secret_configured ? "OK" : "MISSING"}
          </span>
          <span className="admin-cron-chip">LOGGED {data.logged_runs_total}</span>
          {!data.cron_secret_configured && (
            <span className="admin-cron-chip admin-cron-chip-warn">CRON_SECRET not set</span>
          )}
          {!data.db_configured && (
            <span className="admin-cron-chip admin-cron-chip-warn">DATABASE_URL missing</span>
          )}
        </div>
      </div>

      {data.diagnostics_note && (
        <div className="admin-cron-diagnostics">
          <p>{data.diagnostics_note}</p>
        </div>
      )}

      <div className="admin-cron-stats">
        <MegaStat
          label="Healthy"
          value={`${data.summary.healthy}/${data.summary.total}`}
          sub={`${Math.round(healthyPct * 100)}% passing`}
          tone={data.summary.failed > 0 ? "bear" : data.summary.stale > 0 ? "amber" : "bull"}
          bar={healthyPct * 100}
        />
        <MegaStat
          label="Stale"
          value={String(data.summary.stale)}
          sub="Past expected interval"
          tone={data.summary.stale > 0 ? "amber" : "neutral"}
        />
        <MegaStat
          label="Failed"
          value={String(data.summary.failed)}
          sub="Last run errored"
          tone={data.summary.failed > 0 ? "bear" : "neutral"}
        />
        <MegaStat
          label="Unknown"
          value={String(data.summary.unknown)}
          sub={data.logged_runs_total === 0 ? "Awaiting first logged run" : "No cron log row yet"}
          tone={data.summary.unknown > 0 ? "violet" : "neutral"}
        />
      </div>

      <div className="admin-cron-table-wrap">
        <table className="admin-cron-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Job</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>Duration</th>
              <th>24h OK / fail / skip</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => (
              <tr key={job.key} className={clsx("admin-cron-row", `admin-cron-row-${job.status}`)}>
                <td>
                  <div className="admin-cron-status-cell">
                    {statusDot(job.status)}
                    <span>{statusLabel(job.status)}</span>
                  </div>
                </td>
                <td>
                  <p className="admin-cron-job-name">{job.name}</p>
                  <p className="admin-cron-job-meta">
                    {job.kind === "http" ? job.path : "Railway worker"}
                    {" · "}
                    {job.description}
                  </p>
                </td>
                <td>{job.schedule_label}</td>
                <td>
                  <span>{fmtTime(job.last_run_at)}</span>
                  {job.age_min != null && (
                    <span className="admin-cron-age">{job.age_min}m ago</span>
                  )}
                </td>
                <td>{fmtDuration(job.last_duration_ms)}</td>
                <td>
                  <span className="admin-cron-count-ok">{job.runs_24h.ok}</span>
                  {" / "}
                  <span className="admin-cron-count-fail">{job.runs_24h.failed}</span>
                  {" / "}
                  <span className="admin-cron-count-skip">{job.runs_24h.skipped}</span>
                </td>
                <td>
                  <span className="admin-cron-detail">{job.status_label}</span>
                  {nhJobMeta(job) && (
                    <span className="admin-cron-detail-sub">{nhJobMeta(job)}</span>
                  )}
                  {job.last_message && job.last_message !== job.status_label && (
                    <span className="admin-cron-detail-sub">{job.last_message}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-cron-events">
        <h3 className="admin-cron-events-title">Recent runs</h3>
        <ul className="admin-cron-event-list">
          {data.recent_events.map((ev, i) => (
            <li key={`${ev.job_key}-${ev.started_at}-${i}`} className="admin-cron-event">
              {statusDot(
                ev.status === "ok"
                  ? "healthy"
                  : ev.status === "failed"
                    ? "failed"
                    : ev.status === "skipped"
                      ? "warning"
                      : "unknown"
              )}
              <span className="admin-cron-event-name">{ev.job_name}</span>
              <span className="admin-cron-event-time">{fmtTime(ev.started_at)}</span>
              <span className="admin-cron-event-msg">{ev.message ?? ev.status}</span>
              <span className="admin-cron-event-dur">{fmtDuration(ev.duration_ms)}</span>
            </li>
          ))}
          {!data.recent_events.length && (
            <li className="admin-cron-event admin-cron-event-empty">
              {data.diagnostics_note ??
                "No cron runs logged yet — they appear when HTTP crons hit blackout-web or the Night Hawk worker finishes."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
