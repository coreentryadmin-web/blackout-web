"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchNightHawkHorizons } from "@/lib/api";
import type { Horizon } from "@/lib/horizons";
import type { HorizonLaneBoard as HorizonLaneData } from "@/lib/horizon-board";
import type { HorizonPlay } from "@/lib/horizon-plays";

/**
 * A single horizon lane (SWING or LEAPS) of the unified Night Hawk board — the whole desk when its toggle
 * is selected. Fetches /api/market/nighthawk/horizons?view= scoped to this lane and renders its committed
 * plays + watch rail. Whole-market discovery for these lanes is still coming online, so an empty lane shows
 * an honest "scanning" state, never a fabricated play.
 *
 * (0DTE keeps its own rich ZeroDteBoard; this generic lane serves Swing/LEAPS.)
 */
export function HorizonLaneBoard({ horizon }: { horizon: Extract<Horizon, "SWING" | "LEAPS"> }) {
  const { data, isLoading } = useSWR(
    ["nighthawk-horizons", horizon],
    () => fetchNightHawkHorizons(horizon),
    { refreshInterval: 60_000 }
  );

  const lane: HorizonLaneData | null = data?.board?.lanes?.[horizon] ?? null;
  const committed = lane?.committed ?? [];
  const watch = lane?.watch ?? [];

  return (
    <section className="horizon-lane-board flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 md:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">{lane?.label ?? horizon}</h2>
          <span className="text-xs uppercase tracking-wide text-slate-400">{lane?.holdLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
            {committed.length} committed
          </span>
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-slate-400">{watch.length} watch</span>
          {lane && !lane.scoreFloorGraduated && (
            <span
              className="rounded-md bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300"
              title="This lane's commit floor is provisional — not yet graduated on graded evidence."
            >
              floor provisional
            </span>
          )}
        </div>
      </header>

      {isLoading && <LaneMessage>Loading {lane?.label ?? horizon} setups…</LaneMessage>}

      {!isLoading && committed.length === 0 && watch.length === 0 && (
        <LaneMessage>
          Scanning the whole market for {lane?.label ?? horizon} setups — this lane is coming online. Names
          appear here as soon as a liquid contract clears the {lane?.label ?? horizon} floor.
        </LaneMessage>
      )}

      {committed.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {committed.map((p) => (
            <PlayRow key={`c-${p.ticker}-${p.contract.strike}-${p.contract.expiry}`} play={p} committed />
          ))}
        </ul>
      )}

      {watch.length > 0 && (
        <>
          <div className="mt-1 text-[0.7rem] font-medium uppercase tracking-wider text-slate-500">
            Watching (under floor)
          </div>
          <ul className="flex flex-col gap-1.5 opacity-70">
            {watch.map((p) => (
              <PlayRow key={`w-${p.ticker}-${p.contract.strike}-${p.contract.expiry}`} play={p} committed={false} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LaneMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-slate-400">
      {children}
    </p>
  );
}

function PlayRow({ play, committed }: { play: HorizonPlay; committed: boolean }) {
  const long = play.direction === "LONG";
  const c = play.contract;
  const mid = c.mid != null ? `$${c.mid.toFixed(2)}` : "—";
  return (
    <li
      className={clsx(
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2",
        committed ? "border-emerald-500/20 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.02]"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-100">{play.ticker}</span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase",
            long ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
          )}
        >
          {long ? "Long" : "Short"}
        </span>
      </div>
      <div className="min-w-0 truncate text-xs text-slate-400">
        <span className="font-mono text-slate-300">
          {c.strike}
          {c.right} · {c.expiry} · {c.dte}DTE
        </span>
        <span className="ml-2 text-slate-500">{play.reason}</span>
      </div>
      <div className="flex items-center gap-3 text-right">
        <span className="font-mono text-xs text-slate-400">{mid}</span>
        <span
          className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-sm font-semibold text-sky-300"
          title={`Score vs floor ${play.scoreFloor}`}
        >
          {play.score}
        </span>
      </div>
    </li>
  );
}
