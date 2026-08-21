"use client";

/**
 * Meridian visualization primitives — the shared analytics vocabulary for the whole desk.
 *
 * Three rules every primitive here follows:
 *
 * 1. NO DATA, NO MARK. Each component returns null (or an explicit "no data" affordance the
 *    caller places) rather than drawing a zero, an empty ring or a flat line. A chart that
 *    renders confidently from missing data is worse than an absent chart, because it looks
 *    authoritative. All the null handling lives in meridian-viz-core, which is unit-tested.
 *
 * 2. MOTION ENCODES CHANGE. Transitions run on `transform` and `opacity` only — both are
 *    compositor-driven, so a rail with 40 markers still moves at 60fps. Nothing animates on
 *    mount-for-decoration; things move when a value moves. Every animation is disabled under
 *    `prefers-reduced-motion` via the stylesheet.
 *
 * 3. GEOMETRY IS DERIVED, NEVER TEMPLATED. Levels are positioned by their numbers (see
 *    `structureLadder`), so an inverted book renders inverted instead of being forced into the
 *    order a designer assumed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  arcPath,
  beatSeries,
  beatTally,
  clamp,
  countdownTo,
  darkPoolTape,
  estimateDispersion,
  estimateTrajectory,
  haloFromSignals,
  impliedVsRealized,
  layoutRailLabels,
  strikeProfile,
  normalizeMoveBand,
  num,
  pctAlong,
  priceDomain,
  resolveCollisions,
  MV_LADDER_MIN_GAP,
  revisionMomentum,
  sparklinePoints,
  structureLadder,
  targetRail,
  LIVE_SIGNAL_GLYPH,
  LIVE_SIGNAL_LABEL,
  type Domain,
  type LiveSignal,
  type PrintLike,
  type SignalLike,
} from "@/lib/meridian/meridian-viz-core";

type Lean = "bullish" | "bearish" | "neutral";

const LEAN_CLASS: Record<Lean, string> = {
  bullish: "mv-bull",
  bearish: "mv-bear",
  neutral: "mv-neutral",
};

function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  return v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(2) : v.toFixed(3);
}
function fmtSignedPct(v: number | null, dp = 1): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

/* ── Count-up number ──────────────────────────────────────────────────────────────────
 * Interpolates to a new value so a changed metric reads as *having changed* rather than
 * silently swapping. Uses rAF (not a CSS transition) because the element's TEXT changes, not a
 * style — and cancels on unmount so a ticker switch mid-flight cannot write into a dead node.
 */
