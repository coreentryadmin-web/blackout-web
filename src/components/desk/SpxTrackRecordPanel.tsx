"use client";

import { clsx } from "clsx";
import { useSpxTrackRecord } from "@/hooks/useSpxTrackRecord";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function winRateTone(v: number): string {
  return v >= 0.5 ? "num-bull" : "num-bear";
}

export function SpxTrackRecordPanel() {
  const { stats, loading } = useSpxTrackRecord();

  if (loading) {
    return (
      <div className="spx-desk-panel spx-panel-cyan animate-pulse">
        <div className="spx-desk-panel-header">
          <span className="badge-live-dot" />
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">Track Record</p>
        </div>
        <div className="spx-desk-panel-body">
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 bg-neutral-700/50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const empty = !stats || stats.total_closed === 0;
  const overallWr = stats ? stats.overall.win_rate : 0;

  return (
    <div className="spx-desk-panel spx-panel-cyan">
      <div className="spx-desk-panel-header">
        <span className="badge-live-dot" />
        <div>
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">Track Record</p>
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-cyan-400 mt-0.5">
            All closed plays
          </p>
        </div>
        {!empty && (
          <span className={clsx("ml-auto font-mono text-xs font-bold tabular-nums", winRateTone(overallWr))}>
            {pct(overallWr)}
          </span>
        )}
      </div>

      <div className="spx-desk-panel-body">
        {empty ? (
          <p className="font-mono text-[11px] text-cyan-400 py-2">
            No closed plays logged yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Win Rate
              </div>
              <div className={clsx("font-syne font-bold tabular-nums", winRateTone(overallWr))}>
                {pct(overallWr)}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Record
              </div>
              <div className="font-syne font-bold text-white">
                {stats!.overall.wins}W / {stats!.overall.losses}L
                {stats!.overall.breakeven > 0 && (
                  <span className="text-sky-300 font-normal"> / {stats!.overall.breakeven}BE</span>
                )}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Closed
              </div>
              <div className="font-syne font-bold text-white tabular-nums">
                {stats!.total_closed}
                <span className="text-sky-300 font-normal"> plays</span>
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                History
              </div>
              <div className="font-syne font-bold text-white tabular-nums">
                {Math.round(stats!.days_of_data)}
                <span className="text-sky-300 font-normal"> days</span>
              </div>
            </div>

            {stats!.cold_buy.count > 0 && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                  Cold BUY
                </div>
                <div className={clsx("font-syne font-bold tabular-nums", winRateTone(stats!.cold_buy.win_rate))}>
                  {pct(stats!.cold_buy.win_rate)}
                  <span className="text-sky-300 font-normal text-[10px]"> · {stats!.cold_buy.count}</span>
                </div>
              </div>
            )}

            {stats!.watch_promote.count > 0 && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                  WATCH→ENTRY
                </div>
                <div className={clsx("font-syne font-bold tabular-nums", winRateTone(stats!.watch_promote.win_rate))}>
                  {pct(stats!.watch_promote.win_rate)}
                  <span className="text-sky-300 font-normal text-[10px]"> · {stats!.watch_promote.count}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
