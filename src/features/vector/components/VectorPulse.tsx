"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetchFlows, type FlowAlert } from "@/lib/api";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  detectPlayStateSignals,
  filterFreshPulseSignals,
  wallEventToPulseSignal,
  flowAlertToPulseSignal,
  dedupeByKindLevel,
  applyGlobalRateCap,
  PULSE_FEED_MAX,
  type PulseSnapshot,
  type PulseSignal,
  type PulseSignalTone,
  type PlayStateSnapshot,
} from "@/features/vector/lib/vector-pulse";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { renderEmphasis } from "@/features/spx/lib/spx-emphasis";

type Props = {
  ticker: string;
  lens: VectorWallLens;
  wallEvents: VectorWallEvent[];
  liveSession: boolean;
  streamUpdatedAt?: number | null;
  regime: VectorRegime;
  proximity?: WallProximity | null;
  magnet?: GammaMagnet | null;
  confluence?: string[] | null;
  technicals?: string[];
  expectedMove?: string[];
  alerts?: string[];
  wallIntegrity?: { call: WallIntegrity | null; put: WallIntegrity | null };
  liveSpot?: number | null;
  /** Whether this instance renders its own inline TECHNICALS card in the intel grid. Default true
   *  (unchanged behavior). The desktop action-rail layout (2026-08-05) passes false and renders
   *  `VectorTechnicalsPanel` separately instead, so the card can live in its own column rather than
   *  buried at the bottom of this narrative feed — same data, same markup, different placement. */
  showTechnicals?: boolean;
};

const TONE_LABELS: Record<PulseSignalTone, string> = {
  bull: "BULL",
  bear: "BEAR",
  warn: "WARN",
  info: "INFO",
};

const TONE_ICONS: Record<PulseSignalTone, string> = {
  bull: "▲",
  bear: "▼",
  warn: "◆",
  info: "●",
};

