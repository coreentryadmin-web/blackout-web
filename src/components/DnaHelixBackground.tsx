"use client";

// ─── Helix geometry (computed once at module load, never re-runs) ─────────────
const VW     = 260;   // SVG viewBox width
const VH     = 1100;  // SVG viewBox height
const CX     = VW / 2;
const AMP    = 88;    // sine wave amplitude (horizontal spread)
const PERIOD = 192;   // vertical pixels per full revolution
const STEPS  = 320;   // path resolution — higher = smoother curves

function buildPath(phase: number): string {
  const d: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const y = (i / STEPS) * VH;
    const x = CX + AMP * Math.sin((y / PERIOD) * 2 * Math.PI + phase);
    d.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return d.join(" ");
}

interface RungDatum { x1: number; x2: number; y: number; absCos: number; }

function buildRungs(): RungDatum[] {
  const out: RungDatum[] = [];
  for (let i = 0; i * (PERIOD / 2) < VH + PERIOD; i++) {
    const y = i * (PERIOD / 2) + PERIOD / 4;
    const t = (y / PERIOD) * 2 * Math.PI;
    out.push({
      x1: CX + AMP * Math.sin(t),
      x2: CX - AMP * Math.sin(t),
      y,
      absCos: Math.abs(Math.cos(t)),
    });
  }
  return out;
}

// Pre-compute once
const S1      = buildPath(0);
const S2      = buildPath(Math.PI);
const RUNGS   = buildRungs();

// Traveling particle timings — staggered so they're always spread out
const DOTS_S1 = [
  { dur: "7s",  begin: "0s"    },
  { dur: "10s", begin: "-3.5s" },
  { dur: "13s", begin: "-7s"   },
  { dur: "9s",  begin: "-5s"   },
  { dur: "15s", begin: "-11s"  },
];
const DOTS_S2 = [
  { dur: "8s",  begin: "-1s"   },
  { dur: "11s", begin: "-4s"   },
  { dur: "14s", begin: "-9s"   },
  { dur: "6s",  begin: "-2.5s" },
  { dur: "12s", begin: "-7.5s" },
];

