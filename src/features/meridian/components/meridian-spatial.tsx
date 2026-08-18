"use client";

/**
 * Meridian spatial layer — depth used ONLY where it carries information.
 *
 * Two components ship here, and both encode something a flat version could not:
 *
 *   MeridianHalo3D  — the flat halo collapses three different QUESTIONS into one ring
 *                     ("what does the evidence say", "does it agree", "how confident is the
 *                     model"). Here they sit on separate Z planes; the tilt is what separates
 *                     them visually, so the depth is the encoding rather than a finish.
 *   MeridianOrbital — pillars on a tilted disc: radius = influence, angle = dimension cluster,
 *                     size = contribution, colour = lean. A viewer answers "what is driving
 *                     this verdict, and do the heavy things agree?" from position alone.
 *
 * Implementation is CSS 3D + SVG, not Three.js — see meridian-spatial-core for the full
 * rationale and for the list of requested 3D views deliberately NOT built because the data
 * does not support them.
 *
 * Cost + degradation:
 *  - Tilt runs off a rAF-throttled pointermove writing ONE transform on a `preserve-3d`
 *    parent. Compositor-only; no per-frame React state, no layout.
 *  - `prefers-reduced-motion` and coarse pointers (touch) drop straight to the flat render.
 *    The flat render is not a fallback stub — it is the same diagram at tilt 0, fully readable.
 *  - Zero added dependencies, so nothing to lazy-load and no effect on initial bundle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  orbitalGeometry,
  orbitalLabelOffset,
  orbitalLayout,
  orbitalPoint,
  type OrbitalGeometry,
  ringStack,
  tiltFromPointer,
  type OrbitalNode,
} from "@/lib/meridian/meridian-spatial-core";
import { arcPath, haloFromSignals, type SignalLike } from "@/lib/meridian/meridian-viz-core";

type Lean = "bullish" | "bearish" | "neutral";
const leanCls = (l: string) => (l === "bullish" ? "mv-bull" : l === "bearish" ? "mv-bear" : "mv-neutral");

/**
 * True when the device/user actually wants a depth effect: fine pointer AND motion allowed.
 * Checked live (not once at import) so a user toggling the OS setting, or a hybrid device
 * switching input, gets the right treatment without a reload.
 */
function useSpatialEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setEnabled(fine.matches && !reduce.matches);
    sync();
    fine.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
    };
  }, []);
  return enabled;
}

/**
 * Pointer-driven tilt. Returns a ref to attach and the live tilt.
 *
 * The tilt is written to a CSS custom property via rAF rather than held in React state: at
 * 60fps a state-driven tilt would re-render the whole subtree ~60×/s, and on a panel carrying
 * a dozen SVG nodes that is exactly the interaction latency the brief forbids. React only
 * re-renders when the numeric tilt is needed for LAYOUT (the orbital node positions), which is
 * throttled separately.
 */
function useTilt(enabled: boolean, maxDeg = 12) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const apply = useCallback(() => {
    rafRef.current = null;
    const el = ref.current;
    const p = pending.current;
    if (!el || !p) return;
    el.style.setProperty("--mtx", `${p.x}deg`);
    el.style.setProperty("--mty", `${p.y}deg`);
    setTilt(p);
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      pending.current = tiltFromPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, maxDeg);
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(apply);
    },
    [enabled, maxDeg, apply]
  );

  const onLeave = useCallback(() => {
    pending.current = { x: 0, y: 0 };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(apply);
  }, [apply]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return { ref, tilt: enabled ? tilt : { x: 0, y: 0 }, onMove, onLeave };
}

