"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildHelixRungs,
  buildMeshWires,
  buildStarField,
  captureParticlePath,
  ellipsePath,
  placeSatellites,
  pulseTiming,
  ringRadii,
  type PlacedSatellite,
  type Satellite,
} from "./bie-helix-engine";

// Alive helix mesh — BIE is the engine, not a pipeline handoff. Labels hidden
// until hover; neural pulses travel inward; learning loops back from output.

const VIEW_W = 960;
const VIEW_H = 420;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const MAX_RX = 248;
const MAX_RY = 118;
const RUNG_COUNT = 14;
const STAR_COUNT = 140;

const SATELLITES: Satellite[] = [
  { id: "pattern", label: "Pattern Recognition", detail: "Structure, regime, and repeat setups across sessions", angleDeg: 305, ring: 0, accent: "#bf5fff" },
  { id: "reasoning", label: "Market Reasoning", detail: "Cross-check signals against live context before they ship", angleDeg: 20, ring: 0, accent: "#bf5fff" },
  { id: "memory", label: "Memory", detail: "Every alert, outcome, and precedent feeds the next call", angleDeg: 95, ring: 0, accent: "#bf5fff" },
  { id: "risk", label: "Risk Analysis", detail: "Confidence gates and invalidation before anything reaches you", angleDeg: 170, ring: 0, accent: "#bf5fff" },
  { id: "learn", label: "Continuous Learning", detail: "Calibration tightens with every market day and session", angleDeg: 245, ring: 0, accent: "#bf5fff" },
  { id: "market", label: "Market Intelligence", detail: "Live tape, positioning, liquidity, and volatility ingested", angleDeg: 340, ring: 1, accent: "#5df7ff" },
  { id: "validation", label: "Validation", detail: "Integrity, consistency, and real-time self-audit", angleDeg: 55, ring: 1, accent: "#00e676" },
  { id: "confidence", label: "Confidence", detail: "Every number grounded or withheld — never fabricated", angleDeg: 145, ring: 1, accent: "#00e676" },
  { id: "outputs", label: "Trusted Output", detail: "Desk instruments receive only validated intelligence", angleDeg: 235, ring: 2, accent: "#ffcc4d" },
];

type OutputProduct = { name: string; href: string; accent: string };

const PRODUCTS: OutputProduct[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "every heat map, GEX read, and play checked before it reaches your screen",
  "signals are reasoned and confidence-scored — not guessed",
  "the engine never stops learning from every session, every market day",
  "trust the output because validation happened first",
];

type ImpulsePhase = "idle" | "outer" | "inner" | "core" | "out" | "feedback";

function useLiveOnView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

function useParticleCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  active: boolean,
  reduceMotion: boolean,
  capturePaths: string[]
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || reduceMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const stars = buildStarField(CORE.x, CORE.y, MAX_RX * 1.05, MAX_RY * 1.05, STAR_COUNT);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let frame = 0;
    let captureT = 0;
    let nextCapture = 180 + Math.random() * 120;
    let capturePathIdx = 0;
    let captureProgress = 0;
    let raf = 0;

    const scaleX = () => canvas.getBoundingClientRect().width / VIEW_W;
    const scaleY = () => canvas.getBoundingClientRect().height / VIEW_H;

    const draw = () => {
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.scale(scaleX(), scaleY());

      for (const s of stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(frame * 0.02 + s.x * 0.03);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(148, 226, 255, ${s.opacity * twinkle})`;
        ctx.fill();
      }

      frame++;
      captureT++;
      if (captureT > nextCapture && capturePaths.length > 0) {
        captureProgress += 0.012 + Math.random() * 0.004;
        if (captureProgress >= 1) {
          captureProgress = 0;
          captureT = 0;
          nextCapture = 200 + Math.random() * 180;
          capturePathIdx = (capturePathIdx + 1) % capturePaths.length;
        } else {
          const path = capturePaths[capturePathIdx];
          if (path) {
            const len = 80;
            const pt = approximatePathPoint(path, captureProgress);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2.8, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(93, 247, 255, 0.95)";
            ctx.shadowColor = "#5df7ff";
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
            void len;
          }
        }
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, reduceMotion, capturePaths, canvasRef]);
}

/** Lightweight path sampler for quadratic segments in captureParticlePath. */
function approximatePathPoint(d: string, t: number): { x: number; y: number } {
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  if (nums.length < 8) return { x: CORE.x, y: CORE.y };
  const [ox, oy, qx, qy, cx, cy, qx2, qy2, ex, ey] = nums;
  if (t < 0.5) {
    const u = t * 2;
    const x = (1 - u) * (1 - u) * ox + 2 * (1 - u) * u * qx + u * u * cx;
    const y = (1 - u) * (1 - u) * oy + 2 * (1 - u) * u * qy + u * u * cy;
    return { x, y };
  }
  const u = (t - 0.5) * 2;
  const x = (1 - u) * (1 - u) * cx + 2 * (1 - u) * u * qx2 + u * u * ex;
  const y = (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * qy2 + u * u * ey;
  return { x, y };
}

export function BieBrainBanner() {
  const { ref: diagramRef, visible } = useLiveOnView<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hovered, setHovered] = useState<PlacedSatellite | null>(null);
  const [impulse, setImpulse] = useState<ImpulsePhase>("idle");
  const [drawn, setDrawn] = useState(false);

  const placed = useMemo(() => placeSatellites(CORE.x, CORE.y, SATELLITES, MAX_RX, MAX_RY), []);
  const wires = useMemo(() => buildMeshWires(CORE.x, CORE.y, placed, "outputs"), [placed]);
  const rungsA = useMemo(() => buildHelixRungs(CORE.x, CORE.y, MAX_RX * 0.64, MAX_RY * 0.64, RUNG_COUNT, 0), []);
  const rungsB = useMemo(() => buildHelixRungs(CORE.x, CORE.y, MAX_RX * 0.64, MAX_RY * 0.64, RUNG_COUNT, 180 / RUNG_COUNT), []);
  const ringGuides = useMemo(
    () =>
      ([0, 1, 2] as const).map((ring) => {
        const { rx, ry } = ringRadii(ring, MAX_RX, MAX_RY);
        return { ring, d: ellipsePath(CORE.x, CORE.y, rx, ry) };
      }),
    []
  );

  const capturePaths = useMemo(
    () =>
      placed.slice(0, 5).map((s, i) =>
        captureParticlePath(CORE.x, CORE.y, s.angleDeg + i * 12, MAX_RX, MAX_RY, placed.find((p) => p.id === "outputs")?.angleDeg ?? 235)
      ),
    [placed]
  );

  useParticleCanvas(canvasRef, visible, reduceMotion, capturePaths);

  useEffect(() => {
    const id = setInterval(() => setLineIndex((i) => (i + 1) % READOUT_LINES.length), 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setDrawn(true);
    const el = svgRef.current;
    if (el && typeof el.unpauseAnimations === "function") el.unpauseAnimations();
  }, [visible]);

  useEffect(() => {
    if (!visible || reduceMotion) {
      setImpulse("idle");
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const schedule = () => {
      if (cancelled) return;
      setImpulse("outer");
      timers.push(setTimeout(() => !cancelled && setImpulse("inner"), 700));
      timers.push(setTimeout(() => !cancelled && setImpulse("core"), 1300));
      timers.push(setTimeout(() => !cancelled && setImpulse("out"), 1900));
      timers.push(setTimeout(() => !cancelled && setImpulse("feedback"), 2500));
      timers.push(setTimeout(() => !cancelled && setImpulse("idle"), 3200));
      timers.push(setTimeout(schedule, 4200 + Math.random() * 2800));
    };

    schedule();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [visible, reduceMotion]);

  const litRing = impulse === "outer" ? 2 : impulse === "inner" ? 1 : impulse === "core" || impulse === "out" || impulse === "feedback" ? 0 : -1;

  const onSatelliteEnter = useCallback((s: PlacedSatellite) => setHovered(s), []);
  const onSatelliteLeave = useCallback(() => setHovered(null), []);

  return (
    <div className="bie-brain-banner">
      <div className="bie-brain-heading">
        <span className="bie-brain-eyebrow">
          <span className="bie-brain-eyebrow-dot" aria-hidden />
          The operating brain of BlackOut
        </span>
        <h2 className="bie-brain-title">BlackOut Intelligence Engine</h2>
        <p className="bie-brain-sub">{READOUT_LINES[lineIndex]}</p>
      </div>

      <div
        ref={diagramRef}
        className="bie-brain-diagram bie-helix-diagram"
        role="img"
        aria-label="BlackOut Intelligence Engine: an interconnected helix mesh where market intelligence is validated, reasoned, and learned inside the engine before trusted output reaches the desk."
      >
        <div className="bie-brain-canvas bie-helix-canvas">
          <canvas ref={canvasRef} className="bie-helix-particles" aria-hidden />
          <svg
            ref={svgRef}
            className={drawn ? "bie-brain-svg bie-helix-svg is-drawn" : "bie-brain-svg bie-helix-svg"}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
                <stop offset="0%" stopColor="#5df7ff" />
                <stop offset="42%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#0a3b45" />
              </radialGradient>
              <radialGradient id="bie-helix-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(0,229,255,0.28)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0)" />
              </radialGradient>
              <linearGradient id="bie-core-halo" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(0,229,255,0.65)" />
                <stop offset="100%" stopColor="rgba(191,95,255,0.45)" />
              </linearGradient>
              <filter id="bie-helix-bloom" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {placed.map((s) => (
                <linearGradient
                  key={`grad-${s.id}`}
                  id={`bie-spoke-grad-${s.id}`}
                  gradientUnits="userSpaceOnUse"
                  x1={CORE.x}
                  y1={CORE.y}
                  x2={s.x}
                  y2={s.y}
                >
                  <stop offset="0%" stopColor="#00e5ff" />
                  <stop offset="100%" stopColor={s.accent} />
                </linearGradient>
              ))}
            </defs>

            <circle cx={CORE.x} cy={CORE.y} r={MAX_RX * 0.95} className="bie-helix-atmosphere" fill="url(#bie-helix-glow)" />

            <g className="bie-helix-strand bie-helix-strand-b">
              {ringGuides.map(({ ring, d }) => (
                <path key={`guide-b-${ring}`} d={d} className={`bie-helix-ring-guide bie-helix-ring-${ring}`} pathLength={1} />
              ))}
              {rungsB.map((r, i) => (
                <line
                  key={`rung-b-${i}`}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  className="bie-helix-rung"
                  strokeOpacity={0.18 + 0.5 * r.depth}
                  strokeWidth={0.4 + 1.2 * r.depth}
                />
              ))}
            </g>

            <g className="bie-helix-strand bie-helix-strand-a">
              {rungsA.map((r, i) => (
                <line
                  key={`rung-a-${i}`}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  className="bie-helix-rung"
                  strokeOpacity={0.22 + 0.55 * r.depth}
                  strokeWidth={0.5 + 1.4 * r.depth}
                />
              ))}
            </g>

            <g className="bie-helix-mesh">
              {wires.map((w, i) => {
                const { dur, delay } = pulseTiming(w.kind, i);
                const isFeedback = w.kind === "feedback";
                return (
                  <g key={w.id}>
                    <path
                      id={w.id}
                      d={w.d}
                      pathLength={1}
                      className={`bie-wire bie-${w.kind}-wire${isFeedback && impulse === "feedback" ? " is-feedback-active" : ""}`}
                      stroke={w.kind === "spoke" ? `url(#bie-spoke-grad-${w.satelliteId})` : w.accent}
                      style={{ animationDelay: `${i * 0.05}s` }}
                    />
                    {!reduceMotion && w.kind !== "feedback" && (
                      <circle r={w.kind === "spoke" ? 2.6 : 1.8} className={`bie-${w.kind}-pulse`} fill={w.accent}>
                        <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite">
                          <mpath href={`#${w.id}`} />
                        </animateMotion>
                      </circle>
                    )}
                    {!reduceMotion && isFeedback && (
                      <circle r={2.2} className="bie-feedback-pulse" fill="#bf5fff">
                        <animateMotion dur="5.4s" begin="-2s" repeatCount="indefinite">
                          <mpath href={`#${w.id}`} />
                        </animateMotion>
                      </circle>
                    )}
                  </g>
                );
              })}
            </g>

            {placed.map((s) => (
              <g
                key={s.id}
                className={`bie-helix-satellite bie-helix-satellite-ring-${s.ring}${litRing === s.ring ? " is-impulse-lit" : ""}${hovered?.id === s.id ? " is-hovered" : ""}`}
                transform={`translate(${s.x}, ${s.y})`}
                onMouseEnter={() => onSatelliteEnter(s)}
                onMouseLeave={onSatelliteLeave}
                onFocus={() => onSatelliteEnter(s)}
                onBlur={onSatelliteLeave}
                tabIndex={0}
                role="button"
                aria-label={`${s.label}: ${s.detail}`}
              >
                <circle r={s.ring === 2 ? 9 : s.ring === 1 ? 7 : 5.5} className="bie-helix-satellite-glow" fill={s.accent} />
                <circle r={s.ring === 2 ? 5 : s.ring === 1 ? 4 : 3} className="bie-helix-satellite-core" fill={s.accent} />
              </g>
            ))}

            <g className={`bie-helix-core${impulse === "core" || impulse === "out" ? " is-impulse-core" : ""}`} transform={`translate(${CORE.x}, ${CORE.y})`}>
              <circle cx={0} cy={0} r={52} className="bie-brain-ring" style={{ animationDelay: "0s" }} />
              <circle cx={0} cy={0} r={52} className="bie-brain-ring" style={{ animationDelay: "1.1s" }} />
              <circle cx={0} cy={0} r={52} className="bie-brain-ring" style={{ animationDelay: "2.2s" }} />
              <circle cx={0} cy={0} r={34} className="bie-brain-core-shell" />
              <circle cx={0} cy={0} r={22} className="bie-brain-core" filter="url(#bie-helix-bloom)" />
            </g>
          </svg>

          <span className="bie-brain-core-label bie-helix-core-label" aria-hidden>
            BIE
          </span>

          {hovered && (
            <div
              className="bie-helix-tooltip"
              style={{
                left: `${(hovered.x / VIEW_W) * 100}%`,
                top: `${(hovered.y / VIEW_H) * 100}%`,
                ["--tip-accent" as string]: hovered.accent,
              }}
              role="tooltip"
            >
              <span className="bie-helix-tooltip-title">{hovered.label}</span>
              <span className="bie-helix-tooltip-detail">{hovered.detail}</span>
            </div>
          )}
        </div>
      </div>

      <p className="bie-brain-products-eyebrow">Platform instruments · powered by BIE</p>
      <div className="bie-brain-product-rail">
        {PRODUCTS.map((n) => (
          <Link key={n.name} href={n.href} className="bie-brain-node" style={{ ["--node-accent" as string]: n.accent }}>
            <span className="bie-brain-node-swatch" />
            {n.name}
          </Link>
        ))}
      </div>

      <p className="bie-brain-tagline">
        Every number validated <span className="bie-brain-tagline-accent">before you see it.</span>
      </p>
    </div>
  );
}
