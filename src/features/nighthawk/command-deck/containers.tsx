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
import type { NightHawkEdition, NightHawkRecordResponse } from "@/features/nighthawk/lib/types";
import type { TerminalPlay } from "./types";
import { useZeroDteLiveMarks, overlayLiveMarks } from "./use-live-marks";
import { useLegacyStockQuotes, overlayLegacyQuotes } from "./use-legacy-quotes";
import { zeroDteSources, isBoardDegraded, type BoardResp } from "./zerodte-sources";
import { EDITION_TARGET_PLAYS } from "@/features/nighthawk/lib/constants";
import { isMorningConfirmStale, formatCheckedAtEt } from "@/features/nighthawk/lib/morning-confirm-verdict";

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

export function LegacyDeck({ edition, error }: { edition: NightHawkEdition | undefined; error?: unknown }) {
  // Fetch morning confirmation verdicts when an edition is available.
  const editionFor = edition?.edition_for ?? null;
  const { data: confirmData } = useSWR(
    editionFor ? ["legacy-confirm", editionFor] : null,
    () => fetch(`/api/nighthawk/play-status?date=${editionFor}`, { cache: "no-store", credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
    { refreshInterval: 60_000 },
  );
  const confirmByTicker = new Map<string, { status: string; reason: string }>();
  if (confirmData?.plays) {
    for (const ps of confirmData.plays) {
      confirmByTicker.set(ps.ticker?.toUpperCase(), { status: ps.status, reason: ps.reason });
    }
  }

  const rawPlays = (edition?.plays ?? []).slice(0, EDITION_TARGET_PLAYS);
  const basePlays: TerminalPlay[] = rawPlays.map((p, i) => {
    const tk = p.ticker?.toUpperCase();
    const confirm = confirmByTicker.get(tk);
    return terminalPlayFromEdition({
      ticker: p.ticker,
      direction: p.direction,
      rank: p.rank ?? i + 1,
      score: p.score,
      factor_breakdown: p.factor_breakdown ?? null,
      conviction: p.conviction ?? null,
      thesis: p.thesis ?? null,
      key_signal: p.key_signal ?? null,
      entry_range: p.entry_range ?? null,
      target: p.target ?? null,
      stop: p.stop ?? null,
      options_play: p.options_play ?? null,
      entry_premium: p.entry_premium ?? null,
      risk_note: p.risk_note ?? null,
      exit_style: p.exit_style ?? null,
      iv_rank: p.iv_rank ?? null,
      rr_ratio: p.rr_ratio ?? null,
      flow_streak_days: p.flow_streak_days ?? null,
      confirming_signals: p.confirming_signals ?? null,
      earnings_risk: p.earnings_risk ?? null,
      entry_cost_per_contract: p.entry_cost_per_contract ?? null,
      premium_cap_ok: p.premium_cap_ok ?? null,
      sector: p.sector ?? null,
      gate_promoted: p.gate_promoted ?? null,
      gate_warnings: p.gate_warnings ?? null,
      pulled: p.pulled ?? null,
      pulled_reason: p.pulled_reason ?? null,
      morning_status: confirm?.status as "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED" | undefined ?? null,
      morning_reason: confirm?.reason ?? null,
    });
  });

  // Per-conviction scorecard: fetch the track record once (long refresh) and overlay
  // the conviction-level win rate onto each play so the scorecard badge lights up.
  const { data: recordData } = useSWR<NightHawkRecordResponse>(
    "legacy-record",
    () => json("/api/market/nighthawk/record"),
    { refreshInterval: 600_000 },
  );
  const convictionScorecard = new Map<string, { winRate: number; avg: number; n: number }>();
  if (recordData?.by_conviction) {
    for (const c of recordData.by_conviction) {
      if (c.conviction && c.n > 0 && c.win_rate_pct != null) {
        convictionScorecard.set(c.conviction.toUpperCase(), { winRate: c.win_rate_pct, avg: recordData.avg_return_pct ?? 0, n: c.n });
      }
    }
  }
  const playsWithScorecard: TerminalPlay[] = basePlays.map((p) => {
    if (p.scorecard) return p;
    const conv = p.tierLabel?.toUpperCase();
    const sc = conv ? convictionScorecard.get(conv) : null;
    return sc ? { ...p, scorecard: sc } : p;
  });

  // Live stock quotes — polls /api/market/quote for each Legacy ticker so the deck shows
  // real-time stock-level progress toward target/stop (the "dynamic trade management" overlay).
  const tickers = rawPlays.map((p) => p.ticker?.toUpperCase()).filter(Boolean);
  const stockQuotes = useLegacyStockQuotes(tickers);
  const plays = overlayLegacyQuotes(playsWithScorecard, stockQuotes, rawPlays);

  // Morning-confirm staleness: the verdict is a one-time 9am snapshot that never updates.
  // After 4h it misleads if shown without qualification.
  const checkedAt: string | null = confirmData?.checked_at ?? null;
  const confirmStale = isMorningConfirmStale(checkedAt, Date.now());
  const checkedAtLabel = checkedAt ? formatCheckedAtEt(checkedAt) : null;

  // Edition health banners — stale/degraded/carry/error states must be visible, never silently hidden.
  const isStale = edition?.stale === true;
  const isDegraded = edition?.degraded === true;
  const isCarry = edition?.carry_until_close === true;
  const isRecapOnly = edition?.recap_only === true;
  const hasFetchError = !!error && !edition;

  const bannerText = hasFetchError
    ? "Edition data temporarily unavailable — retrying."
    : isDegraded
      ? "Served from a degraded source — plays may be incomplete."
      : isStale
        ? `Showing ${edition?.served_for ?? "prior"} edition — tonight's not published yet.`
        : isCarry
          ? `Carrying ${edition?.served_for ?? "prior"} plays until their session closes at 4 PM ET.`
          : isRecapOnly
            ? "Recap published — no plays cleared the funnel tonight."
            : null;

  return (
    <>
      {bannerText && (
        <div
          role="status"
          className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            hasFetchError || isDegraded
              ? "border-red-400/60 bg-red-500/15 text-red-200"
              : isStale || isCarry
                ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                : "border-sky-400/30 bg-sky-500/10 text-sky-200"
          }`}
        >
          <span aria-hidden>{hasFetchError || isDegraded ? "!" : isStale || isCarry ? "~" : "i"}</span>
          <span>{bannerText}</span>
        </div>
      )}
      {confirmStale && checkedAtLabel && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200"
        >
          <span aria-hidden>~</span>
          <span>Morning verdict from {checkedAtLabel} — may no longer reflect current conditions.</span>
        </div>
      )}
      {edition?.recap_headline && (
        <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <div className="text-xs font-bold uppercase tracking-wide text-white/80">{edition.recap_headline}</div>
          {edition.recap_summary && <div className="mt-1 text-xs leading-relaxed text-[#9fb4d4]/70">{edition.recap_summary}</div>}
        </div>
      )}
      <CommandDeck
        plays={plays}
        laneLabel="Legacy · Tonight's playbook"
        degraded={hasFetchError || isDegraded}
        emptyHint={
          hasFetchError
            ? "Edition data unavailable right now — retrying. Check back shortly."
            : isRecapOnly
              ? "No plays cleared the scoring funnel tonight — market recap is above."
              : "Five ranked setups land here after the evening scan · ~5:30 PM ET."
        }
      />
    </>
  );
}
