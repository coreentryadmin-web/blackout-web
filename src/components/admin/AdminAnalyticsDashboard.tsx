"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { SpxAdminAnalytics } from "@/lib/admin-spx-analytics";

type ToolTab = "spx" | "nighthawk" | "largo";

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "neutral" | "violet";
}) {
  return (
    <div className={clsx("admin-stat-card", `admin-stat-${tone}`)}>
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value}</p>
      {sub && <p className="admin-stat-sub">{sub}</p>}
    </div>
  );
}

export function AdminAnalyticsDashboard() {
  const [tab, setTab] = useState<ToolTab>("spx");
  const [data, setData] = useState<SpxAdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/analytics/spx", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized" : `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const stats = data?.outcome_stats;

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard-header">
        <div>
          <p className="admin-kicker">Blackout · Internal</p>
          <h1 className="admin-title">Analytics Command</h1>
          <p className="admin-sub">Trade alert performance · desk telemetry · signal quality</p>
        </div>
        <button type="button" onClick={load} className="admin-refresh-btn" disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <nav className="admin-tabs">
        {(
          [
            ["spx", "SPX Sniper"],
            ["nighthawk", "Night Hawk"],
            ["largo", "Largo"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={clsx("admin-tab", tab === id && "admin-tab-active")}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="admin-error">{error}</p>
      )}

      {tab !== "spx" && (
        <div className="admin-coming-soon">
          <h2>{tab === "nighthawk" ? "Night Hawk" : "Largo"} analytics</h2>
          <p>Engine-side outcome logging coming next — same admin shell will host win rate, signal quality, and user engagement once we wire the intel engine.</p>
        </div>
      )}

      {tab === "spx" && (
        <>
          {!data?.db_configured && (
            <p className="admin-warn">DATABASE_URL not set — showing in-memory / empty stats only.</p>
          )}

          {data && (
            <>
              <section className="admin-insights">
                <h2 className="admin-section-title">Insights</h2>
                <ul className="admin-insight-list">
                  {data.insights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>

              <section className="admin-stat-grid">
                <StatCard
                  label="Win rate"
                  value={stats ? pct(stats.overall.win_rate) : "—"}
                  sub={`${stats?.overall.wins ?? 0}W · ${stats?.overall.losses ?? 0}L · ${stats?.overall.breakeven ?? 0}BE`}
                  tone="bull"
                />
                <StatCard
                  label="Closed plays"
                  value={String(stats?.total_closed ?? 0)}
                  sub={`${stats?.days_of_data.toFixed(0) ?? 0} days of data`}
                />
                <StatCard
                  label="Avg PnL"
                  value={`${data.avg_pnl_pts >= 0 ? "+" : ""}${data.avg_pnl_pts.toFixed(1)} pts`}
                  sub={`MFE ${data.avg_mfe_pts.toFixed(1)} · MAE ${data.avg_mae_pts.toFixed(1)}`}
                  tone={data.avg_pnl_pts >= 0 ? "bull" : "bear"}
                />
                <StatCard
                  label="Cold BUY"
                  value={stats ? pct(stats.cold_buy.win_rate) : "—"}
                  sub={`${stats?.cold_buy.count ?? 0} trades`}
                />
                <StatCard
                  label="WATCH→ENTRY"
                  value={stats ? pct(stats.watch_promote.win_rate) : "—"}
                  sub={`${stats?.watch_promote.count ?? 0} trades`}
                  tone="violet"
                />
                <StatCard
                  label="Signals today"
                  value={String(data.signals_today)}
                  sub={`${data.flow_alerts_today} flow alerts ingested`}
                />
              </section>

              {data.adaptive && (
                <section className="admin-panel">
                  <h2 className="admin-section-title">Adaptive gates</h2>
                  <p className="admin-mono text-sm text-grey-300">
                    {data.adaptive.active ? "ACTIVE" : "COLLECTING"} · {data.adaptive.summary}
                  </p>
                  <div className="admin-mini-grid mt-3">
                    <span>Global score boost: +{data.adaptive.global_min_score_boost}</span>
                    <span>Promote boost: +{data.adaptive.promote_min_score_boost}</span>
                    <span>Promote blocked: {data.adaptive.promote_blocked ? "yes" : "no"}</span>
                  </div>
                </section>
              )}

              <div className="admin-two-col">
                <section className="admin-panel">
                  <h2 className="admin-section-title">By grade</h2>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Grade</th>
                        <th>n</th>
                        <th>Win%</th>
                        <th>Avg PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.grade_breakdown.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-grey-500">
                            No closed plays yet
                          </td>
                        </tr>
                      ) : (
                        data.grade_breakdown.map((g) => (
                          <tr key={g.grade}>
                            <td>{g.grade}</td>
                            <td>{g.count}</td>
                            <td className={g.win_rate >= 0.5 ? "text-bull" : "text-bear"}>
                              {pct(g.win_rate)}
                            </td>
                            <td>{g.avg_pnl.toFixed(1)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </section>

                <section className="admin-panel">
                  <h2 className="admin-section-title">Exit reason</h2>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Exit</th>
                        <th>n</th>
                        <th>Avg PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.exit_breakdown.map((e) => (
                        <tr key={e.exit_action}>
                          <td>{e.exit_action}</td>
                          <td>{e.count}</td>
                          <td>{e.avg_pnl.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>

              <section className="admin-panel">
                <h2 className="admin-section-title">Daily rollup (ET)</h2>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Trades</th>
                      <th>W/L</th>
                      <th>Total PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily_rollup.map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td>{d.trades}</td>
                        <td>
                          {d.wins}/{d.losses}
                        </td>
                        <td className={d.total_pnl >= 0 ? "text-bull" : "text-bear"}>
                          {d.total_pnl >= 0 ? "+" : ""}
                          {d.total_pnl.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="admin-panel">
                <h2 className="admin-section-title">Recent closed plays</h2>
                <div className="admin-scroll-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Path</th>
                        <th>Grade</th>
                        <th>Outcome</th>
                        <th>PnL</th>
                        <th>Headline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_outcomes
                        .filter((r) => r.outcome !== "open")
                        .slice(0, 25)
                        .map((r) => (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap">
                              {r.closed_at
                                ? new Date(r.closed_at).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </td>
                            <td>{r.entry_path === "watch_promote" ? "promote" : "cold"}</td>
                            <td>{r.grade}</td>
                            <td
                              className={
                                r.outcome === "win"
                                  ? "text-bull"
                                  : r.outcome === "loss"
                                    ? "text-bear"
                                    : ""
                              }
                            >
                              {r.outcome}
                            </td>
                            <td>
                              {r.pnl_pts != null
                                ? `${r.pnl_pts >= 0 ? "+" : ""}${r.pnl_pts.toFixed(1)}`
                                : "—"}
                            </td>
                            <td className="max-w-[200px] truncate">{r.headline}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="admin-panel">
                <h2 className="admin-section-title">Signal log (30d actions)</h2>
                <div className="admin-mini-grid mb-3">
                  {data.signal_actions_30d.map((s) => (
                    <span key={s.action}>
                      {s.action}: {s.count}
                    </span>
                  ))}
                </div>
                <div className="admin-scroll-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Score</th>
                        <th>Headline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_signals.map((s) => (
                        <tr key={s.id}>
                          <td className="whitespace-nowrap">
                            {new Date(s.created_at).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>{s.action}</td>
                          <td>{s.score}</td>
                          <td className="max-w-[240px] truncate">{s.headline}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
