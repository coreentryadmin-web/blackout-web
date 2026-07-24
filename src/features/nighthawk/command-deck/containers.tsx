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

const json = (u: string) => fetch(u, { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));

// ── 0DTE: the live board (setups ⋈ ledger ⋈ allocation) ────────────────────────────

interface BoardResp {
  setups?: Array<Record<string, unknown>>;
  ledger?: Array<Record<string, unknown>>;
  allocation?: Array<{ ticker: string; role: string; sizing: string; reasons?: string[] }>;
}

/** Merge the board payload into deck sources: each ranked setup enriched with its ledger row (status/pnl/
 *  marks) + its allocation decision, keyed by ticker. */
function zeroDteSources(resp: BoardResp | null): ZeroDteDeckSource[] {
  if (!resp) return [];
  const ledgerByTk = new Map<string, Record<string, unknown>>();
  for (const r of resp.ledger ?? []) ledgerByTk.set(String(r.ticker ?? "").toUpperCase(), r);
  const allocByTk = new Map<string, { role: string; sizing: string; reasons?: string[] }>();
  for (const a of resp.allocation ?? []) allocByTk.set(a.ticker.toUpperCase(), a);

  return (resp.setups ?? []).map((s) => {
    const tk = String(s.ticker ?? "").toUpperCase();
    const lg = ledgerByTk.get(tk) ?? null;
    return {
      ticker: tk,
      strike: (s.top_strike as number) ?? null,
      status: (lg?.status as string) ?? "WATCH",
      score: (s.score as number) ?? null,
      live_pnl_pct: (lg?.live_pnl_pct as number) ?? null,
      entry_premium: (lg?.entry_premium as number) ?? null,
      last_mark: (lg?.last_mark as number) ?? null,
      peak_premium: (lg?.peak_premium as number) ?? null,
      trough_premium: (lg?.trough_premium as number) ?? null,
      setup: s as ZeroDteDeckSource["setup"],
      allocation: allocByTk.get(tk) ?? null,
    };
  });
}

export function ZeroDteDeck() {
  const { data } = useSWR<BoardResp>("/api/market/zerodte/board", json, { refreshInterval: 5_000 });
  const liveMarks = useZeroDteLiveMarks();
  const plays: TerminalPlay[] = overlayLiveMarks(
    zeroDteSources(data ?? null).map(terminalPlayFromZeroDte),
    liveMarks,
  );
  return (
    <CommandDeck
      plays={plays}
      laneLabel="0DTE · same-day"
      emptyHint="Scanning the whole market — no 0DTE setup has cleared the floor right now."
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
