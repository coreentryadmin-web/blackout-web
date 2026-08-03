import type { DeckSessionHeatState } from "./deck-session-ui";
import { isZeroDteSessionActive } from "./deck-session-ui";

export type EngineStatusMode = "monitoring" | "idle" | "offline" | "syncing";

export type EngineStatusDisplay = {
  mode: EngineStatusMode;
  /** Member-facing mode label — never names vendors or infra. */
  label: string;
  /** Green check when the engine loop is healthy. */
  ok: boolean;
  lastUpdateIso: string | null;
  lastUpdateAge: string | null;
};

/** Human age for the board snapshot — "2 sec ago" during live RTH polling. */
export function formatEngineUpdateAge(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso || !(nowMs > 0)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const sec = Math.floor((nowMs - at) / 1000);
  if (sec < 0) return "just now";
  if (sec <= 1) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function deriveEngineStatus(opts: {
  degraded: boolean;
  loading: boolean;
  sessionHeat?: DeckSessionHeatState;
  boardAsOf?: string | null;
  nowMs: number;
  etMinutes?: number;
  upstreamOk?: boolean | null;
}): EngineStatusDisplay {
  const lastUpdateIso =
    opts.boardAsOf && Number.isFinite(Date.parse(opts.boardAsOf)) ? opts.boardAsOf : null;
  const lastUpdateAge = formatEngineUpdateAge(lastUpdateIso, opts.nowMs);

  if (opts.degraded || opts.upstreamOk === false) {
    return {
      mode: "offline",
      label: "Offline",
      ok: false,
      lastUpdateIso,
      lastUpdateAge,
    };
  }

  if (opts.loading && !lastUpdateIso) {
    return {
      mode: "syncing",
      label: "Syncing",
      ok: false,
      lastUpdateIso,
      lastUpdateAge,
    };
  }

  const sessionLive = isZeroDteSessionActive(opts.sessionHeat, opts.etMinutes);
  if (!sessionLive) {
    return {
      mode: "idle",
      label: "Standby",
      ok: true,
      lastUpdateIso,
      lastUpdateAge,
    };
  }

  return {
    mode: "monitoring",
    label: "Monitoring",
    ok: true,
    lastUpdateIso,
    lastUpdateAge,
  };
}
