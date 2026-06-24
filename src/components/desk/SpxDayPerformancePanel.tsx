"use client";

import { clsx } from "clsx";
import { useSpxDayPerformance } from "@/hooks/useSpxDayPerformance";
import { Panel, Stat, Skeleton } from "@/components/ui";

export function SpxDayPerformancePanel() {
  const { stats, loading } = useSpxDayPerformance();

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  if (loading) {
    return (
      <Panel accent="sky" kicker={`${today} · P&L`} title="Today">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={32} rounded="md" />
          ))}
        </div>
      </Panel>
    );
  }

  const noPlays = !stats || stats.plays === 0;

  return (
    <Panel
      accent="sky"
      kicker={`${today} · P&L`}
      title="Today"
      actions={
        stats && stats.plays > 0 ? (
          <span
            className={clsx(
              "font-mono text-xs font-bold tabular-nums",
              stats.net_pts >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {stats.net_pts >= 0 ? "+" : ""}
            {stats.net_pts} pts
          </span>
        ) : undefined
      }
    >
      {noPlays ? (
        <p className="font-mono text-[11px] text-cyan-400 py-2">No closed plays yet today</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            compact
            label="Plays"
            value={
              <>
                {stats!.wins}W / {stats!.losses}L
                {stats!.breakeven > 0 && (
                  <span className="text-cyan-400 font-normal"> / {stats!.breakeven}BE</span>
                )}
              </>
            }
          />
          <Stat
            compact
            label="Win Rate"
            value={stats!.win_rate != null ? `${Math.round(stats!.win_rate * 100)}%` : "—"}
            tone={
              stats!.win_rate == null ? "accent" : stats!.win_rate >= 0.5 ? "bull" : "bear"
            }
          />
          <Stat
            compact
            label="Avg Win"
            value={stats!.avg_win_pts != null ? `+${stats!.avg_win_pts}` : "—"}
            tone="bull"
          />
          <Stat
            compact
            label="Avg Loss"
            value={stats!.avg_loss_pts != null ? `${stats!.avg_loss_pts}` : "—"}
            tone="bear"
          />
        </div>
      )}
    </Panel>
  );
}
