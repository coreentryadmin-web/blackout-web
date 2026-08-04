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
  // `lane.committed` is a back-compat, score-only view (status === "COMMIT") that predates the seven-
  // section swing router (serving.ts) — it does NOT know a setup's thesis broke after the score cleared
  // the floor. A SWING play whose setupState has since gone INVALIDATED must never render as "committed"
  // here (see docs/audit/FINDINGS.md 2026-08-04: prod observed a COMMIT-status play with
  // setupState: "INVALIDATED" — the real desk (HorizonDeck/containers.tsx) already guards this via
  // `sections`; this generic lane predates that and had no equivalent guard).
  const committed = (lane?.committed ?? []).filter((p) => p.setupState !== "INVALIDATED");
  const watch = lane?.watch ?? [];

  return (
    <section className="horizon-lane-board flex flex-col gap-3 rounded-xl border border-sky-300/25 bg-sky-950/40 p-3 md:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-extrabold tracking-tight text-white">{lane?.label ?? horizon}</h2>
          <span className="text-xs font-bold uppercase tracking-wide text-sky-300">{lane?.holdLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="rounded-md bg-bull/15 px-2 py-0.5 font-bold text-bull">
            {committed.length} committed
          </span>
          <span className="rounded-md border border-sky-300/30 bg-sky-400/10 px-2 py-0.5 text-sky-200">
            {watch.length} watch
          </span>
          {lane && !lane.scoreFloorGraduated && (
            <span
              className="rounded-md bg-gold/[0.10] px-2 py-0.5 font-bold text-gold"
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
          <div className="mt-1 text-[0.75rem] font-extrabold uppercase tracking-wider text-sky-300">
            Watching (under floor)
          </div>
          <ul className="flex flex-col gap-1.5">
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
    <p className="rounded-lg border border-dashed border-sky-300/25 bg-sky-950/30 px-3 py-6 text-center text-sm font-semibold text-sky-200">
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
        committed ? "border-bull/25 bg-bull/[0.08]" : "border-sky-300/20 bg-sky-950/30"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-extrabold text-white">{play.ticker}</span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[0.65rem] font-extrabold uppercase",
            long ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
          )}
        >
          {long ? "Long" : "Short"}
        </span>
      </div>
      <div className="min-w-0 truncate text-xs font-semibold text-sky-200">
        <span className="font-mono text-sky-100">
          {c.strike}
          {c.right} · {c.expiry} · {c.dte}DTE
        </span>
        <span className="ml-2 text-sky-300">{play.reason}</span>
      </div>
      <div className="flex items-center gap-3 text-right">
        <span className="font-mono text-xs font-bold text-sky-200">{mid}</span>
        <span
          className="rounded-md border border-sky-300/30 bg-sky-400/10 px-2 py-0.5 font-mono text-sm font-extrabold text-sky-100"
          title={`Score vs floor ${play.scoreFloor}`}
        >
          {play.score}
        </span>
      </div>
    </li>
  );
}
