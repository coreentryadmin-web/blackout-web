"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NighthawkAdminAnalytics } from "@/lib/admin-nighthawk-analytics";
import {
  DataTable,
  DeckPanel,
  EmptyDeck,
  GlassPanel,
  HorzBar,
  MegaStat,
  SectionDeck,
  WinRateRing,
  pct,
} from "@/components/admin/AdminUi";

function ScatterPlot({ points }: { points: NighthawkAdminAnalytics["scatter"] }) {
  const width = 520;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxScore = Math.max(100, ...points.map((p) => p.score), 1);
  const tone = (outcome: string) =>
    outcome === "target" ? "#22c55e" : outcome === "stop" ? "#ef4444" : "#94a3b8";

  if (points.length === 0) {
    return <EmptyDeck title="No resolved plays to plot" hint="Scatter fills after outcomes resolve." />;
  }

  return (
    <div className="admin-nh-scatter-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="admin-nh-scatter" role="img" aria-label="Score vs outcome scatter">
        <line
          x1={pad.left}
          y1={pad.top + plotH}
          x2={pad.left + plotW}
          y2={pad.top + plotH}
          className="admin-nh-scatter-axis"
        />
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + plotH}
          className="admin-nh-scatter-axis"
        />
        <text x={pad.left + plotW / 2} y={height - 4} textAnchor="middle" className="admin-nh-scatter-label">
          Score
        </text>
        {points.map((p, i) => {
          const x = pad.left + (p.score / maxScore) * plotW;
          const y =
            pad.top +
            plotH -
            (p.outcome === "target" ? plotH * 0.85 : p.outcome === "stop" ? plotH * 0.15 : plotH * 0.5);
          return (
            <circle
              key={`${p.edition_for}-${p.ticker}-${i}`}
              cx={x}
              cy={y}
              r={5}
              fill={tone(p.outcome)}
              opacity={0.85}
            >
              <title>
                {p.ticker} · {p.edition_for} · score {p.score} · {p.outcome}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="admin-nh-scatter-legend">
        <span><i className="admin-nh-dot admin-nh-dot-target" /> Target</span>
        <span><i className="admin-nh-dot admin-nh-dot-stop" /> Stop</span>
        <span><i className="admin-nh-dot admin-nh-dot-open" /> Open</span>
      </div>
    </div>
  );
}

export function AdminNightHawkDashboard() {
  const [data, setData] = useState<NighthawkAdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/nighthawk/analytics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as NighthawkAdminAnalytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const convictionRows = useMemo(
    () =>
      (data?.by_conviction ?? []).map((t) => ({
        tier: t.label,
        plays: t.total,
        hits: t.targets,
        rate: pct(t.win_rate),
      })),
    [data]
  );

  if (loading && !data) {
    return <p className="admin-muted">Loading Night Hawk analytics…</p>;
  }

  if (error && !data) {
    return <EmptyDeck title="Night Hawk analytics unavailable" hint={error} />;
  }

  if (!data) return null;

  const { overall } = data;

  return (
    <div className="admin-nh-dashboard">
      <SectionDeck accent="violet">
        <div className="admin-nh-hero">
          <div>
            <p className="admin-deck-kicker">Night Hawk · Win Rate</p>
            <h2 className="admin-deck-heading">Playbook outcome telemetry</h2>
            <p className="admin-muted">
              Last {data.window_days} days · {data.pending_count} plays pending resolution
            </p>
          </div>
          <WinRateRing
            value={overall.win_rate}
            label="Target hit rate"
            sub={`${overall.targets} / ${overall.total} plays`}
            tone="violet"
            size={120}
          />
        </div>

        {data.insights.length > 0 && (
          <GlassPanel title="Insights">
            <ul className="admin-insight-list">
              {data.insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </GlassPanel>
        )}

        <div className="admin-nh-stats-row">
          <MegaStat
            label="Avg return (winners)"
            value={data.avg_return_pct != null ? `${data.avg_return_pct >= 0 ? "+" : ""}${data.avg_return_pct.toFixed(2)}%` : "—"}
            sub="(target − entry) / entry"
            tone={data.avg_return_pct != null && data.avg_return_pct >= 0 ? "bull" : "neutral"}
          />
          <MegaStat label="Resolved plays" value={String(overall.total)} tone="cyan" />
          <MegaStat label="Pending" value={String(data.pending_count)} tone="amber" />
        </div>
      </SectionDeck>

      <div className="admin-nh-grid">
        <DeckPanel title="Win rate by conviction" accent="violet" defaultOpen storageKey="nh-conviction">
          {convictionRows.length === 0 ? (
            <EmptyDeck title="No conviction-tier data yet." />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Plays</th>
                  <th>Targets</th>
                  <th>Hit %</th>
                </tr>
              </thead>
              <tbody>
                {convictionRows.map((row) => (
                  <tr key={row.tier}>
                    <td className="admin-td-strong">{row.tier}</td>
                    <td>{row.plays}</td>
                    <td>{row.hits}</td>
                    <td>{row.rate}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </DeckPanel>

        <DeckPanel title="Win rate by direction" accent="cyan" defaultOpen storageKey="nh-direction">
          {data.by_direction.every((t) => t.total === 0) ? (
            <EmptyDeck title="No directional data yet." />
          ) : (
            <div className="admin-nh-bars">
              {data.by_direction.map((t) => (
                <HorzBar
                  key={t.label}
                  label={t.label}
                  value={t.win_rate}
                  max={1}
                  tone={t.label === "LONG" ? "bull" : "bear"}
                  right={`${t.targets}/${t.total} · ${pct(t.win_rate)}`}
                />
              ))}
            </div>
          )}
        </DeckPanel>

        <DeckPanel title="Win rate by sector" accent="amber" defaultOpen storageKey="nh-sector">
          {data.by_sector.length === 0 ? (
            <EmptyDeck title="No sector data yet" hint="Sector tags populate from dossiers when editions publish." />
          ) : (
            <div className="admin-nh-bars">
              {data.by_sector.slice(0, 12).map((t) => (
                <HorzBar
                  key={t.label}
                  label={t.label}
                  value={t.win_rate}
                  max={1}
                  tone="amber"
                  right={`${t.targets}/${t.total} · ${pct(t.win_rate)}`}
                />
              ))}
            </div>
          )}
        </DeckPanel>

        <DeckPanel title="Score vs outcome" accent="bull" defaultOpen storageKey="nh-scatter">
          <ScatterPlot points={data.scatter} />
          {data.score_buckets.length > 0 && (
            <div className="admin-nh-buckets">
              <p className="admin-deck-kicker">Win rate by score bucket</p>
              {data.score_buckets.map((b) => (
                <HorzBar
                  key={b.bucket}
                  label={b.bucket}
                  value={b.win_rate}
                  max={1}
                  tone="bull"
                  right={`${b.targets}/${b.total} · ${pct(b.win_rate)}`}
                />
              ))}
            </div>
          )}
        </DeckPanel>
      </div>

      {!data.db_configured && (
        <p className="admin-warn">DATABASE_URL not set — outcome analytics require Postgres.</p>
      )}
    </div>
  );
}
