"use client";

// ⚡ SPX PULSE rail — the enhanced live event feed that replaces Largo as the DEFAULT
// left-column presentation on the SPX Slayer desk (2026-07-26). The old Largo commentary
// rail is untouched and one toggle away (see SpxIntelRail).
//
// It runs the pure SPX Pulse engine (spx-pulse.ts) CLIENT-SIDE on every merged-desk tick —
// the same tick cadence Largo already uses, adding NO network traffic for the structural
// events. Pin data (useSpxPinForecast) and play state (useSpxPlay) reuse SWR keys the desk
// already polls. Every event derives from real SPX desk snapshot inputs (regime / walls /
// magnet / pin / VIX / macro calendar / flow tape) via voiceSnapshotFromDesk — RTH-real by
// construction; where a source is missing the event kind simply doesn't fire (never faked).

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";

import type { SpxDeskPayload } from "@/lib/api";
import { voiceSnapshotFromDesk } from "@/lib/bie/spx-live-voice";
import { largoEnabled } from "@/lib/largo-env";
import { todayEtYmdClient } from "@/lib/session-cache";
import { useSpxPinForecast } from "@/features/spx/hooks/useSpxPinForecast";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";
import {
  applyGlobalRateCap,
  dedupeByKindLevel,
  filterFreshPulseSignals,
  signalTier,
  type PulseSignal,
} from "@/features/vector/lib/vector-pulse";
import {
  buildSpxPulseSnapshot,
  detectSpxPulseSignals,
  detectSpxPlaySignals,
  advanceWallBreakTracker,
  emptyWallBreakTracker,
  etMinuteOfDay,
  sweepToPulseSignal,
  fmtNotional,
  SPX_PULSE_FEED_MAX,
  SPX_REGIME_HYSTERESIS_PTS,
  type SpxPulseSnapshot,
  type WallBreakTracker,
  type SpxPlayInput,
} from "@/features/spx/lib/spx-pulse";
import {
  kindView,
  orderPulseFeed,
  signalPassesFilter,
  SPX_PULSE_FILTERS,
  type SpxPulseFilter,
} from "@/features/spx/lib/spx-pulse-view";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  focus?: boolean;
};

/** Feed item = a fired signal plus a stable unique id for React keys / flash tracking. */
type FeedItem = PulseSignal & { id: string };

const STALE_AFTER_MS = 30_000;
const FLASH_MS = 1_200;

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function toneClass(tone: PulseSignal["tone"]): string {
  return tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "warn" ? "text-amber-300" : "text-sky-300/90";
}

