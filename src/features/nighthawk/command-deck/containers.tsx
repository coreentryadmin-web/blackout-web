"use client";

import { useEffect, useState } from "react";
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
  // ADMIN-ONLY sim view (feat/zerodte-admin-sim-view): when the page URL carries
  // `?sim=1`, fetch the ISOLATED admin sim board instead of the member board and paint
  // an unmistakable banner. Read client-side (window.location) so SSR output stays
  // deterministic; the server route independently re-checks admin (a non-admin who
  // appends ?sim=1 still gets the member board, so this is display-only, never a gate).
  const [sim, setSim] = useState(false);
  useEffect(() => {
    setSim(new URLSearchParams(window.location.search).get("sim") === "1");
  }, []);

  const boardUrl = sim ? "/api/market/zerodte/board?sim=1" : "/api/market/zerodte/board";
  const { data } = useSWR<BoardResp>(boardUrl, json, { refreshInterval: 5_000 });
  // In sim mode the sim payload's ledger carries its OWN simulated marks/PnL — do NOT
  // overlay the real member live-marks lane (that streams actual prod contracts and
  // would corrupt the simulated board). Disabling it also skips the pointless SSE.
  const liveMarks = useZeroDteLiveMarks(!sim);
  const plays: TerminalPlay[] = overlayLiveMarks(
    zeroDteSources(data ?? null).map(terminalPlayFromZeroDte),
    sim ? new Map() : liveMarks,
  );
  // 9-3: a degraded/unavailable board must NOT be painted as a calm "no setup cleared the floor" flat tape
  // — that hides a real outage AND any open position. (isBoardDegraded treats first-load null as not-degraded.)
  const degraded = isBoardDegraded(data);
  return (
    <>
      {sim && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200"
        >
          <span aria-hidden>▲</span>
          <span>SIMULATION — not live. Admin-only replay; members see the real board.</span>
        </div>
      )}
      <CommandDeck
        plays={plays}
        laneLabel={sim ? "0DTE · SIMULATION" : "0DTE · same-day"}
        degraded={degraded}
        allocation={data?.allocation ?? null}
        emptyHint={
          degraded
            ? "Board data unavailable right now — retrying. Any open position is still live; this is a data outage, not a flat tape."
            : "Scanning the whole market — no 0DTE setup has cleared the floor right now."
        }
      />
    </>
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
