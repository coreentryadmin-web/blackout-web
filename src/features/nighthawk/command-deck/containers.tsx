"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { CommandDeck } from "./CommandDeck";

// Session Analytics panel (real win-rate/tier/exit-outcome bars + a session P&L curve, see
// NighthawkAnalyticsPanel.tsx) — code-split like the rest of the deck's heavier panels so it
// never blocks first paint of the live ledger below it. Loading fallback is panel-sized (NOT
// NightHawkLoadingSkeleton, which is a full two-column deck skeleton meant for the whole view).
const NighthawkAnalyticsPanel = dynamic(
  () => import("@/features/nighthawk/components/NighthawkAnalyticsPanel").then((m) => m.NighthawkAnalyticsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="nh-analytics-panel nh-analytics-panel-loading" role="status" aria-label="Loading session analytics">
        <span className="nh-analytics-panel-title">Session analytics</span>
        <span className="nh-analytics-empty">Loading…</span>
      </div>
    ),
  }
);
import {
  terminalPlayFromZeroDte,
  terminalPlayFromHorizon,
  terminalPlayFromEdition,
  type ZeroDteDeckSource,
} from "./adapters";
import { fetchNightHawkEdition, fetchNightHawkHorizons } from "@/lib/api";
import type { NightHawkEdition, NightHawkRecordResponse } from "@/features/nighthawk/lib/types";
import { LegacyPickLogBoard } from "@/features/nighthawk/components/LegacyPickLogBoard";
import { legacyEditionSessionDates } from "@/features/nighthawk/lib/legacy-board-calendar";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import type { TerminalPlay } from "./types";
import { overlayLegacyQuotes, useLegacyStockQuotes } from "./use-legacy-quotes";
import { overlayLegacyOptionMarks, useLegacyOptionMarks } from "./use-legacy-option-marks";
import { overlayHorizonWatchTrack } from "./use-live-marks";
import { useZeroDteLiveDeck } from "./use-zero-dte-live-deck";
import { zeroDteSources, isBoardDegraded, type BoardResp } from "./zerodte-sources";
import { EDITION_TARGET_PLAYS } from "@/features/nighthawk/lib/constants";
import { isMorningConfirmStale, formatCheckedAtEt } from "@/features/nighthawk/lib/morning-confirm-verdict";
import { SWING_SERVING_SECTIONS } from "@/lib/swing/serving";
import {
  rowsForSwingSection,
  swingSectionCounts,
  emptySwingSectionHint,
  SWING_SECTION_LABEL,
  type SwingSectionFilter,
} from "./swing-section-filter";
import { NIGHTHAWK_COMPACT_LANE_LABEL } from "@/features/nighthawk/lib/nighthawk-view";
import { zeroDteEmptyHint } from "../lib/deck-empty-hint";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

const json = (u: string) => fetch(u, { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));

/** Board payload may carry session.heat — keep the type loose so a missing field never breaks the deck. */
type BoardRespWithSession = BoardResp & {
  // `note` is the data layer's own member-facing sentence for the current heat state
  // (board.ts sessionHeat). It has always been on the wire; this local type used to model
  // only `state`, so the deck literally could not reach it — which is how the empty board
  // ended up claiming an active scan on a closed market. See lib/deck-empty-hint.ts.
  session?: { heat?: { state?: string | null; note?: string | null } | null } | null;
};

/** Board SWR cadence: 1s RTH when open plays need live thesis/gates; marks SSE drives marks/PnL at 1s. */
function zerodteBoardRefreshMs(): number {
  try {
    const { hour, minute, weekday } = etNowParts();
    if (weekday === "Sat" || weekday === "Sun") return 5_000;
    const mins = hour * 60 + minute;
    if (mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5) return 1_000;
  } catch {
    /* fall through */
  }
  return 5_000;
}

// ── 0DTE: the live board (setups ⋈ ledger ⋈ allocation) ────────────────────────────
// Source-derivation lives in the pure ./zerodte-sources module (unit-tested).