// ─── Single helix SVG ─────────────────────────────────────────────────────────
function HelixSvg({ uid }: { uid: string }) {
  const F  = `f-${uid}`;   // bloom filter id
  const RG = `rg-${uid}`;  // rung gradient id
  const M1 = `m1-${uid}`;  // motion path 1
  const M2 = `m2-${uid}`;  // motion path 2

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* ── Bloom glow — 3 layers: wide halo + tight halo + crisp source ── */}
        <filter id={F} x="-110%" y="-8%" width="320%" height="116%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9"   result="wideBlur"/>
          <feGaussianBlur in="SourceGraphic" stdDeviation="3"   result="tightBlur"/>
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="crispBlur"/>
          <feMerge>
            <feMergeNode in="wideBlur"/>
            <feMergeNode in="tightBlur"/>
            <feMergeNode in="crispBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        {/* ── Rung gradient: cyan left → white centre → blue right ── */}
        <linearGradient id={RG} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#00d4ff" stopOpacity="1"/>
          <stop offset="40%"  stopColor="#b8f0ff" stopOpacity="1"/>
          <stop offset="60%"  stopColor="#b8f0ff" stopOpacity="1"/>
          <stop offset="100%" stopColor="#4488ff" stopOpacity="1"/>
        </linearGradient>

        {/* ── Hidden paths used only for animateMotion ── */}
        <path id={M1} d={S1} fill="none" stroke="none"/>
        <path id={M2} d={S2} fill="none" stroke="none"/>
      </defs>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* MAIN HELIX GEOMETRY                                          */}
      {/* ──────────────────────────────────────────────────────────── */}
      <g filter={`url(#${F})`}>

        {/* Strand 1 — electric cyan */}
        <path
          d={S1}
          fill="none"
          stroke="#00d4ff"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Strand 2 — deep electric blue */}
        <path
          d={S2}
          fill="none"
          stroke="#3b6fff"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Base-pair rungs — thicker & brighter when facing viewer (absCos→1) */}
        {RUNGS.map((r, i) => (
          <line
            key={`rung-${i}`}
            x1={r.x1} y1={r.y}
            x2={r.x2} y2={r.y}
            stroke={`url(#${RG})`}
            strokeWidth={0.4 + 2.4 * r.absCos}
            strokeOpacity={0.28 + 0.72 * r.absCos}
            strokeLinecap="round"
          />
        ))}

        {/* Nucleotide dots — strand 1 */}
        {RUNGS.map((r, i) => (
          <circle
            key={`nd1-${i}`}
            cx={r.x1} cy={r.y}
            r={2.2 + 1.4 * r.absCos}
            fill="#00e8ff"
            fillOpacity={0.45 + 0.55 * r.absCos}
          />
        ))}

        {/* Nucleotide dots — strand 2 */}
        {RUNGS.map((r, i) => (
          <circle
            key={`nd2-${i}`}
            cx={r.x2} cy={r.y}
            r={2.2 + 1.4 * r.absCos}
            fill="#7ab4ff"
            fillOpacity={0.45 + 0.55 * r.absCos}
          />
        ))}
      </g>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* TRAVELING PARTICLES — travel along each strand continuously  */}
      {/* ──────────────────────────────────────────────────────────── */}

      {/* Strand 1 particles (cyan/white) */}
      {DOTS_S1.map((p, j) => (
        <g key={`dp1-${j}`} filter={`url(#${F})`}>
          <circle r="5" fill="#00ffee" fillOpacity="0.95">
            <animateMotion
              dur={p.dur}
              begin={p.begin}
              repeatCount="indefinite"
              rotate="none"
            >
              <mpath href={`#${M1}`}/>
            </animateMotion>
          </circle>
          {/* Outer halo ring on each particle */}
          <circle r="9" fill="#00d4ff" fillOpacity="0.22">
            <animateMotion
              dur={p.dur}
              begin={p.begin}
              repeatCount="indefinite"
              rotate="none"
            >
              <mpath href={`#${M1}`}/>
            </animateMotion>
          </circle>
        </g>
      ))}

      {/* Strand 2 particles (blue/violet) */}
      {DOTS_S2.map((p, j) => (
        <g key={`dp2-${j}`} filter={`url(#${F})`}>
          <circle r="5" fill="#a5c8ff" fillOpacity="0.95">
            <animateMotion
              dur={p.dur}
              begin={p.begin}
              repeatCount="indefinite"
              rotate="none"
            >
              <mpath href={`#${M2}`}/>
            </animateMotion>
          </circle>
          <circle r="9" fill="#4488ff" fillOpacity="0.22">
            <animateMotion
              dur={p.dur}
              begin={p.begin}
              repeatCount="indefinite"
              rotate="none"
            >
              <mpath href={`#${M2}`}/>
            </animateMotion>
          </circle>
        </g>
      ))}
    </svg>
  );
}

// ─── Column layout: 3 helices staggered across the viewport ──────────────────
const COLS = [
  // left column — dimmer, slightly slower
  { left: "11%",  w: 180, dur: "68s", delay: "-24s", opacity: 0.055 },
  // centre column — the hero, most visible
  { left: "50%",  w: 300, dur: "46s", delay:   "0s", opacity: 0.14  },
  // right column — dimmer, different phase
  { left: "89%",  w: 180, dur: "75s", delay: "-38s", opacity: 0.055 },
] as const;

// ─── Root export ─────────────────────────────────────────────────────────────
export function DnaHelixBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none select-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      {/* Deep blue atmospheric glow — matches DNA image palette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 110% 65% at 50% 30%, rgba(0,30,110,0.28) 0%, rgba(0,5,25,0) 70%)",
        }}
      />

      {/* The three helix columns */}
      {COLS.map((col, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left:           col.left,
            top:            "-5%",
            height:         "110%",
            width:          col.w,
            transform:      "translateX(-50%)",
            opacity:        col.opacity,
            animation:      `dna-helix-drift ${col.dur} linear infinite`,
            animationDelay: col.delay,
            willChange:     "transform",
          }}
        >
          <HelixSvg uid={`h${i}`} />
        </div>
      ))}

      {/* ── Overlays to keep content readable ── */}

      {/* Radial vignette — darkens far edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 22%, rgba(0,0,0,0.68) 100%)",
        }}
      />

      {/* Bottom blackout — keeps bottom nav/data clean */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48"
        style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.92))" }}
      />

      {/* Top blackout — keeps nav clean */}
      <div
        className="absolute top-0 left-0 right-0 h-24"
        style={{ background: "linear-gradient(to top, transparent, rgba(0,0,0,0.88))" }}
      />
    </div>
  );
}
