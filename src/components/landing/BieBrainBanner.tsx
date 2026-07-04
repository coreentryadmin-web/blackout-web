"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { chordPath, columnNodes, flowPath } from "./bie-brain-geometry";

// Title-card reveal above "The full desk" — tells one story in ~5–10 seconds:
// Raw Market Intelligence → Validation → Reasoning → Continuous Learning → Trusted Output.
// No vendor/stack names; capabilities only. SVG flow lines + HTML labels for legibility.

// Wide viewBox — diagram stretches edge-to-edge; layer X positions are fractions of VIEW_W.
const VIEW_W = 1280;
const VIEW_H = 420;
const CORE = { x: VIEW_W / 2, y: VIEW_H / 2 };
const CORE_Y_PCT = (CORE.y / VIEW_H) * 100;
const layerX = (pct: number) => VIEW_W * pct;

type CapabilityLayer = {
  id: string;
  title: string;
  x: number;
  accent: string;
  items: string[];
};

const MARKET_LAYER: CapabilityLayer = {
  id: "market",
  title: "Market Intelligence",
  x: layerX(0.06),
  accent: "#5df7ff",
  items: ["Live Market Data", "Options Intelligence", "Dealer Positioning", "Market Structure", "Liquidity", "Volatility"],
};

const VALIDATION_LAYER: CapabilityLayer = {
  id: "validation",
  title: "Validation",
  x: layerX(0.2),
  accent: "#00e676",
  items: ["Data Integrity", "Signal Verification", "Consistency Checks", "Confidence Analysis", "Real-Time Validation", "Self Audit"],
};

const REASONING_LAYER: CapabilityLayer = {
  id: "reasoning",
  title: "Intelligence",
  x: layerX(0.8),
  accent: "#bf5fff",
  items: ["Pattern Recognition", "Market Reasoning", "Decision Engine", "Memory", "Risk Analysis", "Continuous Improvement"],
};

const OUTPUT_LAYER: CapabilityLayer = {
  id: "output",
  title: "Trusted Output",
  x: layerX(0.94),
  accent: "#ffcc4d",
  items: ["Trade Intelligence", "SPX Slayer", "Heat Maps", "Alerts", "Rankings", "Market Bias"],
};

const SIDE_LAYERS = [MARKET_LAYER, VALIDATION_LAYER, REASONING_LAYER, OUTPUT_LAYER];
const NODE_SPACING = 44;

type FlowNode = { id: string; label: string; x: number; y: number; layerId: string; accent: string };

function buildLayerNodes(layer: CapabilityLayer): FlowNode[] {
  const positions = columnNodes(layer.x, CORE.y, layer.items.length, NODE_SPACING);
  return layer.items.map((label, i) => ({
    id: `${layer.id}-${i}`,
    label,
    x: positions[i].x,
    y: positions[i].y,
    layerId: layer.id,
    accent: layer.accent,
  }));
}

type OutputProduct = { name: string; href: string; accent: string };

const PRODUCTS: OutputProduct[] = [
  { name: "SPX Slayer", href: "/dashboard", accent: "#00e676" },
  { name: "HELIX", href: "/flows", accent: "#bf5fff" },
  { name: "BlackOut Thermal", href: "/heatmap", accent: "#ff6b2b" },
  { name: "Largo", href: "/terminal", accent: "#22d3ee" },
  { name: "Night Hawk", href: "/nighthawk", accent: "#ff2d55" },
  { name: "BlackOut Grid", href: "/grid", accent: "#ffcc4d" },
];

type FlowWire = {
  id: string;
  d: string;
  accent: string;
  stage: "inbound" | "validate" | "outbound" | "core";
  dur: number;
  delay: number;
};

function buildFlowWires(nodes: {
  market: FlowNode[];
  validation: FlowNode[];
  reasoning: FlowNode[];
  output: FlowNode[];
}): FlowWire[] {
  const wires: FlowWire[] = [];

  const linkColumns = (
    from: FlowNode[],
    to: FlowNode[],
    stage: FlowWire["stage"],
    accent: string,
    bow: number,
    xPadFrom = 14,
    xPadTo = -14
  ) => {
    const n = Math.min(from.length, to.length);
    for (let i = 0; i < n; i++) {
      wires.push({
        id: `bie-flow-${from[i].id}-${to[i].id}`,
        d: flowPath(from[i].x + xPadFrom, from[i].y, to[i].x + xPadTo, to[i].y, CORE.y, bow),
        accent,
        stage,
        dur: 2.4 + (i % 4) * 0.35,
        delay: -(i * 0.55),
      });
    }
  };

  linkColumns(nodes.market, nodes.validation, "inbound", "#5df7ff", 8);

  nodes.validation.forEach((n, i) => {
    const targetY = CORE.y - 48 + i * 16;
    wires.push({
      id: `bie-flow-val-core-${i}`,
      d: flowPath(n.x + 14, n.y, CORE.x - 46, targetY, CORE.y, 14),
      accent: "#00e676",
      stage: "validate",
      dur: 2.6 + (i % 3) * 0.3,
      delay: -(i * 0.62),
    });
  });

  nodes.reasoning.forEach((n, i) => {
    wires.push({
      id: `bie-flow-core-reason-${i}`,
      d: flowPath(CORE.x + 42, CORE.y - 20 + (i % 3) * 20, n.x - 14, n.y, CORE.y, -10),
      accent: "#bf5fff",
      stage: "core",
      dur: 2.8 + (i % 3) * 0.4,
      delay: -(i * 0.48),
    });
  });

  linkColumns(nodes.reasoning, nodes.output, "outbound", "#ffcc4d", -8);

  return wires;
}