const KIND_ICONS: Partial<Record<PulseSignal["kind"], string>> = {
  "play-state": "⚑",
  "flow-print": "◈",
};

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function fmtSpot(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function VectorPulse({
  ticker,
  lens,
  wallEvents,
  liveSession,
  streamUpdatedAt,
  regime,
  proximity,
  magnet,
  confluence,
  technicals,
  expectedMove,
  alerts,
  wallIntegrity,
  liveSpot,
  showTechnicals = true,
}: Props) {
  const normalized = normalizeVectorTicker(ticker);
  const isSpx = normalized === "SPX";

  const [feed, setFeed] = useState<PulseSignal[]>([]);

  const prevSnapshotRef = useRef<PulseSnapshot | null>(null);
  const seenMapRef = useRef<Record<string, number>>({});
  const processedWallEventsRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  // ── Play state diffing refs (SPX only) ──
  const prevPlayRef = useRef<PlayStateSnapshot | null>(null);

  // ── Flow dedup ref ──
  const seenFlowIdsRef = useRef<Set<string>>(new Set());

  // ── Feed curation ledgers (2026-08-05 signal-quality pass) ── shared across ALL three signal
  // sources below (core Vector detection, SPX play state, Helix flow prints) so the (kind, level)
  // dedup and the global rate cap see the whole feed, not just one source's slice of it. These
  // primitives (dedupeByKindLevel, applyGlobalRateCap) already existed — built 2026-07-26 for the
  // SPX engine's rail — but were never wired into Vector's own feed, so every fresh transition
  // landed in the feed uncapped. curateAndEmit below is the missing wiring.
  const kindLevelSeenRef = useRef<Record<string, number>>({});
  const rateCapRecentRef = useRef<number[]>([]);

  function curateAndEmit(raw: PulseSignal[], now: number) {
    if (raw.length === 0) return;
    const { fresh, seen } = filterFreshPulseSignals(raw, seenMapRef.current, now);
    seenMapRef.current = seen;
    if (fresh.length === 0) return;

    const { kept, seen: seenKL } = dedupeByKindLevel(fresh, kindLevelSeenRef.current, now);
    kindLevelSeenRef.current = seenKL;
    if (kept.length === 0) return;

    const { emitted, recent } = applyGlobalRateCap(kept, rateCapRecentRef.current, now);
    rateCapRecentRef.current = recent;
    if (emitted.length === 0) return;

    setFeed((prev) => [...emitted, ...prev].slice(0, PULSE_FEED_MAX));
  }

  // ── Ticker reset ──
  const prevTickerRef = useRef(normalized);
  useEffect(() => {
    if (prevTickerRef.current !== normalized) {
      setFeed([]);
      prevSnapshotRef.current = null;
      seenMapRef.current = {};
      processedWallEventsRef.current = 0;
      prevPlayRef.current = null;
      seenFlowIdsRef.current = new Set();
      kindLevelSeenRef.current = {};
      rateCapRecentRef.current = [];
      prevTickerRef.current = normalized;
    }
  }, [normalized]);

  // ── Core Vector signal detection (regime, proximity, magnet, integrity, walls) ──
  useEffect(() => {
    const now = streamUpdatedAt ?? Date.now();
    const integ = wallIntegrity ?? { call: null, put: null };

    const current = buildPulseSnapshot({
      at: now,
      regime,
      proximity: proximity ?? null,
      magnet: magnet ?? null,
      wallIntegrity: integ,
      wallEventCount: wallEvents.length,
    });

    const rawSignals: PulseSignal[] = detectPulseSignals(prevSnapshotRef.current, current);

    const newWallCount = wallEvents.length - processedWallEventsRef.current;
    if (newWallCount > 0) {
      const newEvents = wallEvents.slice(processedWallEventsRef.current);
      for (const ev of newEvents) {
        rawSignals.push(wallEventToPulseSignal(ev));
      }
      processedWallEventsRef.current = wallEvents.length;
    }

    curateAndEmit(rawSignals, now);

    prevSnapshotRef.current = current;
  }, [regime, proximity, magnet, wallIntegrity, wallEvents, streamUpdatedAt]);

  // ── SPX play engine (state + playbook) ──
  // Root cause (2026-08-01 audit): this used to be its own useSWR("vector-spx-playbook", ...)
  // at a 1s refreshInterval — a SECOND independent poll of the exact same /spx/play endpoint
  // useSpxPlay() already polls (spx-desk's `useSpxPlay` hook, 2s default via SPX_PLAY_POLL_MS),
  // running concurrently whenever VectorPulse is mounted inside SpxDashboard (Vector chart is
  // embedded in the flagship SPX Slayer desk — see SpxDashboard.tsx). Two SWR keys for one
  // endpoint means SWR's cache/dedup can't collapse them: every poll cycle double-fetched
  // /spx/play. Sharing useSpxPlay's key+cache here removes the second poller entirely and, as
  // a side benefit, gap-fills from the session cache the same way the desk's own play data does
  // (previously this panel would blank on a transient poll gap; the desk data does not).
  const { play: spxPlay } = useSpxPlay(isSpx && liveSession);

  // Diff play state for transition signals
  useEffect(() => {
    if (!spxPlay || !isSpx || !liveSession) return;
    const now = Date.now();

    const current: PlayStateSnapshot = {
      phase: spxPlay.phase,
      direction: spxPlay.direction,
      grade: spxPlay.grade,
      headline: spxPlay.headline,
      score: spxPlay.score,
      optionLabel: spxPlay.option_ticket?.contract_label ?? null,
    };

    const playSignals = detectPlayStateSignals(prevPlayRef.current, current, now);
    prevPlayRef.current = current;

    curateAndEmit(playSignals, now);
  }, [spxPlay, isSpx, liveSession]);

  const playbookLines: PlayTerminalLine[] | null = useMemo(() => {
    if (!isSpx || !spxPlay?.playbook_shadow) return null;
    return buildPlaybookTerminalLines(spxPlay.playbook_shadow, liveSession).slice(1);
  }, [isSpx, spxPlay, liveSession]);

  // ── Helix flow prints (large options flow for current ticker) ── fetch floor matches
  // flowAlertToPulseSignal's own $1M floor (2026-08-05) so the fetch doesn't pull rows the pulse
  // signal builder will just discard.
  const { data: flowData } = useSWR(
    liveSession ? `pulse-flows-${normalized}` : null,
    () => fetchFlows({ ticker: normalized, limit: 20, min_premium: 1_000_000 }),
    { refreshInterval: liveSession ? 10_000 : 0, revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  useEffect(() => {
    if (!flowData?.flows?.length || !liveSession) return;
    const now = Date.now();
    const newSignals: PulseSignal[] = [];

    for (const flow of flowData.flows) {
      const id = flow.alert_id ?? `${flow.ticker}:${flow.strike}:${flow.expiry}:${flow.alerted_at}`;
      if (seenFlowIdsRef.current.has(id)) continue;
      seenFlowIdsRef.current.add(id);

      const sig = flowAlertToPulseSignal(flow, now);
      if (sig) newSignals.push(sig);
    }

    // Cap seen set to prevent unbounded growth
    if (seenFlowIdsRef.current.size > 200) {
      const arr = Array.from(seenFlowIdsRef.current);
      seenFlowIdsRef.current = new Set(arr.slice(arr.length - 100));
    }

    curateAndEmit(newSignals, now);
  }, [flowData, liveSession]);

  // ── Derived state ──
  const regimeTone =
    regime.posture === "long" ? "bull"
      : regime.posture === "short" ? "bear"
        : regime.posture === "transition" ? "warn"
          : "muted";

  const hasIntegrity = lens === "gex" && wallIntegrity;
  const integrityEntries = hasIntegrity
    ? [wallIntegrity.call, wallIntegrity.put].filter(Boolean)
    : [];

  // Play state summary for the hero area (SPX only, when WATCHING or OPEN)
  const playBanner = isSpx && spxPlay && spxPlay.phase !== "SCANNING" ? spxPlay : null;

  return (
    <div className="vector-pulse" role="complementary" aria-label={`Vector Pulse for ${normalized}`}>
      {/* ── REGIME HERO ── */}
      <div className={`vp-regime vp-regime--${regimeTone}`}>
        <div className="vp-regime-top">
          <span className="vp-regime-ticker">{normalized}</span>
          {liveSession && streamUpdatedAt && (
            <span className="vp-live-badge">
              <span className="vp-live-dot" />
              LIVE
            </span>
          )}
        </div>
        <div className="vp-regime-headline">{regime.headline}</div>
        <div className="vp-regime-read">{regime.read}</div>
        {liveSpot != null && liveSpot > 0 && (
          <div className="vp-spot">
            <span className="vp-spot-value">{fmtSpot(liveSpot)}</span>
          </div>
        )}
      </div>

      {/* ── PLAY STATE BANNER (SPX only, WATCHING/OPEN) ── */}
      {playBanner && (
        <div className={`vp-play vp-play--${playBanner.phase === "OPEN" ? "open" : "watch"}`}>
          <div className="vp-play-head">
            <span className="vp-play-phase">{playBanner.phase}</span>
            <span className="vp-play-grade">{playBanner.grade}</span>
            {playBanner.option_ticket?.contract_label && (
              <span className="vp-play-ticket">{playBanner.option_ticket.contract_label}</span>
            )}
          </div>
          <div className="vp-play-thesis">{playBanner.headline}</div>
          {playBanner.open_play && (
            <div className="vp-play-levels">
              <span>Entry {fmtSpot(playBanner.open_play.entry_price)}</span>
              {playBanner.open_play.stop != null && <span>Stop {fmtSpot(playBanner.open_play.stop)}</span>}
              {playBanner.open_play.target != null && <span>Target {fmtSpot(playBanner.open_play.target)}</span>}
            </div>
          )}
        </div>
      )}

      {/* ── PROXIMITY BANNER ── */}
      {proximity && (
        <div className={`vp-prox ${proximity.nearness === "at" ? "vp-prox--hot" : "vp-prox--warm"}`}>
          <span className="vp-prox-badge">{proximity.nearness.toUpperCase()}</span>
          <span className="vp-prox-text">{proximity.callout}</span>
        </div>
      )}

      {/* ── SIGNAL FEED ── */}
      <div className="vp-signals" ref={feedRef}>
        <div className="vp-signals-header">
          <span className="vp-signals-label">SIGNALS</span>
          {feed.length > 0 && <span className="vp-signals-count">{feed.length}</span>}
        </div>
        {feed.length === 0 ? (
          <div className="vp-signals-empty">
            {liveSession ? "Watching for transitions..." : "Session closed — no live signals"}
          </div>
        ) : (
          <div className="vp-signals-list">
            {feed.map((sig, i) => (
              <div key={`${sig.key}-${sig.at}-${i}`} className={`vp-sig vp-sig--${sig.tone} vp-sig--${sig.kind}`}>
                <div className="vp-sig-head">
                  <span className={`vp-sig-badge vp-sig-badge--${sig.tone}`}>
                    <span className="vp-sig-icon">{KIND_ICONS[sig.kind] ?? TONE_ICONS[sig.tone]}</span>
                    {TONE_LABELS[sig.tone]}
                  </span>
                  <span className="vp-sig-time">{formatTimestamp(sig.at)}</span>
                </div>
                <div className="vp-sig-line">{sig.line}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── INTEL GRID ── */}
      <div className="vp-intel">
        {/* Magnet */}
        {magnet && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">⬡</span>
              <span className="vp-intel-card-title">GAMMA MAGNET</span>
            </div>
            <div className={`vp-intel-card-body ${magnet.posture === "short" ? "vp-t-warn" : "vp-t-muted"}`}>
              {renderEmphasis(magnet.callout)}
            </div>
          </div>
        )}

        {/* Wall integrity */}
        {integrityEntries.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">◈</span>
              <span className="vp-intel-card-title">WALL INTEGRITY</span>
            </div>
            {integrityEntries.map((wi) => (
              <div
                key={wi!.side}
                className={`vp-intel-card-body ${wi!.tier === "thin" ? "vp-t-warn" : wi!.tier === "firm" ? "vp-t-bull" : "vp-t-muted"}`}
              >
                {renderEmphasis(`${wi!.note} · ${wi!.score}/100`)}
              </div>
            ))}
          </div>
        )}

        {/* Confluence */}
        {confluence && confluence.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">◎</span>
              <span className="vp-intel-card-title">CONFLUENCE</span>
            </div>
            {confluence.map((c, i) => (
              <div key={i} className="vp-intel-card-body vp-t-muted">
                {renderEmphasis(c)}
              </div>
            ))}
          </div>
        )}

        {/* Technicals — omitted here when the host renders VectorTechnicalsPanel separately (the
            desktop action-rail layout); showTechnicals defaults true so every other caller keeps
            its inline card exactly as before. */}
        {showTechnicals && technicals && technicals.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">≡</span>
              <span className="vp-intel-card-title">TECHNICALS</span>
            </div>
            {technicals.map((t, i) => (
              <div key={i} className="vp-intel-card-body vp-t-muted">
                {renderEmphasis(t)}
              </div>
            ))}
          </div>
        )}

        {/* Expected move */}
        {expectedMove && expectedMove.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">↔</span>
              <span className="vp-intel-card-title">EXPECTED MOVE</span>
            </div>
            {expectedMove.map((e, i) => (
              <div key={i} className="vp-intel-card-body vp-t-muted">
                {renderEmphasis(e)}
              </div>
            ))}
          </div>
        )}

        {/* Alerts */}
        {alerts && alerts.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">⚡</span>
              <span className="vp-intel-card-title">ALERTS</span>
            </div>
            {alerts.map((a, i) => (
              <div key={i} className="vp-intel-card-body vp-t-bull">
                {renderEmphasis(a)}
              </div>
            ))}
          </div>
        )}

        {/* SPX playbook */}
        {playbookLines && playbookLines.length > 0 && (
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-icon">❯</span>
              <span className="vp-intel-card-title">SPX PLAYBOOK</span>
            </div>
            {playbookLines.map((line, i) => (
              <div
                key={i}
                className={`vp-intel-card-body vp-pb-${line.tone}`}
                style={{ paddingLeft: (line.indent ?? 0) * 14 }}
              >
                <span className="vp-pb-icon">{PB_ICON[line.icon] ?? "▸"}</span>
                {renderEmphasis(line.text)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PB_ICON: Record<string, string> = {
  prompt: "❯", section: "◆", ok: "✓", no: "✕", vwap: "▲", flow: "◎",
  gamma: "⬡", level: "▸", news: "▪", trim: "✂", sell: "⏹", watch: "◉",
  dim: "·", pulse: "●",
};