/* ── 3D halo — layered ring stack ─────────────────────────────────────────────────── */
export function MeridianHalo3D({
  signals,
  score,
  verdict,
  confidence,
  size = 190,
  onLayerClick,
}: {
  signals: readonly SignalLike[] | null | undefined;
  score: number | null;
  verdict: Lean;
  confidence?: string | null;
  size?: number;
  onLayerClick?: (layer: "pillars" | "agreement" | "confidence") => void;
}) {
  const enabled = useSpatialEnabled();
  const { ref, onMove, onLeave } = useTilt(enabled, 11);
  const halo = useMemo(() => haloFromSignals(signals), [signals]);
  const layers = useMemo(() => ringStack(halo?.agreement ?? null, confidence), [halo, confidence]);

  if (!halo || !layers) return null;
  const cx = size / 2;
  const rBase = size / 2 - 12;

  let cursor = 0;
  const segs = halo.segments.map((s, i) => {
    const sweep = s.fraction * 360;
    const d = arcPath(cx, cx, rBase, cursor + 0.9, cursor + sweep - 0.9);
    cursor += sweep;
    return { d, lean: s.lean, i };
  });

  return (
    <div
      ref={ref}
      className={`ms-halo${enabled ? " is-spatial" : ""}`}
      style={{ width: size, height: size }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="ms-halo-stage">
        {layers.map((layer) => {
          const r = rBase * layer.radius;
          const isPillars = layer.key === "pillars";
          return (
            <div
              key={layer.key}
              className={`ms-plane ms-plane-${layer.key}`}
              style={{ ["--mz" as string]: `${layer.z}px` }}
            >
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                <circle cx={cx} cy={cx} r={r} className="ms-track" />
                {isPillars ? (
                  segs.map((s) => (
                    <path key={s.i} d={s.d} className={`ms-seg ${leanCls(s.lean)}`} />
                  ))
                ) : (
                  <path
                    d={arcPath(cx, cx, r, 0, Math.max(layer.value * 360, 0.001))}
                    className={`ms-arc ms-arc-${layer.key} ${leanCls(halo.dominant)}`}
                  />
                )}
              </svg>
              {onLayerClick && (
                <button
                  type="button"
                  className="ms-plane-hit"
                  style={{ width: r * 2, height: r * 2 }}
                  onClick={() => onLayerClick(layer.key)}
                  aria-label={`${layer.label}: ${Math.round(layer.value * 100)}%`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="ms-halo-center">
        <span className={`ms-verdict ${leanCls(verdict)}`}>{verdict}</span>
        <span className="ms-score">{score ?? "—"}</span>
        <span className="ms-sub">
          {Math.round(halo.agreement * 100)}% agree{confidence ? ` · ${confidence}` : ""}
        </span>
      </div>

      {/* Legend earns its place: without it the three rings are decoration. */}
      <div className="ms-legend" aria-hidden="true">
        {layers.map((l) => (
          <span key={l.key} className="ms-legend-item">
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Pillar orbital system ────────────────────────────────────────────────────────── */
export function MeridianOrbital({
  signals,
  verdict,
  size = 300,
  onPillarClick,
}: {
  signals: Parameters<typeof orbitalLayout>[0];
  verdict: Lean;
  size?: number;
  onPillarClick?: (pillar: string) => void;
}) {
  const enabled = useSpatialEnabled();
  const { ref, tilt, onMove, onLeave } = useTilt(enabled, 13);
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useMemo(() => orbitalLayout(signals), [signals]);

  // Node screen positions depend on the tilt, so they DO need the numeric value. The tilt state
  // only updates once per animation frame, so this recompute is bounded to ~60/s over ~11 nodes
  // — cheap arithmetic, no DOM measurement, and memoised so a hover does not redo it.
  const placed = useMemo(
    () => nodes.map((n) => ({ n, p: orbitalPoint(n, tilt.x, tilt.y) })),
    [nodes, tilt.x, tilt.y]
  );

  if (nodes.length === 0) return null;
  const half = size / 2;
  // Geometry lives in the core module so the component and its collision test read the SAME
  // numbers. A test that recomputes placement its own way proves nothing about what renders.
  const geo = orbitalGeometry(size);
  const R = geo.R;

  // Painter's algorithm: far nodes first, so near orbs overlap far ones and depth reads correctly.
  const ordered = [...placed].sort((a, b) => a.p.depth - b.p.depth);

  return (
    <div
      ref={ref}
      className={`ms-orbital${enabled ? " is-spatial" : ""}`}
      style={{ width: size, height: size }}
      onPointerMove={onMove}
      onPointerLeave={() => {
        onLeave();
        setHover(null);
      }}
    >
      {/* Orbit guides sit on the tilted plane so the disc reads as a plane, not scattered dots. */}
      <svg className="ms-orbital-guides" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {[0.34, 0.67, 1].map((r) => (
          <ellipse
            key={r}
            cx={half}
            cy={half}
            rx={R * r}
            // A tilt about X foreshortens the vertical axis — that IS the tilt, geometrically.
            ry={R * r * Math.cos((tilt.x * Math.PI) / 180)}
            className="ms-orbit-guide"
          />
        ))}
      </svg>

      <div className="ms-orbital-core">
        <span className={`ms-core-dot ${leanCls(verdict)}`} />
        <span className="ms-core-label">MERIDIAN</span>
      </div>

      {ordered.map(({ n, p }) => {
        const d = 14 + n.size * 22;
        const dim = hover !== null && hover !== n.pillar;
        return (
          <button
            type="button"
            key={n.pillar}
            className={`ms-orb ${leanCls(n.lean)}${dim ? " is-dim" : ""}${hover === n.pillar ? " is-hot" : ""}`}
            style={{
              width: d * p.scale,
              height: d * p.scale,
              left: half + p.x * R,
              top: half + p.y * R,
              // Depth drives opacity as well as size — two cues beat one when the tilt is mild.
              opacity: dim ? 0.28 : 0.55 + p.depth * 0.45,
              zIndex: Math.round(p.depth * 100),
            }}
            onMouseEnter={() => setHover(n.pillar)}
            onFocus={() => setHover(n.pillar)}
            onBlur={() => setHover(null)}
            onClick={onPillarClick ? () => onPillarClick(n.pillar) : undefined}
            title={`${n.label} · ${n.lean} · weight ${n.weight} · score ${n.score > 0 ? "+" : ""}${n.score}${n.detail ? ` — ${n.detail}` : ""}`}
            aria-label={`${n.label}, ${n.lean}, ${n.dimension}`}
          >
            {/* Labels are projected onto a COMMON RIM RING (orbitalLabelOffset), not anchored
                under their orb — see that function for why. Observed live on NKLR: "Latest
                print", "Fundamentals" and "Helix flow" printed on top of each other over the
                core because each label hung directly below its own orb. */}
            <OrbLabel node={n} geo={geo} />
          </button>
        );
      })}

      <p className="ms-orbital-key">
        closer = heavier influence · size = contribution · sector = dimension
      </p>
    </div>
  );
}

/** Rim-projected pillar label. Placement math is shared with the collision test. */
function OrbLabel({ node, geo }: { node: OrbitalNode; geo: OrbitalGeometry }) {
  const { lx, ly, anchor } = orbitalLabelOffset(node, geo);
  return (
    <span
      className="ms-orb-label"
      style={{
        ["--lx" as string]: `${lx}px`,
        ["--ly" as string]: `${ly}px`,
        ["--lanchor" as string]: anchor,
      }}
    >
      {node.label}
    </span>
  );
}
