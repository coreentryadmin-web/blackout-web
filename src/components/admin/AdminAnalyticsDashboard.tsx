"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { AdminApiDashboard } from "@/components/admin/AdminApiDashboard";
import { AdminSpxDashboard } from "@/components/admin/AdminSpxDashboard";
import { ActionButton, LivePill, MegaStat, WinRateRing } from "@/components/admin/AdminUi";
import type { SpxAdminAnalytics } from "@/lib/admin-spx-analytics";

type ToolTab = "spx" | "nighthawk" | "largo" | "apis";

const TABS: Array<{ id: ToolTab; label: string; icon: string; blurb: string }> = [
  { id: "spx", label: "SPX Sniper", icon: "◎", blurb: "Live engine · outcomes · desk" },
  { id: "apis", label: "API Grid", icon: "⬡", blurb: "Providers · latency · errors" },
  { id: "nighthawk", label: "Night Hawk", icon: "◈", blurb: "Coming soon" },
  { id: "largo", label: "Largo", icon: "◆", blurb: "Coming soon" },
];

export function AdminAnalyticsDashboard() {
  const [tab, setTab] = useState<ToolTab>("spx");
  const [stats, setStats] = useState<SpxAdminAnalytics | null>(null);
  const [clock, setClock] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics/spx", { cache: "no-store" });
      if (res.ok) setStats(await res.json());
    } catch {
      // hero degrades gracefully
    }
  }, []);

  useEffect(() => {
    loadStats();
    const id = setInterval(loadStats, 60_000);
    return () => clearInterval(id);
  }, [loadStats]);

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const wr = stats?.outcome_stats.overall.win_rate ?? 0;
  const cold = stats?.outcome_stats.cold_buy.win_rate ?? 0;
  const promote = stats?.outcome_stats.watch_promote.win_rate ?? 0;

  return (
    <div className="admin-dashboard">
      <div className="admin-mesh" aria-hidden>
        <div className="admin-mesh-orb admin-mesh-orb-a" />
        <div className="admin-mesh-orb admin-mesh-orb-b" />
        <div className="admin-mesh-orb admin-mesh-orb-c" />
        <div className="admin-mesh-grid" />
      </div>

      <header className="admin-command-hero">
        <div className="admin-command-hero-left">
          <p className="admin-kicker admin-kicker-glow">Blackout · Command Deck</p>
          <h1 className="admin-title admin-title-xl">
            Analytics <span className="admin-title-accent">War Room</span>
          </h1>
          <p className="admin-sub admin-sub-hero">
            Real-time desk telemetry · play outcomes · API health · adaptive gates
          </p>
          <div className="admin-hero-chips">
            <LivePill label={`ET ${clock}`} />
            <span className="admin-hero-chip">Signals today {stats?.signals_today ?? "—"}</span>
            <span className="admin-hero-chip">Flow alerts {stats?.flow_alerts_today ?? "—"}</span>
          </div>
        </div>

        <div className="admin-command-rings">
          <WinRateRing
            value={wr}
            label="Win rate"
            sub={`${stats?.outcome_stats.overall.wins ?? 0}W · ${stats?.outcome_stats.overall.losses ?? 0}L`}
            tone="bull"
          />
          <WinRateRing
            value={cold}
            label="Cold BUY"
            sub={`${stats?.outcome_stats.cold_buy.count ?? 0} trades`}
            tone="cyan"
            size={100}
          />
          <WinRateRing
            value={promote}
            label="Promote"
            sub={`${stats?.outcome_stats.watch_promote.count ?? 0} trades`}
            tone="violet"
            size={100}
          />
        </div>
      </header>

      <section className="admin-mega-grid">
        <MegaStat
          label="Closed plays"
          value={String(stats?.outcome_stats.total_closed ?? 0)}
          sub={`${stats?.outcome_stats.days_of_data.toFixed(0) ?? 0} days logged`}
          tone="neutral"
        />
        <MegaStat
          label="Avg PnL"
          value={`${(stats?.avg_pnl_pts ?? 0) >= 0 ? "+" : ""}${(stats?.avg_pnl_pts ?? 0).toFixed(1)} pts`}
          sub={`MFE ${(stats?.avg_mfe_pts ?? 0).toFixed(1)} · MAE ${(stats?.avg_mae_pts ?? 0).toFixed(1)}`}
          tone={(stats?.avg_pnl_pts ?? 0) >= 0 ? "bull" : "bear"}
          trend={(stats?.avg_pnl_pts ?? 0) >= 0 ? "up" : "down"}
        />
        <MegaStat
          label="Open outcomes"
          value={String(stats?.open_outcomes ?? 0)}
          sub="Active in DB"
          tone="amber"
        />
        <MegaStat
          label="Adaptive gates"
          value={stats?.adaptive?.active ? "LIVE" : "COLLECT"}
          sub={stats?.adaptive?.summary?.slice(0, 48) ?? "Building sample"}
          tone="violet"
          bar={stats?.adaptive?.active ? 100 : Math.min(100, ((stats?.outcome_stats.total_closed ?? 0) / 8) * 100)}
        />
      </section>

      <nav className="admin-tabs admin-tabs-neon">
        {TABS.map(({ id, label, icon, blurb }) => (
          <button
            key={id}
            type="button"
            className={clsx("admin-tab admin-tab-neon", tab === id && "admin-tab-active")}
            onClick={() => setTab(id)}
          >
            <span className="admin-tab-icon">{icon}</span>
            <span className="admin-tab-text">
              <span className="admin-tab-label">{label}</span>
              <span className="admin-tab-blurb">{blurb}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="admin-tab-panel" key={tab}>
        {tab === "spx" && <AdminSpxDashboard />}
        {tab === "apis" && <AdminApiDashboard />}
        {tab !== "spx" && tab !== "apis" && (
          <div className="admin-coming-soon admin-coming-soon-neon">
            <p className="admin-kicker">{tab === "nighthawk" ? "Night Hawk" : "Largo"}</p>
            <h2>Intel engine analytics incoming</h2>
            <p>Win rate, signal quality, and engagement telemetry will land in this slot next.</p>
            <ActionButton variant="primary" onClick={() => setTab("spx")}>
              Back to SPX Command
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
