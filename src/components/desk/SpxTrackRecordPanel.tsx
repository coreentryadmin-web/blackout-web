"use client";

import { clsx } from "clsx";
import { useSpxTrackRecord } from "@/hooks/useSpxTrackRecord";
import { Panel, Stat, Skeleton, type StatTone } from "@/components/ui";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function winRateTone(v: number): StatTone {
  return v >= 0.5 ? "bull" : "bear";
}

export function SpxTrackRecordPanel() {
  const { stats, loading } = useSpxTrackRecord();

  if (loading) {
    return (
      <Panel accent="accent" kicker="ALL CLOSED PLAYS" title="Track Record">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={32} rounded="md" />
          ))}
        </div>
      </Panel>
    );
  }

  const empty = !stats || stats.total_closed === 0;
  const overallWr = stats ? stats.overall.win_rate : 0;

  return (
    <Panel
      accent="accent"
      kicker="ALL CLOSED PLAYS"
      title="Track Record"
      actions={
        !empty ? (
          <span
            className={clsx(
              "font-mono text-xs font-bold tabular-nums",
              overallWr >= 0.5 ? "num-bull" : "num-bear"
            )}
          >
            {pct(overallWr)}
          </span>
        ) : undefined
      }
    >
      {empty ? (
        <p className="font-mono text-[11px] text-cyan-400 py-2">
          Track record warming up — no closed plays logged yet
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            compact
            label="Win Rate"
            value={pct(overallWr)}
            tone={winRateTone(overallWr)}
          />
          <Stat
            compact
            label="Record"
            value={
              <>
                {stats!.overall.wins}W / {stats!.overall.losses}L
                {stats!.overall.breakeven > 0 && (
                  <span className="text-sky-300 font-normal"> / {stats!.overall.breakeven}BE</span>
                )}
              </>
            }
          />
          <Stat
            compact
            label="Closed"
            value={stats!.total_closed}
            sublabel="plays"
          />
          <Stat
            compact
            label="History"
            value={Math.round(stats!.days_of_data)}
            sublabel="days"
          />
          {stats!.cold_buy.count > 0 && (
            <Stat
              compact
              label="Cold BUY"
              value={pct(stats!.cold_buy.win_rate)}
              tone={winRateTone(stats!.cold_buy.win_rate)}
              sublabel={`${stats!.cold_buy.count} plays`}
            />
          )}
          {stats!.watch_promote.count > 0 && (
            <Stat
              compact
              label="WATCH→ENTRY"
              value={pct(stats!.watch_promote.win_rate)}
              tone={winRateTone(stats!.watch_promote.win_rate)}
              sublabel={`${stats!.watch_promote.count} plays`}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