export function ZeroDteDeck({
  initialBoard = null,
}: {
  /** SSR seed from loadNightHawkSeedProps — SWR fallbackData for first paint. */
  initialBoard?: BoardResp | null;
} = {}) {
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
  // Never seed sim mode with the live member board (isolation).
  const { data, isLoading } = useSWR<BoardRespWithSession>(boardUrl, json, {
    fallbackData: !sim && initialBoard ? (initialBoard as BoardRespWithSession) : undefined,
    refreshInterval: zerodteBoardRefreshMs(),
    revalidateOnFocus: true,
  });
  const basePlays = useMemo(
    () => zeroDteSources(data ?? null).map(terminalPlayFromZeroDte),
    [data],
  );
  // Unified ~1s overlay: marks SSE + stock quotes + management/thesis advisory refresh.
  const plays = useZeroDteLiveDeck(basePlays, sim);
  // 9-3: a degraded/unavailable board must NOT be painted as a calm "no setup cleared the floor" flat tape
  // — that hides a real outage AND any open position. (isBoardDegraded treats first-load null as not-degraded.)
  const degraded = isBoardDegraded(data);
  const sessionHeat = data?.session?.heat?.state ?? null;
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
      {/* Additive: sits above the live ledger, never gates or replaces it. Hidden entirely in
          sim mode — there's no isolated sim record endpoint, so showing the REAL member
          track record under a sim banner would misleadingly present live stats next to
          simulated plays; the board banner above is the only sim-mode surface here. */}
      {!sim && <NighthawkAnalyticsPanel />}
      <CommandDeck
        plays={plays}
        laneLabel={sim ? NIGHTHAWK_COMPACT_LANE_LABEL.ZERO_DTE_SIM : NIGHTHAWK_COMPACT_LANE_LABEL.ZERO_DTE}
        degraded={degraded}
        loading={isLoading && !data}
        allocation={data?.allocation ?? null}
        sessionHeat={sessionHeat}
        commandCenter
        deckHorizon="ZERO_DTE"
        boardAsOf={typeof data?.as_of === "string" ? data.as_of : null}
        upstreamOk={data?.upstream_ok ?? null}
        marketState={data?.market_state ?? null}
        discoveryFunnel={data?.discovery_funnel ?? null}
        spxSlayerBadge={data?.spx_slayer_badge}
        emptyHint={zeroDteEmptyHint({
          degraded,
          heatState: sessionHeat,
          heatNote: data?.session?.heat?.note ?? null,
        })}
      />
    </>
  );
}

// ── Swings / LEAPS: the horizon lane ────────────────────────────────────────────────