export function MeridianCountUp({
  value,
  decimals = 0,
  durationMs = 520,
  className,
  prefix = "",
  suffix = "",
}: {
  value: number | null;
  decimals?: number;
  durationMs?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const fromRef = useRef<number | null>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === null) {
      setShown(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current;
    // First paint, or arriving from "no data": land on the value. Counting up from an
    // imaginary zero would animate a number the data never held.
    if (from === null) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    if (from === value) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = clamp((now - start) / durationMs, 0, 1);
      const eased = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {shown === null ? "—" : `${prefix}${shown.toFixed(decimals)}${suffix}`}
    </span>
  );
}

/* ── Live signal chip ─────────────────────────────────────────────────────────────── */
export function MeridianSignalChip({ signal, detail }: { signal: LiveSignal; detail?: string }) {
  return (
    <span className={`mv-chip mv-chip-${signal}`} title={detail ?? LIVE_SIGNAL_LABEL[signal]}>
      <span className="mv-chip-glyph" aria-hidden="true">
        {LIVE_SIGNAL_GLYPH[signal]}
      </span>
      {LIVE_SIGNAL_LABEL[signal]}
    </span>
  );
}

/* ── Intelligence halo ────────────────────────────────────────────────────────────────
 * A segmented ring where each signal owns arc proportional to its weight, plus an inner
 * AGREEMENT arc. The agreement number is the reason this is a halo and not a score: a
 * "bullish 68" from ten aligned signals and one from six-vs-four are different setups that a
 * single number cannot distinguish. Conflict shows as a ring of mixed colour with a short
 * inner arc; consensus shows as a near-solid ring with a long one.
 */
export function MeridianHalo({
  signals,
  score,
  verdict,
  confidence,
  size = 168,
  onSegmentClick,
}: {
  signals: readonly SignalLike[] | null | undefined;
  score: number | null;
  verdict: Lean;
  confidence?: string | null;
  size?: number;
  onSegmentClick?: (index: number) => void;
}) {
  const halo = useMemo(() => haloFromSignals(signals), [signals]);
  if (!halo) return null;

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 10;
  const rInner = rOuter - 16;
  const GAP = 1.6; // degrees of breathing room so adjacent same-lean segments stay countable

  let cursor = 0;
  const arcs = halo.segments.map((seg, i) => {
    const sweep = seg.fraction * 360;
    const path = arcPath(cx, cy, rOuter, cursor + GAP / 2, cursor + sweep - GAP / 2);
    cursor += sweep;
    return { path, lean: seg.lean as Lean, i };
  });

  const agreementArc = arcPath(cx, cy, rInner, 0, Math.max(halo.agreement * 360, 0.001));

  return (
    <div className="mv-halo" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
           aria-label={`${verdict} ${score ?? ""}, ${Math.round(halo.agreement * 100)}% signal agreement`}>
        <circle cx={cx} cy={cy} r={rOuter} className="mv-halo-track" />
        {arcs.map((a) => (
          <path
            key={a.i}
            d={a.path}
            className={`mv-halo-seg ${LEAN_CLASS[a.lean]}${onSegmentClick ? " mv-halo-seg-click" : ""}`}
            style={{ animationDelay: `${a.i * 42}ms` }}
            onClick={onSegmentClick ? () => onSegmentClick(a.i) : undefined}
          />
        ))}
        <circle cx={cx} cy={cy} r={rInner} className="mv-halo-track mv-halo-track-inner" />
        <path d={agreementArc} className={`mv-halo-agree ${LEAN_CLASS[halo.dominant as Lean]}`} />
      </svg>
      <div className="mv-halo-center">
        <span className={`mv-halo-verdict ${LEAN_CLASS[verdict]}`}>{verdict}</span>
        <MeridianCountUp className="mv-halo-score" value={num(score)} />
        <span className="mv-halo-agreement">
          {Math.round(halo.agreement * 100)}% agree{confidence ? ` · ${confidence}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ── Concentric dimension rings ───────────────────────────────────────────────────── */
export function MeridianRing({
  label,
  value,
  max = 100,
  lean = "neutral",
  size = 58,
  signal,
}: {
  label: string;
  value: number | null;
  max?: number;
  lean?: Lean;
  size?: number;
  signal?: LiveSignal | null;
}) {
  const v = num(value);
  const cx = size / 2;
  const r = size / 2 - 5;
  const pct = v === null || max <= 0 ? 0 : clamp(v / max, 0, 1);
  return (
    <div className="mv-ring" title={`${label}: ${v ?? "no data"}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} className="mv-ring-track" />
        {/* No arc at all when there is no value — an empty ring is honest, a full grey one is not. */}
        {v !== null && <path d={arcPath(cx, cx, r, 0, Math.max(pct * 360, 0.001))} className={`mv-ring-arc ${LEAN_CLASS[lean]}`} />}
      </svg>
      <div className="mv-ring-body">
        <span className="mv-ring-label">{label}</span>
        <span className={`mv-ring-value ${LEAN_CLASS[lean]}`}>
          {v === null ? "—" : <MeridianCountUp value={v} />}
          {signal && <span className="mv-ring-sig" aria-hidden="true">{LIVE_SIGNAL_GLYPH[signal]}</span>}
        </span>
      </div>
    </div>
  );
}

/* ── Expected move rail ───────────────────────────────────────────────────────────────
 * Overlay markers (walls, targets) are folded into the DOMAIN, not just drawn on it — see
 * `priceDomain`. Passing only the band and then plotting a wall outside it makes the wall pin
 * to the rail's edge, which reads as "the wall is exactly at the boundary": a specific false
 * claim rather than a missing one.
 */
export type RailMarker = { value: number | null; label: string; kind?: "wall" | "target" | "level" };

/**
 * Live width of an element, for layout that depends on how much room the text actually has.
 *
 * Rail labels have to be placed against a REAL pixel width — the same rail is ~640px on desktop
 * and ~330px on a phone, and a label set that fits comfortably at one is a garbled overlap at
 * the other. Starts at 0 (SSR has no layout) and every consumer treats 0 as "not measured yet"
 * rather than "infinitely tight".
 */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Only re-render on a change big enough to move a label; sub-pixel jitter during a
      // transition would otherwise re-run the placement every frame.
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Approximate advance of the 0.46rem mono face the rail labels are set in. */
const RAIL_LABEL_CHAR_PX = 4.9;

export function MeridianMoveRail({
  band,
  movePct,
  markers = [],
  source,
}: {
  band: { spot?: number | null; up?: number | null; down?: number | null } | null | undefined;
  movePct?: number | null;
  markers?: RailMarker[];
  source?: string | null;
}) {
  const { ref: trackRef, width: trackW } = useElementWidth<HTMLDivElement>();
  const mb = useMemo(() => normalizeMoveBand(band, movePct), [band, movePct]);
  const usable = useMemo(() => markers.filter((m) => num(m.value) !== null), [markers]);
  const domain: Domain | null = useMemo(
    () => (mb ? priceDomain([mb.down, mb.up, mb.spot, ...usable.map((m) => m.value)]) : null),
    [mb, usable]
  );
  // Label placement needs the track's real width, so it is computed in the body (after the
  // early return would have fired) — hooks must run unconditionally, hence the hook above.
  const ticks = useMemo(
    () => (domain ? usable.map((m) => pctAlong(m.value, domain) ?? 0) : []),
    [usable, domain]
  );
  const slots = useMemo(() => {
    // Before the first measurement there is no honest width to lay out against; centring every
    // label on its tick is the same thing the component did before, and it is corrected on the
    // very next frame. Guessing a width would move labels twice on load.
    if (!trackW) return usable.map((_, i) => ({ pos: ticks[i] ?? 0, tier: 0 }));
    return layoutRailLabels(
      usable.map((m, i) => ({
        pos: ticks[i] ?? 0,
        widthFrac: (String(m.label).length * RAIL_LABEL_CHAR_PX + 6) / trackW,
      }))
    );
  }, [usable, ticks, trackW]);

  if (!mb || !domain) return null;

  const left = pctAlong(mb.down, domain)!;
  const right = pctAlong(mb.up, domain)!;
  const spotPct = pctAlong(mb.spot, domain)!;
  // One extra row of headroom per occupied tier, so a staggered label never lands on the panel
  // title above the rail.
  const tiers = slots.reduce((mx, s) => Math.max(mx, s.tier), 0) + 1;

  return (
    <div className="mv-rail" style={{ ["--rail-tiers" as string]: tiers }}>
      <div className="mv-rail-head">
        <span className="mv-rail-title">Expected move</span>
        <span className="mv-rail-pct">±{mb.pct?.toFixed(1) ?? "—"}%{source ? ` · ${source}` : ""}</span>
      </div>
      <div className="mv-rail-track" ref={trackRef}>
        <div
          className="mv-rail-band"
          style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
        />
        {usable.map((m, i) => {
          const p = ticks[i]!;
          const slot = slots[i]!;
          return (
            <div
              key={`${m.label}-${i}`}
              className={`mv-rail-marker mv-rail-marker-${m.kind ?? "level"}`}
              style={{ left: `${p * 100}%` }}
              title={`${m.label} ${fmtPrice(num(m.value))}`}
            >
              <span className="mv-rail-marker-tick" />
              {/* The TICK stays on the true price; only the LABEL is moved and tiered, so the
                  rail never lies about where a level is. --dx is the label's own offset from
                  its tick, in track-fractions converted to px by the track width. */}
              <span
                className="mv-rail-marker-label"
                style={{
                  ["--dx" as string]: `${(slot.pos - p) * (trackW || 0)}px`,
                  ["--tier" as string]: slot.tier,
                }}
              >
                {/* The NUMBER ships with the label. A rail that says "max pain" without saying
                    where max pain IS forces the reader to eyeball a pixel position against an
                    axis — which is the one thing a chart exists to spare them. */}
                {m.label} <b className="mv-rail-marker-num">{fmtPrice(num(m.value))}</b>
              </span>
            </div>
          );
        })}
        <div className="mv-rail-spot" style={{ left: `${spotPct * 100}%` }}>
          <span className="mv-rail-spot-dot" />
          <span className="mv-rail-spot-label">spot {fmtPrice(mb.spot)}</span>
        </div>
      </div>
      <div className="mv-rail-bounds">
        <span className="mv-bear">{fmtPrice(mb.down)}</span>
        <span className="mv-bull">{fmtPrice(mb.up)}</span>
      </div>
    </div>
  );
}

/* ── Dealer structure ladder ───────────────────────────────────────────────────────── */
export function MeridianStructureLadder({
  thermal,
  onLevelHover,
}: {
  thermal: Parameters<typeof structureLadder>[0];
  onLevelHover?: (value: number | null) => void;
}) {
  const levels = useMemo(() => structureLadder(thermal), [thermal]);
  const domain = useMemo(() => priceDomain(levels.map((l) => l.value)), [levels]);
  // Rows carry their true price, but two levels a few cents apart land on the same pixel and
  // print on top of each other — measured live: king node 780 and max pain 775 resolved 7px
  // apart in a 132px ladder. The resolver nudges them apart while PRESERVING ORDER, so spatial
  // truth survives; only the drawn position moves, never the value.
  //
  // The gap is one ROW HEIGHT, and it now comes from MV_LADDER_MIN_GAP rather than a literal.
  // The literal said 16/132; rows render at 20.5px, so every adjacent pair overlapped by 4-11px
  // on live prod. See the note on MV_LADDER_ROW_PX for the measurements.
  const placed = useMemo(() => {
    if (!domain) return [];
    return resolveCollisions(
      levels.map((l) => 1 - (pctAlong(l.value, domain) ?? 0)),
      MV_LADDER_MIN_GAP
    );
  }, [levels, domain]);
  if (levels.length < 2 || !domain) return null;

  return (
    <div className="mv-ladder">
      {levels.map((l, idx) => {
        const p = placed[idx] ?? 0;
        // Buttons, not divs with hover handlers. Cross-highlighting a level across the other
        // panels is a real interaction, so it has to reach a keyboard too — `onFocus` mirrors
        // `onMouseEnter` and Tab order comes free. A div with onMouseEnter would put this
        // behind a pointer only, which on a trading surface is a genuine exclusion, not a
        // lint technicality.
        return (
          <button
            type="button"
            key={l.key}
            className={`mv-ladder-row mv-ladder-${l.key}`}
            style={{ ["--mv-pos" as string]: `${p * 100}%` }}
            onMouseEnter={() => onLevelHover?.(l.value)}
            onMouseLeave={() => onLevelHover?.(null)}
            onFocus={() => onLevelHover?.(l.value)}
            onBlur={() => onLevelHover?.(null)}
            disabled={!onLevelHover}
            aria-label={`${l.label} ${fmtPrice(l.value)}${l.distPct === null ? "" : `, ${fmtSignedPct(l.distPct)} from spot`}`}
          >
            <span className="mv-ladder-label">{l.label}</span>
            <span className="mv-ladder-bar" />
            <span className="mv-ladder-value">{fmtPrice(l.value)}</span>
            <span className={`mv-ladder-dist ${l.distPct === null ? "" : l.distPct >= 0 ? "mv-bull" : "mv-bear"}`}>
              {l.key === "spot" ? "" : fmtSignedPct(l.distPct)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Earnings beat history ─────────────────────────────────────────────────────────── */
export function MeridianBeatHistory({
  prints,
  onSelect,
}: {
  prints: readonly PrintLike[] | null | undefined;
  onSelect?: (p: PrintLike) => void;
}) {
  const series = useMemo(() => beatSeries(prints), [prints]);
  const tally = useMemo(() => beatTally(series), [series]);
  if (series.length === 0) return null;

  return (
    <div className="mv-beats">
      <div className="mv-beats-head">
        <span className="mv-beats-title">Earnings track record</span>
        <span className="mv-beats-tally">
          {tally.graded > 0 ? `${tally.beats} / ${tally.graded} EPS beats` : "not yet graded"}
        </span>
      </div>
      <div className="mv-beats-rows">
        {series.map((p, i) => (
          <button
            type="button"
            key={p.date ?? i}
            className="mv-beat-row"
            onClick={onSelect && prints ? () => onSelect(prints[i]!) : undefined}
            disabled={!onSelect}
            title={
              p.reactionAssumed
                ? "Reaction measured on the report date — print timing unknown, so this may be pre-print drift"
                : undefined
            }
          >
            <span className="mv-beat-date">{p.date?.slice(2) ?? "—"}</span>
            <span className="mv-beat-track">
              <span
                className={`mv-beat-bar ${p.beat === null ? "mv-neutral" : p.beat ? "mv-bull" : "mv-bear"}`}
                style={{ transform: `scaleX(${p.magnitude})` }}
              />
            </span>
            <span className={`mv-beat-surprise ${p.beat === null ? "" : p.beat ? "mv-bull" : "mv-bear"}`}>
              {p.surprisePct === null ? "—" : fmtSignedPct(p.surprisePct)}
            </span>
            <span className={`mv-beat-reaction ${p.reactionPct === null ? "" : p.reactionPct >= 0 ? "mv-bull" : "mv-bear"}`}>
              {fmtSignedPct(p.reactionPct)}
              {/* An assumed anchoring is marked, never silently presented as measured. */}
              {p.reactionAssumed && <span className="mv-beat-assumed" aria-hidden="true">~</span>}
            </span>
          </button>
        ))}
      </div>
      {series.some((p) => p.reactionAssumed) && (
        <p className="mv-note">~ reaction measured on the report session; print timing unknown</p>
      )}
    </div>
  );
}

/* ── Analyst revision momentum ─────────────────────────────────────────────────────── */
export function MeridianRevisionMomentum({
  skew,
  onExpand,
}: {
  skew: Parameters<typeof revisionMomentum>[0];
  onExpand?: () => void;
}) {
  const m = useMemo(() => revisionMomentum(skew), [skew]);
  if (!m) return null;
  const pct = (n: number) => (m.total > 0 ? (n / m.total) * 100 : 0);
  return (
    <div className="mv-rev">
      <div className="mv-rev-head">
        <span className="mv-rev-title">Analyst momentum</span>
        <span className={`mv-rev-skew ${LEAN_CLASS[m.skew]}`}>{m.skew}</span>
      </div>
      <div className="mv-rev-bar" role="img" aria-label={`${m.raised} raised, ${m.lowered} lowered, ${m.initiated} initiated`}>
        <span className="mv-rev-seg mv-bull" style={{ width: `${pct(m.raised)}%` }} />
        <span className="mv-rev-seg mv-neutral" style={{ width: `${pct(m.initiated)}%` }} />
        <span className="mv-rev-seg mv-bear" style={{ width: `${pct(m.lowered)}%` }} />
      </div>
      <div className="mv-rev-legend">
        <span className="mv-bull">{m.raised} ↑</span>
        <span className="mv-neutral">{m.initiated} →</span>
        <span className="mv-bear">{m.lowered} ↓</span>
        {onExpand && (
          <button type="button" className="mv-rev-more" onClick={onExpand}>
            revisions
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Price target rail ─────────────────────────────────────────────────────────────── */
export function MeridianTargetRail({
  targets,
  spot,
  onTargetClick,
}: {
  targets: Parameters<typeof targetRail>[0];
  spot?: number | null;
  onTargetClick?: (t: { value: number; firm: string | null }) => void;
}) {
  const rail = useMemo(() => targetRail(targets, spot), [targets, spot]);
  const domain = useMemo(
    () => (rail ? priceDomain([rail.low, rail.high, rail.spot]) : null),
    [rail]
  );
  if (!rail || !domain) return null;

  return (
    <div className="mv-targets">
      <div className="mv-rail-head">
        <span className="mv-rail-title">Price targets</span>
        {rail.upsidePct !== null && (
          <span className={rail.upsidePct >= 0 ? "mv-bull" : "mv-bear"}>
            {fmtSignedPct(rail.upsidePct)} to consensus
          </span>
        )}
      </div>
      <div className="mv-rail-track">
        <span
          className="mv-targets-span"
          style={{
            left: `${pctAlong(rail.low, domain)! * 100}%`,
            width: `${(pctAlong(rail.high, domain)! - pctAlong(rail.low, domain)!) * 100}%`,
          }}
        />
        {rail.targets.map((t, i) => (
          <button
            type="button"
            key={`${t.value}-${i}`}
            className="mv-target-dot"
            style={{ left: `${pctAlong(t.value, domain)! * 100}%` }}
            title={`${t.firm ?? "target"} ${fmtPrice(t.value)}${t.action ? ` · ${t.action}` : ""}`}
            onClick={onTargetClick ? () => onTargetClick({ value: t.value, firm: t.firm }) : undefined}
            disabled={!onTargetClick}
          />
        ))}
        <span className="mv-target-consensus" style={{ left: `${pctAlong(rail.consensus, domain)! * 100}%` }}>
          <span className="mv-target-consensus-tick" />
          <span className="mv-target-consensus-label">{fmtPrice(rail.consensus)}</span>
        </span>
        {rail.spot !== null && (
          <span className="mv-rail-spot" style={{ left: `${pctAlong(rail.spot, domain)! * 100}%` }}>
            <span className="mv-rail-spot-dot" />
            <span className="mv-rail-spot-label">spot</span>
          </span>
        )}
      </div>
      <div className="mv-rail-bounds">
        <span>{fmtPrice(rail.low)}</span>
        <span>{fmtPrice(rail.high)}</span>
      </div>
    </div>
  );
}

/* ── Dark pool tape ───────────────────────────────────────────────────────────────────
 * Marks are area-proportional (sqrt of the premium ratio, see `darkPoolTape`) because size
 * judgement tracks area — mapping premium linearly to a diameter makes a 4x print look 16x.
 */
export function MeridianDarkPoolTape({
  prints,
  totalLabel,
  onPrintClick,
}: {
  prints: Parameters<typeof darkPoolTape>[0];
  totalLabel?: string | null;
  onPrintClick?: (p: { premium: number; strike: number | null; at: string | null }) => void;
}) {
  const tape = useMemo(() => darkPoolTape(prints), [prints]);
  if (tape.length === 0) return null;
  const MAX = 34;
  const MIN = 8;
  return (
    <div className="mv-tape">
      <div className="mv-rail-head">
        <span className="mv-rail-title">Dark pool</span>
        {totalLabel && <span className="mv-tape-total">{totalLabel}</span>}
      </div>
      <div className="mv-tape-strip">
        {tape.map((p, i) => {
          const d = MIN + p.magnitude * (MAX - MIN);
          return (
            <button
              type="button"
              key={`${p.at ?? i}-${p.premium}`}
              className="mv-tape-print"
              style={{ width: d, height: d, animationDelay: `${i * 30}ms` }}
              title={`${p.label ?? p.premium} ${p.strike ? `@ ${fmtPrice(p.strike)}` : ""}${p.at ? ` · ${p.at}` : ""}`}
              onClick={onPrintClick ? () => onPrintClick({ premium: p.premium, strike: p.strike, at: p.at }) : undefined}
              disabled={!onPrintClick}
            />
          );
        })}
      </div>
      <p className="mv-note">largest first · area ∝ premium</p>
    </div>
  );
}

/* ── Countdown ────────────────────────────────────────────────────────────────────────
 * Ticks on a 60s interval, not 1s: the display's smallest unit is minutes, so a per-second
 * timer would re-render 59 times for no visible change.
 */
export function MeridianCountdown({ targetIso, label }: { targetIso: string | null | undefined; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const c0 = countdownTo(targetIso, now);
  // Inside an hour the clock shows SECONDS and ticks every second; outside it, once a minute is
  // enough. A minutes-only readout that changes at most once a minute is indistinguishable from
  // a frozen one — the countdown has to LOOK live on an event clock, which is most of what it
  // is for. Reported live as "the earnings timer does not update".
  const showSeconds = Boolean(c0 && !c0.past && c0.totalMs < 3_600_000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), showSeconds ? 1_000 : 15_000);
    return () => clearInterval(id);
  }, [showSeconds]);
  const c = c0;
  if (!c) return null;
  const imminent = !c.past && c.totalMs < 24 * 3_600_000;
  const seconds = Math.floor((c.totalMs % 60_000) / 1000);
  return (
    <div className={`mv-countdown${imminent ? " mv-countdown-imminent" : ""}${c.past ? " mv-countdown-past" : ""}`}>
      <span className="mv-countdown-label">{c.past ? "reported" : label ?? "Earnings"}</span>
      <span className="mv-countdown-clock">
        {String(c.days).padStart(2, "0")}<i>d</i> {String(c.hours).padStart(2, "0")}<i>h</i>{" "}
        {String(c.minutes).padStart(2, "0")}<i>m</i>
        {showSeconds && (
          <>
            {" "}
            {String(seconds).padStart(2, "0")}
            <i>s</i>
          </>
        )}
        {c.past && <span className="mv-countdown-ago"> ago</span>}
      </span>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────────────────────── */
export function MeridianSparkline({
  values,
  width = 72,
  height = 20,
  lean = "neutral",
}: {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  lean?: Lean;
}) {
  const pts = useMemo(() => sparklinePoints(values, width, height), [values, width, height]);
  if (!pts) return null;
  return (
    <svg className={`mv-spark ${LEAN_CLASS[lean]}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

/* ── Estimate trajectory ──────────────────────────────────────────────────────────────
 * Paired estimate/actual bars per period on ONE shared scale (see `estimateTrajectory` —
 * per-series scaling would make a miss look like a beat). Forward periods render the estimate
 * alone with a distinct treatment, so "not reported yet" never reads as "came in at zero".
 */
export function MeridianTrajectory({
  rows,
  title,
  format = (v) => v.toFixed(2),
  onSelect,
}: {
  rows: Parameters<typeof estimateTrajectory>[0];
  title: string;
  format?: (v: number) => string;
  onSelect?: (period: string) => void;
}) {
  const pts = useMemo(() => estimateTrajectory(rows), [rows]);
  if (pts.length === 0) return null;
  return (
    <div className="mv-traj">
      <span className="mv-rail-title">{title}</span>
      <div className="mv-traj-rows">
        {pts.map((p) => (
          <button
            type="button"
            key={p.period}
            className={`mv-traj-row${p.forward ? " is-forward" : ""}`}
            onClick={onSelect ? () => onSelect(p.period) : undefined}
            disabled={!onSelect}
            title={
              p.forward
                ? `${p.period} · estimate ${p.estimate === null ? "—" : format(p.estimate)} · not reported`
                : `${p.period} · est ${p.estimate === null ? "—" : format(p.estimate)} → act ${p.actual === null ? "—" : format(p.actual)}`
            }
          >
            <span className="mv-traj-period">{p.period}</span>
            <span className="mv-traj-bars">
              {p.estHeight !== null && (
                <span className="mv-traj-est" style={{ transform: `scaleX(${p.estHeight})` }} />
              )}
              {p.actHeight !== null && (
                <span
                  className={`mv-traj-act ${p.surprisePct === null ? "mv-neutral" : p.surprisePct >= 0 ? "mv-bull" : "mv-bear"}`}
                  style={{ transform: `scaleX(${p.actHeight})` }}
                />
              )}
            </span>
            <span className="mv-traj-val">{p.actual !== null ? format(p.actual) : p.estimate !== null ? format(p.estimate) : "—"}</span>
            <span
              className={`mv-traj-surprise ${p.surprisePct === null ? "" : p.surprisePct >= 0 ? "mv-bull" : "mv-bear"}`}
            >
              {p.forward ? "est" : p.surprisePct === null ? "—" : `${p.surprisePct >= 0 ? "+" : ""}${p.surprisePct.toFixed(1)}%`}
            </span>
          </button>
        ))}
      </div>
      <p className="mv-note">bar = estimate · fill = actual · shared scale</p>
    </div>
  );
}

/* ── Estimate dispersion rail ─────────────────────────────────────────────────────── */
export function MeridianDispersion({
  values,
  label,
  format = (v) => v.toFixed(2),
}: {
  values: Array<number | null | undefined>;
  label: string;
  format?: (v: number) => string;
}) {
  const d = useMemo(() => estimateDispersion(values), [values]);
  const domain = useMemo(() => (d ? priceDomain([d.low, d.high]) : null), [d]);
  // One estimate is a number, not a distribution — drawing a rail for it would imply a
  // consensus that does not exist.
  if (!d || !domain || d.n < 2) return null;
  return (
    <div className="mv-disp">
      <div className="mv-rail-head">
        <span className="mv-rail-title">{label}</span>
        <span className="mv-rail-pct">
          {d.n} estimates{d.spreadPct !== null ? ` · ${d.spreadPct.toFixed(0)}% spread` : ""}
        </span>
      </div>
      <div className="mv-disp-track">
        <span
          className="mv-disp-span"
          style={{
            left: `${pctAlong(d.low, domain)! * 100}%`,
            width: `${(pctAlong(d.high, domain)! - pctAlong(d.low, domain)!) * 100}%`,
          }}
        />
        <span className="mv-disp-median" style={{ left: `${pctAlong(d.median, domain)! * 100}%` }} />
      </div>
      <div className="mv-rail-bounds">
        <span>{format(d.low)}</span>
        <span className="mv-neutral">{format(d.median)}</span>
        <span>{format(d.high)}</span>
      </div>
    </div>
  );
}

/* ── Strike exposure profile ──────────────────────────────────────────────────────── */
export function MeridianStrikeProfile({
  rows,
  spot,
  title = "Strike exposure",
  onStrikeHover,
}: {
  rows: Parameters<typeof strikeProfile>[0];
  spot?: number | null;
  title?: string;
  onStrikeHover?: (strike: number | null) => void;
}) {
  const bars = useMemo(() => strikeProfile(rows, spot), [rows, spot]);
  if (bars.length === 0) return null;
  return (
    <div className="mv-strikes">
      <span className="mv-rail-title">{title}</span>
      <div className="mv-strikes-rows">
        {bars.map((b) => (
          <button
            type="button"
            key={b.strike}
            className={`mv-strike-row${b.atSpot ? " is-spot" : ""}`}
            onMouseEnter={() => onStrikeHover?.(b.strike)}
            onMouseLeave={() => onStrikeHover?.(null)}
            onFocus={() => onStrikeHover?.(b.strike)}
            onBlur={() => onStrikeHover?.(null)}
            disabled={!onStrikeHover}
            title={`${b.strike} · ${b.pct > 0 ? "+" : ""}${b.pct.toFixed(1)}% of book`}
          >
            <span className="mv-strike-k">{b.strike}</span>
            {/* Diverging from a centre line: calls right, puts left. A single-direction bar
                would need colour alone to carry sign, which fails for colour-blind readers. */}
            <span className="mv-strike-track">
              <span className="mv-strike-zero" />
              <span
                className={`mv-strike-bar ${b.side === "call" ? "mv-bull" : b.side === "put" ? "mv-bear" : "mv-neutral"}`}
                style={
                  b.side === "put"
                    ? { right: "50%", width: `${b.magnitude * 50}%` }
                    : { left: "50%", width: `${b.magnitude * 50}%` }
                }
              />
            </span>
            <span className="mv-strike-pct">{b.pct > 0 ? "+" : ""}{b.pct.toFixed(1)}%</span>
          </button>
        ))}
      </div>
      <p className="mv-note">left = dealer short (support) · right = long (resistance)</p>
    </div>
  );
}

/* ── Implied vs realized ──────────────────────────────────────────────────────────────
 * The sharpest question on the desk, and one that was unanswerable until the reaction data
 * was recovered: is the options market pricing a bigger move than this name actually makes?
 */
export function MeridianImpliedVsRealized({
  impliedPct,
  moves,
}: {
  impliedPct: number | null | undefined;
  moves: Array<number | null | undefined>;
}) {
  const r = useMemo(() => impliedVsRealized(impliedPct, moves), [impliedPct, moves]);
  if (!r) return null;
  const scaleMax = Math.max(r.impliedPct, ...r.realized) * 1.1;
  const pos = (v: number) => (scaleMax > 0 ? clamp(v / scaleMax, 0, 1) * 100 : 0);
  const verdictClass = r.verdict === "rich" ? "mv-bear" : r.verdict === "cheap" ? "mv-bull" : "mv-neutral";
  return (
    <div className="mv-ivr">
      <div className="mv-rail-head">
        <span className="mv-rail-title">Implied vs realized</span>
        <span className={verdictClass}>
          {r.verdict === "rich" ? "options rich" : r.verdict === "cheap" ? "options cheap" : "fairly priced"}
        </span>
      </div>
      <div className="mv-ivr-track">
        {/* Each past move as a tick — the distribution, not a summary of it. */}
        {r.realized.map((m, i) => (
          <span key={`${m}-${i}`} className="mv-ivr-tick" style={{ left: `${pos(m)}%` }} title={`realized ${m.toFixed(1)}%`} />
        ))}
        <span className="mv-ivr-median" style={{ left: `${pos(r.medianRealized)}%` }} title={`median ${r.medianRealized}%`} />
        <span className={`mv-ivr-implied ${verdictClass}`} style={{ left: `${pos(r.impliedPct)}%` }} title={`implied ${r.impliedPct}%`} />
      </div>
      <div className="mv-ivr-legend">
        <span>median realized <b className="mv-neutral">{r.medianRealized}%</b></span>
        <span>implied <b className={verdictClass}>{r.impliedPct}%</b></span>
        <span>{Math.round(r.exceedRate * 100)}% of prints exceeded it</span>
      </div>
      <p className="mv-note">n = {r.n} prints · absolute moves</p>
    </div>
  );
}

/* ── Freshness ────────────────────────────────────────────────────────────────────── */

/**
 * "updated 12s ago", ticking.
 *
 * The desk WAS refreshing — SWR on a 15–300s interval depending on proximity — but nothing on
 * screen ever proved it, so a payload that legitimately did not change read as a frozen page.
 * This is the cheapest honest fix: it states when the data last arrived, and it counts, so the
 * page visibly disagrees with "nothing is happening".
 *
 * It reports the AGE OF THE DATA, not the age of the render. A component that merely animated
 * would be theatre — it would keep ticking happily while the feed was dead, which is the exact
 * failure a freshness indicator exists to expose.
 */
export function MeridianFreshness({
  asOf,
  staleAfterMs = 180_000,
}: {
  asOf: string | null | undefined;
  staleAfterMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const t = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(t)) return null;
  const ageMs = Math.max(0, now - t);
  const stale = ageMs > staleAfterMs;
  const label =
    ageMs < 60_000
      ? `${Math.floor(ageMs / 1000)}s`
      : ageMs < 3_600_000
        ? `${Math.floor(ageMs / 60_000)}m`
        : `${Math.floor(ageMs / 3_600_000)}h`;

  return (
    <span className={`mv-fresh${stale ? " is-stale" : ""}`} title={`data timestamp ${asOf}`}>
      <span className="mv-fresh-dot" aria-hidden="true" />
      updated {label} ago
    </span>
  );
}