function PulseRow({
  item,
  expanded,
  onToggle,
  flashing,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  flashing: boolean;
}) {
  const view = kindView(item.kind);
  const pinned = signalTier(item) === 1;
  return (
    <div
      className={clsx("spx-pulse-row", flashing && "spx-pulse-row--flash", pinned && "spx-pulse-row--pinned")}
      style={{ ["--pulse-accent" as string]: view.color }}
      data-kind={item.kind}
    >
      <span className="spx-pulse-row-rail" aria-hidden />
      <div className="spx-pulse-row-icon" aria-hidden>{view.icon}</div>
      <div className="spx-pulse-row-main">
        <div className="spx-pulse-row-top">
          <span className="spx-pulse-badge">{view.badge}</span>
          <span className={clsx("spx-pulse-what", toneClass(item.tone))}>{item.line}</span>
        </div>
        {item.implication && <p className="spx-pulse-implication">{item.implication}</p>}
        {item.magnitude && item.magnitude.length > 0 && (
          <div className="spx-pulse-mags">
            {item.magnitude.map((m, i) => (
              <span key={i} className="spx-pulse-mag">{m.label}</span>
            ))}
          </div>
        )}
        {expanded && item.why && <p className="spx-pulse-why">{item.why}</p>}
      </div>
      <div className="spx-pulse-row-right">
        <time className="spx-pulse-time" dateTime={new Date(item.at).toISOString()}>{fmtClock(item.at)}</time>
        <div className="spx-pulse-row-actions">
          <button
            type="button"
            className="spx-pulse-jump"
            title={item.level != null ? `Jump to ${Math.round(item.level)} on the chart` : "Jump to chart"}
            aria-label="Jump to chart"
            onClick={() => {
              // Chart-anchor plumbing is out of scope; render the affordance as a no-op stub
              // (the rail is mounted beside the Vector chart which owns level anchoring).
            }}
          >
            → chart
          </button>
          {item.why && (
            <button
              type="button"
              className="spx-pulse-expand"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide why" : "Show why"}
              onClick={onToggle}
            >
              {expanded ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SpxPulseRail({ desk, live, focus }: Props) {
  const sessionActive = Boolean(live && desk?.available);
  const { pin } = useSpxPinForecast(sessionActive);
  const { play } = useSpxPlay(sessionActive);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<SpxPulseFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  // Heartbeat so staleness re-evaluates even when the desk stops delivering fresh polls.
  const [heartbeat, setHeartbeat] = useState(0);

  // Detection state (refs — never cause re-render).
  const prevSnapRef = useRef<SpxPulseSnapshot | null>(null);
  const seenRef = useRef<Record<string, number>>({}); // per-key cooldown
  const dedupRef = useRef<Record<string, number>>({}); // (kind, level) dedup
  const rateLedgerRef = useRef<number[]>([]); // global rate cap emit times
  const wallTrackerRef = useRef<WallBreakTracker>(emptyWallBreakTracker());
  const prevPlayRef = useRef<SpxPlayInput>(null);
  const seenSweepRef = useRef<Set<string>>(new Set());
  const idSeqRef = useRef(0);

  const push = (signals: PulseSignal[], now: number) => {
    if (!signals.length) return;
    const items: FeedItem[] = signals.map((s) => ({ ...s, id: `p${now}-${idSeqRef.current++}` }));
    const ids = items.map((i) => i.id);
    setFeed((cur) => [...items, ...cur].slice(0, SPX_PULSE_FEED_MAX));
    setFlashIds((cur) => {
      const nextSet = new Set(cur);
      for (const id of ids) nextSet.add(id);
      return nextSet;
    });
    window.setTimeout(() => {
      setFlashIds((cur) => {
        const nextSet = new Set(cur);
        for (const id of ids) nextSet.delete(id);
        return nextSet;
      });
    }, FLASH_MS);
  };

  // ── Core desk-tick detection ──
  useEffect(() => {
    if (!live || !desk?.available || !largoEnabled()) return;
    const voice = voiceSnapshotFromDesk(desk);
    const now = Date.now();
    const snap = buildSpxPulseSnapshot({
      voice,
      pin: pin ? { pin: pin.pin, pinPct: pin.pinPct, pinBand: pin.pinBand } : undefined,
      macroEvents: desk.macro_events,
      etMinute: etMinuteOfDay(new Date(now)),
      todayYmd: todayEtYmdClient(),
      vixTermStructure: desk.vix_term?.structure ?? null,
    });

    const raw: PulseSignal[] = detectSpxPulseSignals(prevSnapRef.current, snap);

    // Wall break (threaded hold tracker).
    const { tracker, breaks } = advanceWallBreakTracker(wallTrackerRef.current, snap);
    wallTrackerRef.current = tracker;
    raw.push(...breaks);

    // Sweeps from the desk flow tape (no extra fetch).
    for (const brief of desk.spx_flows ?? []) {
      const id = `${brief.strike}:${brief.expiry}:${brief.alerted_at}`;
      if (seenSweepRef.current.has(id)) continue;
      seenSweepRef.current.add(id);
      const s = sweepToPulseSignal(brief, now);
      if (s) raw.push(s);
    }
    if (seenSweepRef.current.size > 300) {
      seenSweepRef.current = new Set(Array.from(seenSweepRef.current).slice(-150));
    }

    prevSnapRef.current = snap;
    if (!raw.length) return;

    // Curation pipeline: per-key cooldown → (kind,level) dedup → global rate cap.
    const cooled = filterFreshPulseSignals(raw, seenRef.current, now);
    seenRef.current = cooled.seen;
    const deduped = dedupeByKindLevel(cooled.fresh, dedupRef.current, now);
    dedupRef.current = deduped.seen;
    const capped = applyGlobalRateCap(deduped.kept, rateLedgerRef.current, now);
    rateLedgerRef.current = capped.recent;

    // applyGlobalRateCap returns chronological; the feed renders newest-first, so reverse.
    push([...capped.emitted].reverse(), now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, live, pin]);

  // ── Play lifecycle ──
  useEffect(() => {
    if (!live || !largoEnabled()) return;
    const now = Date.now();
    const slice: SpxPlayInput = play
      ? {
          action: play.action ?? null,
          direction: play.direction ?? null,
          open_play: play.open_play
            ? { direction: play.open_play.direction, entry_price: play.open_play.entry_price }
            : null,
          contractLabel: play.option_ticket?.contract_label ?? null,
        }
      : null;
    const events = detectSpxPlaySignals(prevPlayRef.current, slice, now);
    prevPlayRef.current = slice;
    if (!events.length) return;
    const cooled = filterFreshPulseSignals(events, seenRef.current, now);
    seenRef.current = cooled.seen;
    if (cooled.fresh.length) push(cooled.fresh, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, live]);

  // ── Staleness heartbeat ──
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setHeartbeat((h) => h + 1), 10_000);
    return () => window.clearInterval(t);
  }, [live]);

  // ── Derived render state ──
  const polledAt = desk?.polled_at ? new Date(desk.polled_at).getTime() : null;
  const stale = useMemo(() => {
    void heartbeat; // re-evaluate on the heartbeat tick
    if (desk?.feed_stalled) return true;
    if (polledAt == null) return false;
    return Date.now() - polledAt > STALE_AFTER_MS;
  }, [polledAt, desk?.feed_stalled, heartbeat]);

  // Regime chip (from the current desk snapshot — always live, grounded).
  const regimeChip = useMemo(() => {
    if (!desk?.available) return null;
    const v = voiceSnapshotFromDesk(desk);
    if (v.aboveFlip == null) return null;
    const posture = v.aboveFlip ? "LONG GAMMA" : "SHORT GAMMA";
    const unstable =
      v.price != null && v.gammaFlip != null && Math.abs(v.price - v.gammaFlip) < SPX_REGIME_HYSTERESIS_PTS;
    const netG = desk.gex_net != null && Number.isFinite(desk.gex_net) ? fmtNotional(desk.gex_net) : null;
    const parts = [posture, unstable ? "UNSTABLE" : "STABLE"];
    if (netG) parts.push(`${netG} γ`);
    return { text: parts.join(" · "), bull: v.aboveFlip, unstable };
  }, [desk]);

  const visible = useMemo(() => feed.filter((s) => signalPassesFilter(s, filter)), [feed, filter]);
  const { pinned, stream } = useMemo(() => orderPulseFeed(visible), [visible]);
  const lastTier1 = useMemo(() => feed.find((s) => signalTier(s) === 1) ?? null, [feed]);

  // ── FOCUS MODE — slim vertical strip (effects above keep accumulating) ──
  if (focus) {
    const dir = regimeChip ? (regimeChip.bull ? "bull" : "bear") : "neutral";
    return (
      <aside className={clsx("spx-pulse-focus-rail", `spx-pulse-focus-rail--${dir}`)} aria-label={`SPX Pulse: ${regimeChip?.text ?? "standing by"}`} title={regimeChip?.text ?? "Pulse standing by"}>
        <span className="spx-pulse-focus-label" aria-hidden>PULSE</span>
        <span className="spx-pulse-focus-strip" aria-hidden />
      </aside>
    );
  }

  return (
    <aside className={clsx("spx-pulse-rail", stale && "spx-pulse-rail--stale", !live && "spx-pulse-rail--standby")} aria-label="SPX Pulse event feed">
      {/* ── HEADER ── */}
      <div className="spx-pulse-header">
        <div className="spx-pulse-title-row">
          <span className="spx-pulse-title">⚡ PULSE</span>
          {live && (
            <span className={clsx("spx-pulse-live", stale && "spx-pulse-live--stale")}>
              <span className="spx-pulse-live-dot" aria-hidden />
              {stale ? "QUIET" : "LIVE"}
            </span>
          )}
        </div>
        {regimeChip && (
          <div className={clsx("spx-pulse-regime-chip", regimeChip.bull ? "spx-pulse-regime-chip--bull" : "spx-pulse-regime-chip--bear", regimeChip.unstable && "spx-pulse-regime-chip--unstable")}>
            {regimeChip.text}
          </div>
        )}
        <div className="spx-pulse-filters" role="group" aria-label="Filter events">
          {SPX_PULSE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={clsx("spx-pulse-filter", filter === f.id && "spx-pulse-filter--active")}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="spx-pulse-viewport">
        {!live ? (
          <p className="spx-pulse-empty">Session closed — Pulse resumes at the open.</p>
        ) : (
          <>
            {/* PINNED TIER-1 */}
            {pinned.length > 0 && (
              <div className="spx-pulse-pinned" aria-label="Pinned regime-defining events">
                {pinned.map((item) => (
                  <PulseRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
                    flashing={flashIds.has(item.id)}
                  />
                ))}
              </div>
            )}

            {/* STREAM */}
            {stream.length > 0 ? (
              <div className="spx-pulse-stream">
                {stream.map((item) => (
                  <PulseRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
                    flashing={flashIds.has(item.id)}
                  />
                ))}
              </div>
            ) : pinned.length === 0 ? (
              <p className="spx-pulse-empty">Watching the tape — no events yet this session.</p>
            ) : null}

            {/* HONEST QUIET STATE */}
            <div className="spx-pulse-quiet">
              {lastTier1
                ? `structure holding — no Tier-1 events since ${fmtHm(lastTier1.at)}`
                : "structure holding — no Tier-1 events yet this session"}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
