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
import { etClock } from "@/lib/et-clock";
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
  /**
   * Chart-anchor seam (2026-07-26): the SPX desk mounts this rail beside the embedded Vector chart.
   * When present, clicking a Pulse event's "→ chart" affordance asks the chart to flash a transient
   * highlight line at that event's price level. Optional everywhere — when undefined the button is a
   * no-op affordance exactly as before (and rows with no level never render it). See SpxDashboard /
   * VectorChart `focusLevel`.
   */
  onFocusLevel?: (level: number, label: string, tone: PulseSignal["tone"]) => void;
};

/** Feed item = a fired signal plus a stable unique id for React keys / flash tracking. */
type FeedItem = PulseSignal & { id: string };

const STALE_AFTER_MS = 30_000;
const FLASH_MS = 1_200;
/** The quiet footer only shows once the newest Tier-1 event is at least this old. */
const QUIET_AFTER_MS = 3 * 60 * 1000;

// ET, like every other clock on this desk. These two omitted `timeZone` and so rendered in the
// VIEWER's zone — this rail sits directly beside the GEX matrix "as of", which is pinned to
// Eastern, so a member on the US West Coast read the two three hours apart. See lib/et-clock.ts.
function fmtClock(ms: number): string {
  return etClock(ms, { pad: true, seconds: true, hour12: false }) ?? "—";
}
function fmtHm(ms: number): string {
  return etClock(ms) ?? "—";
}

function toneClass(tone: PulseSignal["tone"]): string {
  return tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "warn" ? "text-amber-300" : "text-sky-300/90";
}

function PulseRow({
  item,
  expanded,
  onToggle,
  flashing,
  onFocusLevel,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  flashing: boolean;
  onFocusLevel?: (level: number, label: string, tone: PulseSignal["tone"]) => void;
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
          {/* Only render the jump affordance when the event actually carries a price level — a
              level-less event (e.g. a macro-window heads-up) has nothing to anchor, so we skip the
              button rather than show a dead control. When wired, clicking asks the sibling Vector
              chart to flash a transient highlight line at item.level (see onFocusLevel). */}
          {item.level != null && (
            <button
              type="button"
              className="spx-pulse-jump"
              title={`Jump to ${Math.round(item.level)} on the chart`}
              aria-label="Jump to chart"
              // Pass the SHORT kind badge (e.g. "WALL BREAK"), not item.line: item.line is a full
              // sentence that already carries its own glyph, so the chart's axis label — which
              // prefixes its own icon — would read "⚡ ⚡ Broke & held …" and overflow the narrow axis.
              onClick={() => onFocusLevel?.(item.level!, view.badge, item.tone)}
            >
              → chart
            </button>
          )}
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

export function SpxPulseRail({ desk, live, focus, onFocusLevel }: Props) {
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
  const playSeededRef = useRef(false); // false until the FIRST play observation (seed, don't fire)
  const seenSweepRef = useRef<Set<string>>(new Set());
  // Last processed desk tick (polled_at||as_of) — the detection block runs ONLY when the desk
  // actually changed, so a pin-only re-render can't advance the wall-break hold counter.
  const deskTickRef = useRef<string | null>(null);
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
    // Run ONLY on a genuine desk change — a pin-only re-render (5s pin SWR, unchanged desk)
    // must not advance the wall-break hold counter, so "held 3 polls" means 3 real desk ticks.
    const deskTick = desk.polled_at ?? desk.as_of ?? null;
    if (deskTick != null && deskTickRef.current === deskTick) return;
    // First observation this mount (fresh page OR rail-toggle remount) — seed sweeps silently.
    const firstTick = prevSnapRef.current === null;
    deskTickRef.current = deskTick;

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

    // Sweeps from the desk flow tape (no extra fetch). On the FIRST observation we seed the
    // seen-set WITHOUT emitting — else every pre-existing ≥$1M brief would flash stale-as-fresh
    // at mount. New prints on later ticks are timestamped from brief.alerted_at (see engine).
    for (const brief of desk.spx_flows ?? []) {
      const id = `${brief.strike}:${brief.expiry}:${brief.alerted_at}`;
      const alreadySeen = seenSweepRef.current.has(id);
      seenSweepRef.current.add(id);
      if (alreadySeen || firstTick) continue;
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
    // Seed on the FIRST observation (mount OR rail-toggle remount resets prevPlayRef to null):
    // an already-OPEN play must NOT emit a false "FIRED/ARMED" stamped now.
    const hadPrev = playSeededRef.current;
    playSeededRef.current = true;
    const events = detectSpxPlaySignals(prevPlayRef.current, slice, now, hadPrev);
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
  // The honest quiet footer only appears once the tape has ACTUALLY gone quiet — hidden right
  // after a Tier-1 fires (else it would contradict a fresh pinned regime-flip/wall-break).
  const showQuiet = useMemo(() => {
    void heartbeat; // re-evaluate on the heartbeat tick as a fresh Tier-1 ages out
    return !lastTier1 || Date.now() - lastTier1.at > QUIET_AFTER_MS;
  }, [lastTier1, heartbeat]);

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
                    onFocusLevel={onFocusLevel}
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
                    onFocusLevel={onFocusLevel}
                  />
                ))}
              </div>
            ) : pinned.length === 0 ? (
              <p className="spx-pulse-empty">Watching the tape — no events yet this session.</p>
            ) : null}

            {/* HONEST QUIET STATE — only once the tape has genuinely gone quiet. */}
            {showQuiet && (
              <div className="spx-pulse-quiet">
                {lastTier1
                  ? `structure holding — no Tier-1 events since ${fmtHm(lastTier1.at)}`
                  : "structure holding — no Tier-1 events yet this session"}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