export function HorizonDeck({
  horizon,
  focusTicker = null,
}: {
  horizon: "SWING" | "LEAPS";
  /** Set by a Legacy play's "moved to Swings Open" link — CommandDeck auto-selects this ticker's
   *  row once it appears in the fetched lane. */
  focusTicker?: string | null;
}) {
  const { data, isLoading } = useSWR(["deck-horizons", horizon], () => fetchNightHawkHorizons(horizon), {
    refreshInterval: 30_000,
  });
  // fetchNightHawkHorizons (lib/api.ts) fail-softs a network/upstream error to `{board: null}` —
  // otherwise indistinguishable from a genuinely-empty lane (both render zero rows). Surface that
  // distinction here the same way ZeroDteDeck's isBoardDegraded does for the 0DTE lane: a response
  // that arrived with board:null is an outage, not "scanning, nothing yet".
  const degraded = data != null && data.board == null;
  const lane = data?.board?.lanes?.[horizon];
  const [sectionFilter, setSectionFilter] = useState<SwingSectionFilter>("ALL");
  // Prefer the seven serving sections when present (SWING) — flat committed/watch is back-compat only and
  // collapses COMMIT_NOW + WAITING_FOR_ENTRY into one misleading "committed" rail.
  // Seven sections, selectable (FINDINGS 2026-08-06 swing audit P2): these used to be concatenated
  // into one flat list, so `serving.ts`'s whole reason to exist — telling a member what is
  // ACTIONABLE vs merely forming — survived only as a small per-card badge. ALL keeps the previous
  // behaviour as the default view, so nobody's board changes until they choose a section.
  const hasSections = horizon === "SWING" && lane?.sections != null;
  const sectionCounts = useMemo(() => swingSectionCounts(lane?.sections), [lane?.sections]);
  const sectionRows = hasSections ? rowsForSwingSection(lane!.sections, sectionFilter) : null;
  const rows = sectionRows ?? [...(lane?.committed ?? []), ...(lane?.watch ?? [])];
  const researchCount = horizon === "SWING" ? (lane?.sections?.RESEARCH?.length ?? 0) : 0;
  const watchCount = horizon === "SWING" ? (lane?.sections?.WATCH?.length ?? 0) : 0;
  // A filtered-empty section is NOT an empty lane — saying "scanning the whole market" while 40
  // names sit one tab over would be actively misleading.
  const sectionEmptyHint = hasSections ? emptySwingSectionHint(sectionFilter, sectionCounts) : null;
  const emptyHint = degraded
    ? "Lane data unavailable right now — retrying. This is a data outage, not an empty board."
    : sectionEmptyHint
      ? sectionEmptyHint
      : horizon === "SWING" && rows.length === 0
      ? researchCount > 0 || watchCount > 0
        ? "Swing scan active — names building persistence appear in Research once enriched."
        : "Whole-market swing discovery runs on a phase cadence — first sightings need ≥2 sessions (or corroboration for event setups) before WATCH."
      : `Scanning the whole market for ${horizon === "SWING" ? "Swing" : "LEAPS"} setups — this lane is coming online.`;
  const plays: TerminalPlay[] = rows.map((p) =>
    terminalPlayFromHorizon({
      ticker: p.ticker,
      direction: p.direction,
      horizon,
      score: p.score,
      status: p.status,
      reason: p.reason,
      // Greeks ride through to the deck strip (FINDINGS 2026-08-06): this projection dropped every
      // greek the payload carried — including `delta`, which has ALWAYS been present — so the strip
      // had nothing to render no matter what the server sent. Each is null-safe downstream.
      contract: {
        strike: p.contract.strike,
        right: p.contract.right,
        expiry: p.contract.expiry,
        dte: p.contract.dte,
        mid: p.contract.mid,
        delta: p.contract.delta,
        gamma: p.contract.gamma,
        theta: p.contract.theta,
        vega: p.contract.vega,
        iv: p.contract.iv,
      },
      factors: p.factors,
      regime: p.regime ?? null,
      setupState: p.setupState ?? null,
      entryStatus: p.entryStatus ?? null,
      archetype: p.archetype ?? null,
      subLane: p.subLane ?? null,
      servingSection: p.serving ?? null,
      firstSeenAt: p.firstSeenAt ?? null,
      committedAt: p.committedAt ?? null,
      signalKinds: p.signalKinds ?? null,
      liveStatus: p.liveStatus ?? null,
      flagUnderlyingPx: p.flagUnderlyingPx ?? null,
      entryPremium: p.entryPremium ?? null,
      livePnlPct: p.livePnlPct ?? null,
      peakPremium: p.peakPremium ?? null,
      troughPremium: p.troughPremium ?? null,
      thesisBreak:
        p.thesisLevel != null
          ? { level: p.thesisLevel, note: p.thesisNote ?? undefined }
          : undefined,
    }),
  );
  const watchTickers = useMemo(
    () => [...new Set(plays.filter((p) => p.status === "WATCH").map((p) => p.ticker))],
    [plays],
  );
  const stockQuotes = useLegacyStockQuotes(watchTickers, watchTickers.length > 0, 5_000);
  const playsWithTrack = useMemo(
    () => overlayHorizonWatchTrack(plays, stockQuotes),
    [plays, stockQuotes],
  );
  const sessionHeat = data?.session?.heat?.state ?? null;
  return (
    <>
      {hasSections && (
        <div className="nh-deck-filterbar nh-deck-filterbar--sections" role="group" aria-label="Filter swing plays by serving section">
          {(["ALL", ...SWING_SERVING_SECTIONS] as SwingSectionFilter[]).map((sec) => (
            <button
              key={sec}
              type="button"
              className={clsx("nh-deck-filtbtn", sectionFilter === sec && "on")}
              aria-pressed={sectionFilter === sec}
              onClick={() => setSectionFilter(sec)}
            >
              {SWING_SECTION_LABEL[sec]} <span className="cnt">{sectionCounts[sec]}</span>
            </button>
          ))}
        </div>
      )}
      <CommandDeck
      plays={playsWithTrack}
      laneLabel={horizon === "SWING" ? NIGHTHAWK_COMPACT_LANE_LABEL.SWING : NIGHTHAWK_COMPACT_LANE_LABEL.LEAPS}
      degraded={degraded}
      loading={isLoading && !data}
      emptyHint={emptyHint}
      commandCenter
      deckHorizon={horizon}
      boardAsOf={typeof data?.board?.asOf === "string" ? data.board.asOf : null}
      upstreamOk={data?.upstream_ok ?? null}
      sessionHeat={sessionHeat}
      focusTicker={focusTicker}
      />
    </>
  );
}

