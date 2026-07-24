"use client";

import useSWR from "swr";
import { CommandDeck } from "./CommandDeck";
import {
  terminalPlayFromZeroDte,
  terminalPlayFromHorizon,
  terminalPlayFromEdition,
  type ZeroDteDeckSource,
} from "./adapters";
import { fetchNightHawkHorizons } from "@/lib/api";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import type { TerminalPlay } from "./types";
import { useZeroDteLiveMarks, overlayLiveMarks } from "./use-live-marks";
import { zeroDteSources, isBoardDegraded, type BoardResp } from "./zerodte-sources";

const json = (u: string) => fetch(u, { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));

// ── 0DTE: the live board (setups ⋈ ledger ⋈ allocation) ────────────────────────────
// Source-derivation lives in the pure ./zerodte-sources module (unit-tested).

export function ZeroDteDeck() {
  const { data } = useSWR<BoardResp>("/api/market/zerodte/board", json, { refreshInterval: 5_000 });
  const liveMarks = useZeroDteLiveMarks();
  const plays: TerminalPlay[] = overlayLiveMarks(
    zeroDteSources(data ?? null).map(terminalPlayFromZeroDte),
    liveMarks,
  );
  // 9-3: a degraded/unavailable board must NOT be painted as a calm "no setup cleared the floor" flat tape
  // — that hides a real outage AND any open position. (isBoardDegraded treats first-load null as not-degraded.)
  const degraded = isBoardDegraded(data);
  return (
    <CommandDeck
      plays={plays}
      laneLabel="0DTE · same-day"
      degraded={degraded}
      emptyHint={
        degraded
          ? "Board data unavailable right now — retrying. Any open position is still live; this is a data outage, not a flat tape."
          : "Scanning the whole market — no 0DTE setup has cleared the floor right now."
      }
    />
  );
}

// ── Swings / LEAPS: the horizon lane ────────────────────────────────────────────────

export function HorizonDeck({ horizon }: { horizon: "SWING" | "LEAPS" }) {
  const { data } = useSWR(["deck-horizons", horizon], () => fetchNightHawkHorizons(horizon), { refreshInterval: 30_000 });
  const lane = data?.board?.lanes?.[horizon];
  const rows = [...(lane?.committed ?? []), ...(lane?.watch ?? [])];
  const plays: TerminalPlay[] = rows.map((p) =>
    terminalPlayFromHorizon({
      ticker: p.ticker,
      direction: p.direction,
      horizon,
      score: p.score,
      status: p.status,
      reason: p.reason,
      contract: { strike: p.contract.strike, right: p.contract.right, expiry: p.contract.expiry, dte: p.contract.dte, mid: p.contract.mid },
    }),
  );
  return (
    <CommandDeck
      plays={plays}
      laneLabel={horizon === "SWING" ? "Swings · 2–30 DTE" : "LEAPS · ≤90 DTE"}
      emptyHint={`Scanning the whole market for ${horizon === "SWING" ? "Swing" : "LEAPS"} setups — this lane is coming online.`}
    />
  );
}

// ── Legacy: the evening edition ─────────────────────────────────────────────────────

export function LegacyDeck({ edition }: { edition: NightHawkEdition | undefined }) {
  const plays: TerminalPlay[] = (edition?.plays ?? []).slice(0, 5).map((p, i) =>
    terminalPlayFromEdition({
      ticker: p.ticker,
      direction: (p as { direction?: string }).direction,
      rank: (p as { rank?: number }).rank ?? i + 1,
      score: (p as { score?: number }).score,
      factor_breakdown: (p as { factor_breakdown?: Record<string, number> }).factor_breakdown ?? null,
    }),
  );
  return (
    <CommandDeck
      plays={plays}
      laneLabel="Legacy · Tonight's playbook"
      emptyHint="Five ranked setups land here after the evening scan · ~5:30 PM ET."
    />
  );
}
