"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { formatDataAge, type IntelligenceStatus } from "@/lib/largo/core/system-status";

/**
 * INTELLIGENCE STRIP — the thin line under LARGO TERMINAL that says "wired into the machine".
 *
 * It only says that if it is TRUE. Every dot is derived from that system's own production reader,
 * so a lane that is broken for the desk is dark here too. The moment a member sees a green dot
 * during an outage the entire surface becomes decoration, and decoration is worse than nothing:
 * it teaches people to ignore the one row that would have warned them.
 *
 * Three states, and the middle one is the reason the component exists:
 *   live      — real data came back
 *   degraded  — the system answered with nothing in it (cold cache, pre-open, an empty lane)
 *   down      — the read failed
 * Amber for degraded is not decoration either: pre-open it is the honest colour of the desk.
 *
 * RENDERS NOTHING UNTIL IT HAS REAL DATA. No skeleton, no optimistic dots. A strip that shows
 * six green dots while loading and then corrects itself has already told the lie.
 */
const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

export function LargoStatusStrip() {
  const { data } = useSWR<IntelligenceStatus | null>("/api/market/largo/status", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (!data || !Array.isArray(data.systems)) return null;

  const anyDown = data.systems.some((s) => s.health === "down");

  return (
    <div className="largo-status-strip" role="status" aria-live="polite">
      <span className={clsx("largo-status-pill", anyDown && "largo-status-pill-warn")}>
        <span className="largo-status-dot" aria-hidden />
        {anyDown ? "DEGRADED" : "LIVE"}
      </span>

      <span className="largo-status-sep" aria-hidden />
      <span className="largo-status-meta">{data.marketPhase}</span>
      <span className="largo-status-sep" aria-hidden />
      <span className="largo-status-meta">DATA {formatDataAge(data.dataAgeSec)} AGO</span>

      <span className="largo-status-systems">
        {data.systems.map((s) => (
          <span
            key={s.id}
            className={clsx("largo-status-system", `largo-status-${s.health}`)}
            // The dot alone is not an accessible signal, and "HELIX" beside a colour nobody can
            // distinguish is not either. The title states the health in words.
            title={`${s.id}: ${s.health}`}
          >
            <span className="largo-status-system-dot" aria-hidden />
            {s.id}
            <span className="sr-only"> {s.health}</span>
          </span>
        ))}
      </span>

      <span className="largo-status-counts">
        <strong>{data.systemsOnline}</strong>/{data.systemsTotal} ONLINE
        <span className="largo-status-sep" aria-hidden />
        <strong>{data.activeSignals}</strong> ACTIVE SIGNALS
      </span>
    </div>
  );
}