// ── Legacy: the evening edition ─────────────────────────────────────────────────────

export function LegacyDeck() {
  const todaySession = etSessionDate(Date.now()) ?? "";
  const [selectedEditionDate, setSelectedEditionDate] = useState<string | null>(null);
  const editionKey = selectedEditionDate ? ["legacy-edition", selectedEditionDate] : "nighthawk-edition";
  const { data: edition, error } = useSWR<NightHawkEdition>(
    editionKey,
    () => fetchNightHawkEdition(selectedEditionDate ?? undefined),
    { refreshInterval: 120_000 }
  );
  // Fetch morning confirmation verdicts when an edition is available.
  const editionFor = edition?.edition_for ?? null;
  const { data: confirmData } = useSWR(
    editionFor ? ["legacy-confirm", editionFor] : null,
    () => fetch(`/api/nighthawk/play-status?date=${editionFor}`, { cache: "no-store", credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
    { refreshInterval: 60_000 },
  );
  const confirmByTicker = useMemo(() => {
    const map = new Map<string, { status: string; reason: string; swingPromoted?: boolean; checkedAt?: string | null }>();
    if (confirmData?.plays) {
      for (const ps of confirmData.plays) {
        map.set(ps.ticker?.toUpperCase(), {
          status: ps.status,
          reason: ps.reason,
          swingPromoted: ps.swingPromoted === true,
          checkedAt: typeof ps.checked_at === "string" ? ps.checked_at : (confirmData?.checked_at ?? null),
        });
      }
    }
    return map;
  }, [confirmData]);

  const confirmCheckedAt: string | null = confirmData?.checked_at ?? null;

  const rawPlays = (edition?.plays ?? []).slice(0, EDITION_TARGET_PLAYS);
  const basePlays = useMemo<TerminalPlay[]>(() => rawPlays.map((p, i) => {
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
      target_atr_multiple: p.target_atr_multiple ?? null,
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
      tier: p.tier ?? null,
      morning_status: confirm?.status as "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED" | undefined ?? null,
      morning_reason: confirm?.reason ?? null,
      swing_promoted: confirm?.swingPromoted ?? null,
      published_at: edition?.published_at ?? null,
      confirmed_at: confirm?.checkedAt ?? p.morning_checked_at ?? confirmCheckedAt,
    });
  }), [rawPlays, confirmByTicker, edition?.published_at, confirmCheckedAt]);

  // Per-conviction scorecard: fetch the track record once (long refresh) and overlay
  // the conviction-level win rate onto each play so the scorecard badge lights up.
  const { data: recordData } = useSWR<NightHawkRecordResponse>(
    "legacy-record",
    () => json("/api/market/nighthawk/record"),
    { refreshInterval: 600_000 },
  );
  const convictionScorecard = new Map<string, { winRate: number; avg: number; n: number; ciLow?: number | null; ciHigh?: number | null }>();
  if (recordData?.by_conviction) {
    for (const c of recordData.by_conviction) {
      // Gate on DECIDED outcomes, not bucket size. `c.n` counts scoreable rows, which
      // include plays whose grading horizon expired without touching target or stop — so
      // `c.n > 0` let a bucket with ZERO real outcomes paint a confident "0%" badge on the
      // play a member is deciding whether to take (live 2026-08-06: A n=12 decided=0,
      // B n=10 decided=0, both badged 0%). Below the shared low-n floor we show no rate.
      const decided = c.decided ?? 0;
      if (c.conviction && decided >= LOW_N_THRESHOLD && !c.low_n && c.win_rate_pct != null) {
        convictionScorecard.set(c.conviction.toUpperCase(), {
          winRate: c.win_rate_pct,
          avg: recordData.avg_return_pct ?? 0,
          // The n shown beside the rate must be the n that PRODUCED it.
          n: decided,
          ciLow: c.win_rate_ci_low_pct ?? null,
          ciHigh: c.win_rate_ci_high_pct ?? null,
        });
      }
    }
  }
  const playsWithScorecard = useMemo<TerminalPlay[]>(() => basePlays.map((p) => {
    if (p.scorecard) return p;
    const conv = p.tierLabel?.toUpperCase();
    const sc = conv ? convictionScorecard.get(conv) : null;
    return sc ? { ...p, scorecard: { ...sc, scope: "conviction_bucket" as const } } : p;
  }), [basePlays, convictionScorecard]);

  // Live stock quotes — polls /api/market/quote for each Legacy ticker so the deck shows
  // real-time stock-level progress toward target/stop (the "dynamic trade management" overlay).
  const tickers = useMemo(() => rawPlays.map((p) => p.ticker?.toUpperCase()).filter(Boolean), [rawPlays]);
  const stockQuotes = useLegacyStockQuotes(tickers);
  const legacyOccs = useMemo(
    () => playsWithScorecard.map((p) => p.occ).filter((o): o is string => typeof o === "string" && o.length > 0),
    [playsWithScorecard],
  );
  const optionMarks = useLegacyOptionMarks(legacyOccs);
  const plays = overlayLegacyOptionMarks(
    overlayLegacyQuotes(playsWithScorecard, stockQuotes, rawPlays),
    optionMarks,
  );

  // Morning-confirm staleness: the verdict is a one-time 9am snapshot that never updates.
  // After 4h it misleads if shown without qualification.
  const checkedAt: string | null = confirmCheckedAt;
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

  const editionLabel =
    edition?.served_for ?? edition?.edition_for ?? (selectedEditionDate ? selectedEditionDate : todaySession);
  const calendarDates = useMemo(() => legacyEditionSessionDates(14), []);

  const emptyDescription = hasFetchError
    ? "Edition data unavailable right now — retrying. Check back shortly."
    : isRecapOnly
      ? "No plays cleared the scoring funnel tonight — market recap is above."
      : "Five ranked setups land here after the evening scan · ~5:30 PM ET.";

  const bannerSlot = (
    <>
      {bannerText ? (
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
      ) : null}
      {confirmStale && checkedAtLabel ? (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200"
        >
          <span aria-hidden>~</span>
          <span>Morning verdict from {checkedAtLabel} — may no longer reflect current conditions.</span>
        </div>
      ) : null}
      {edition?.recap_headline ? (
        <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <div className="text-xs font-bold uppercase tracking-wide text-white">{edition.recap_headline}</div>
          {edition.recap_summary ? (
            <div className="mt-1 text-xs leading-relaxed text-sky-200">{edition.recap_summary}</div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <LegacyPickLogBoard
      plays={plays}
      loading={!edition && !error}
      degraded={hasFetchError || isDegraded}
      editionFor={edition?.edition_for ?? null}
      editionLabel={editionLabel}
      todaySession={todaySession}
      selectedEditionDate={selectedEditionDate}
      onSelectedEditionDateChange={setSelectedEditionDate}
      calendarDates={calendarDates}
      bannerSlot={bannerSlot}
      emptyDescription={emptyDescription}
    />
  );
}