const READOUT_LINES = [
  "continuous market intelligence — ingested, verified, never assumed",
  "every heat map, GEX read, and play checked before it reaches your screen",
  "signals are reasoned and confidence-scored — not guessed",
  "the engine never stops learning from every session, every market day",
  "trust the output because validation happened first",
];

function useLiveOnView<T extends SVGSVGElement>() {
  const ref = useRef<T>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          if (typeof el.unpauseAnimations === "function") el.unpauseAnimations();
        } else if (typeof el.pauseAnimations === "function") {
          el.pauseAnimations();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, drawn };
}

export function BieBrainBanner() {
  const { ref, drawn } = useLiveOnView<SVGSVGElement>();
  const [lineIndex, setLineIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const nodes = useMemo(
    () => ({
      market: buildLayerNodes(MARKET_LAYER),
      validation: buildLayerNodes(VALIDATION_LAYER),
      reasoning: buildLayerNodes(REASONING_LAYER),
      output: buildLayerNodes(OUTPUT_LAYER),
    }),
    []
  );

  const wires = useMemo(() => buildFlowWires(nodes), [nodes]);
  const allNodes = useMemo(
    () => [...nodes.market, ...nodes.validation, ...nodes.reasoning, ...nodes.output],
    [nodes]
  );

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
        className="bie-brain-diagram"
        role="img"
        aria-label="Intelligence pipeline: market data flows through validation into the BlackOut Intelligence Engine, then reasoned output reaches every platform instrument."
      >
        <div className="bie-brain-layer-labels">
          {SIDE_LAYERS.map((layer) => (
            <span
              key={layer.id}
              className="bie-brain-layer-title"
              style={{ left: `${(layer.x / VIEW_W) * 100}%`, color: layer.accent }}
            >
              {layer.title}
            </span>
          ))}
          <span className="bie-brain-layer-title bie-brain-layer-title-core">Intelligence Engine</span>
        </div>

        <div className="bie-brain-scroll-wrap">
        <div className="bie-brain-canvas">
          <svg
            ref={ref}
            className={drawn ? "bie-brain-svg is-drawn" : "bie-brain-svg"}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
          >
          <defs>
            <radialGradient id="bie-core-grad" cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#5df7ff" />
              <stop offset="42%" stopColor="#00e5ff" />
              <stop offset="100%" stopColor="#0a3b45" />
            </radialGradient>
            <linearGradient id="bie-core-halo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(0,229,255,0.55)" />
              <stop offset="100%" stopColor="rgba(191,95,255,0.35)" />
            </linearGradient>
          </defs>

          {/* Layer bands — visual hierarchy, not random decoration */}
          {SIDE_LAYERS.map((layer) => (
            <rect
              key={`band-${layer.id}`}
              x={layer.x - 52}
              y={CORE.y - (layer.items.length * NODE_SPACING) / 2 - 28}
              width={104}
              height={layer.items.length * NODE_SPACING + 56}
              rx={4}
              className={`bie-brain-layer-band bie-brain-layer-band-${layer.id}`}
              style={{ fill: layer.accent }}
            />
          ))}
          <rect
            x={CORE.x - 72}
            y={CORE.y - 150}
            width={144}
            height={300}
            rx={6}
            className="bie-brain-layer-band bie-brain-layer-band-core"
          />

          {/* Stage brackets — subtle vertical rails anchoring each column */}
          {SIDE_LAYERS.map((layer) => (
            <line
              key={`rail-${layer.id}`}
              x1={layer.x}
              y1={CORE.y - (layer.items.length * NODE_SPACING) / 2 - 18}
              x2={layer.x}
              y2={CORE.y + (layer.items.length * NODE_SPACING) / 2 + 18}
              className="bie-brain-rail"
              stroke={layer.accent}
            />
          ))}

          {/* Validation gate — every signal passes this inlet before the engine */}
          <path
            d={`M ${CORE.x - 58} ${CORE.y - 72} Q ${CORE.x - 28} ${CORE.y} ${CORE.x - 58} ${CORE.y + 72}`}
            className="bie-brain-gate"
            pathLength={1}
          />
          <path
            d={`M ${CORE.x - 52} ${CORE.y - 64} Q ${CORE.x - 30} ${CORE.y} ${CORE.x - 52} ${CORE.y + 64}`}
            className="bie-brain-gate bie-brain-gate-inner"
            pathLength={1}
          />

          {/* Flow connections — intelligence travels inward, validated output travels outward */}
          {wires.map((w, i) => (
            <g key={w.id}>
              <path
                id={w.id}
                d={w.d}
                pathLength={1}
                className={`bie-flow-wire bie-flow-${w.stage}`}
                stroke={w.accent}
                style={{ animationDelay: `${i * 0.06}s` }}
              />
              {!reduceMotion && (
                <circle
                  r={w.stage === "validate" ? 3.2 : w.stage === "core" ? 3 : 2.4}
                  className={`bie-flow-pulse bie-flow-pulse-${w.stage}`}
                  fill={w.accent}
                >
                  <animateMotion dur={`${w.dur}s`} begin={`${w.delay}s`} repeatCount="indefinite">
                    <mpath href={`#${w.id}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          ))}

          {/* Capability nodes */}
          {allNodes.map((n) => (
            <g key={n.id} className="bie-brain-cap-node">
              <circle cx={n.x} cy={n.y} r={5} fill={n.accent} className="bie-brain-cap-dot" />
              <circle cx={n.x} cy={n.y} r={9} fill="none" stroke={n.accent} className="bie-brain-cap-ring" />
            </g>
          ))}

          {/* Command core — reactor at the center of the pipeline */}
          <circle cx={CORE.x} cy={CORE.y} r={56} className="bie-brain-core-shell" />
          <circle cx={CORE.x} cy={CORE.y} r={48} className="bie-brain-ring" style={{ animationDelay: "0s" }} />
          <circle cx={CORE.x} cy={CORE.y} r={48} className="bie-brain-ring" style={{ animationDelay: "1.15s" }} />
          <circle cx={CORE.x} cy={CORE.y} r={48} className="bie-brain-ring" style={{ animationDelay: "2.3s" }} />
          <circle cx={CORE.x} cy={CORE.y} r={32} className="bie-brain-core" />
          {/* Inbound / outbound axis */}
          <path
            d={chordPath(layerX(0.03), CORE.y, CORE.x - 34, CORE.y, CORE.x, CORE.y, 0)}
            className="bie-brain-axis bie-brain-axis-in"
            pathLength={1}
          />
          <path
            d={chordPath(CORE.x + 34, CORE.y, layerX(0.97), CORE.y, CORE.x, CORE.y, 0)}
            className="bie-brain-axis bie-brain-axis-out"
            pathLength={1}
          />
          </svg>

          <div className="bie-brain-label-overlay">
            {allNodes.map((n) => (
              <span
                key={`lbl-${n.id}`}
                className={`bie-brain-cap-label bie-brain-cap-label-${n.layerId}`}
                style={{
                  left: `${(n.x / VIEW_W) * 100}%`,
                  top: `${(n.y / VIEW_H) * 100}%`,
                  ["--cap-accent" as string]: n.accent,
                }}
              >
                {n.label}
              </span>
            ))}
          </div>

          <div className="bie-brain-core-zone" style={{ top: `${CORE_Y_PCT}%` }}>
            <span className="bie-brain-core-label">BIE</span>
            <span className="bie-brain-core-caption">Validate · Reason · Improve</span>
          </div>
        </div>
        <p className="bie-brain-scroll-hint" aria-hidden>
          Scroll the pipeline →
        </p>
        </div>

        <div className="bie-brain-story-rail" aria-hidden>
          <span className="bie-brain-story-step">Ingest</span>
          <span className="bie-brain-story-arrow" />
          <span className="bie-brain-story-step">Validate</span>
          <span className="bie-brain-story-arrow" />
          <span className="bie-brain-story-step bie-brain-story-step-core">Engine</span>
          <span className="bie-brain-story-arrow" />
          <span className="bie-brain-story-step">Reason</span>
          <span className="bie-brain-story-arrow" />
          <span className="bie-brain-story-step">Learn</span>
          <span className="bie-brain-story-arrow" />
          <span className="bie-brain-story-step">Deliver</span>
        </div>
      </div>

      <p className="bie-brain-products-eyebrow">Platform instruments · powered by BIE</p>
      <div className="bie-brain-nodes">
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
