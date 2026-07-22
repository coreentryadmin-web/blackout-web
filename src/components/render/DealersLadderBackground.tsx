"use client";

/**
 * DealersLadderBackground — the SIGNATURE "Phosphor Ladder" background, rendered as
 * a single full-screen quad driven by a hand-written raw-WebGL fragment shader (NO
 * three.js, NO deps). This is the ONE sanctioned ambient loop in the motion system:
 * the Dealer's Ladder reading the live gamma book.
 *
 * WHAT THE SHADER DRAWS (all layered, with depth — never a flat plasma):
 *   • strike ladder      — hairline rungs at REAL strikes (data-shaped, few % around spot),
 *                          not a fabricated 17%-above-spot ramp.
 *   • gamma beads        — additive glow per (strike, timestep); size/brightness = |GEX|,
 *                          hue = sign (bull call-wall / bear put-wall / gold KING).
 *   • integrity rings    — SDF annuli at the tolerance radius: firm (in-tolerance) →
 *                          moderate → thin/dashed (out-of-tolerance/stale). Same firm/
 *                          moderate/thin language the CSS chips read.
 *   • CRT afterglow      — each bead trails a short left-leaning smear as it marches off-edge.
 *   • dark-pool substrate— faint cyan prints RISING from the deepest black (hidden liquidity).
 *   • overlays           — sky spot scan line + ONE violet dashed gamma-flip rule + hairline grid.
 *
 * TIME flows right→left like intraday tape; walls FORM → GROW → FADE.
 *
 * HARD REQUIREMENTS honored here:
 *   • DPR capped at 2.
 *   • Paused (rAF cancelled) when offscreen (IntersectionObserver) or document hidden.
 *   • prefers-reduced-motion → FULL fallback to a static CSS gradient, zero rAF, no GL.
 *   • WebGL unavailable/lost → render nothing on the canvas (reveal the CSS gradient), never throw.
 *   • Resize-aware (ResizeObserver) and DPR-change-aware.
 *   • Complete teardown on unmount (rAF, observers, listeners, GL objects, forced context loss).
 *
 * All color literals below are the design tokens (globals.css :root) hard-coded into the
 * shader so a colored pixel always encodes signal — the "if a pixel is colored, it encodes
 * information" lint made physical.
 */

import { useEffect, useRef, useState } from "react";

/* ── Data contract ──────────────────────────────────────────────────────────
 * The same clean GEX shape the hardcore E2E already asserts:
 * finite / descending magnitude / magnitude ∈ [0,1] / one-king-per-side.
 */
export interface GammaLadderRow {
  /** Real strike price (used only for relative vertical placement around spot). */
  strike: number;
  /** Normalized |GEX| magnitude ∈ [0,1]. */
  magnitude: number;
  /** +1 positive-gamma / call wall, -1 put wall, 0 neutral. */
  sign: 1 | 0 | -1;
  /** Dominant wall on its side — draws gold + a firm calibration ring. One per side. */
  king?: boolean;
}

export interface GammaBook {
  /** Spot price — anchors the ladder band and the sky scan line. */
  spot: number;
  /** Gamma-flip strike — the single violet dashed rule. */
  flip: number;
  /** Rows, any order; placed by strike relative to spot. */
  rows: GammaLadderRow[];
}

/**
 * Baked recorded SPX 0DTE snapshot. Real-shaped (strikes a few % around a ~6470 spot,
 * one king per side, descending magnitudes) so the default render is honest even with
 * no live prop wired. Replace via the `book` prop with the live clean-GEX JSON.
 */
const DEFAULT_BOOK: GammaBook = {
  spot: 6472,
  flip: 6455,
  rows: [
    { strike: 6600, magnitude: 0.34, sign: 1 },
    { strike: 6550, magnitude: 0.58, sign: 1 },
    { strike: 6525, magnitude: 0.41, sign: 1 },
    { strike: 6500, magnitude: 1.0, sign: 1, king: true }, // call-wall KING
    { strike: 6480, magnitude: 0.29, sign: 1 },
    { strike: 6455, magnitude: 0.22, sign: 0 }, // flip / neutral
    { strike: 6440, magnitude: 0.36, sign: -1 },
    { strike: 6420, magnitude: 0.52, sign: -1 },
    { strike: 6400, magnitude: 0.93, sign: -1, king: true }, // put-wall KING
    { strike: 6375, magnitude: 0.44, sign: -1 },
    { strike: 6350, magnitude: 0.3, sign: -1 },
    { strike: 6300, magnitude: 0.19, sign: -1 },
  ],
};

const MAX_ROWS = 16; // shader uniform-array capacity; keep in sync with the shader const.
const DPR_CAP = 2;

/* ── Shaders (GLSL ES 1.00) ────────────────────────────────────────────────── */

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// prettier-ignore
const FRAG_SRC = `
// Some low-end GPUs lack highp in the fragment stage; fall back cleanly to mediump
// instead of failing to compile (which would silently drop us to the static gradient).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_res;
uniform float u_time;

// ladder data — flattened, placed on the vertical axis
uniform int   u_rowCount;
uniform float u_rowY[${MAX_ROWS}];    // normalized vertical position 0..1
uniform float u_rowMag[${MAX_ROWS}];  // |GEX| magnitude 0..1
uniform float u_rowSign[${MAX_ROWS}]; // -1 / 0 / +1
uniform float u_rowKing[${MAX_ROWS}]; // 0 / 1
uniform float u_spotY;                // sky scan-line base position
uniform float u_flipY;                // violet dashed flip rule

// ── design tokens (color only ever enters as signal) ──────────────────────
const vec3 GROUND = vec3(0.0157, 0.0157, 0.0275); // #040407
const vec3 BRAND  = vec3(0.749, 0.373, 1.0);      // #bf5fff violet chrome / flip
const vec3 BULL   = vec3(0.0,   0.902, 0.463);    // #00e676 call wall
const vec3 BEAR   = vec3(1.0,   0.176, 0.333);    // #ff2d55 put wall
const vec3 FLOW   = vec3(0.133, 0.827, 0.933);    // #22d3ee dark-pool / flow
const vec3 KING   = vec3(1.0,   0.824, 0.247);    // #ffd23f king / max-pain
const vec3 REF    = vec3(0.490, 0.827, 0.988);    // #7dd3fc sky spot scan

float hash(float n) { return fract(sin(n) * 43758.5453123); }

vec3 signColor(float s, float king) {
  if (king > 0.5) return KING;
  if (s > 0.5)    return BULL;
  if (s < -0.5)   return BEAR;
  return REF; // neutral rows read as reference sky
}

// SDF annulus: firm/moderate/thin integrity ring at the tolerance radius.
// width & sharpness derive from magnitude (strong wall = firm closed ring,
// weak wall = thin, angularly-broken ring) — the shared --ring-* language.
float integrityRing(vec2 p, float radius, float mag) {
  float d = length(p);
  float w = mix(0.010, 0.020, mag);        // thin -> firm width
  float edge = mix(0.010, 0.0035, mag);    // thin -> firm sharpness
  float ring = smoothstep(radius - w - edge, radius - w, d)
             - smoothstep(radius + w, radius + w + edge, d);
  // out-of-tolerance walls dash the ring (fract(angle) discard, done softly)
  float ang = atan(p.y, p.x);
  float dash = smoothstep(0.35, 0.5, abs(fract(ang * 6.0) - 0.5));
  float broken = mix(dash, 1.0, smoothstep(0.5, 0.85, mag)); // firm rings stay closed
  return ring * broken;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;           // 0..1, origin bottom-left
  float aspect = u_res.x / u_res.y;
  vec3 col = GROUND;

  // ── LAYER 0 · dark-pool substrate (SOUNDING) — faint cyan prints rising ──
  // Lowest z: hidden liquidity welling up from the deepest black, dissolving.
  {
    float lanes = 9.0;
    float lane = floor(uv.x * lanes);
    float lh = hash(lane * 3.31 + 11.0);
    float rise = fract(lh + u_time * 0.035 + lane * 0.13);
    float py = rise * 0.62;                      // rises through the lower band
    vec2 c = vec2((lane + 0.5) / lanes + (lh - 0.5) * 0.05, py);
    vec2 p = (uv - c); p.x *= aspect;
    float print = exp(-dot(p, p) * 70.0);
    float fade = (1.0 - rise) * smoothstep(0.7, 0.15, uv.y); // strongest low, gone up high
    col += FLOW * print * fade * 0.28;
  }

  // ── LAYER 1 · hairline grid decoration (violet-at-low-alpha) ─────────────
  {
    // faint vertical time ticks marching left with the tape
    float tick = abs(fract(uv.x * 22.0 + u_time * 0.06) - 0.5);
    col += BRAND * smoothstep(0.49, 0.5, tick) * 0.012;
  }

  // ── LAYER 2 · the gamma book: rungs + marching beads + afterglow + rings ─
  vec3 ringCol = vec3(0.0);
  for (int i = 0; i < ${MAX_ROWS}; i++) {
    if (i >= u_rowCount) break;
    float y   = u_rowY[i];
    float mag = u_rowMag[i];
    float king= u_rowKing[i];
    vec3  c   = signColor(u_rowSign[i], king);
    float seed = float(i) * 17.13;

    // rung: a hairline rule at the strike
    float dy = (uv.y - y);
    float rung = exp(-dy * dy * 9000.0);
    col += c * rung * 0.05;                        // dim structural rung
    col += c * exp(-dy * dy * 260.0) * mag * 0.04; // magnitude haze around strong walls

    // marching beads: TIME flows right->left. New prints enter at the right,
    // discretized into cells; a cell lights as a bead with probability ~ magnitude.
    float cols = 26.0;
    // +time slides the pattern left; mod keeps the phase bounded so sin() in hash()
    // never loses precision after minutes of runtime. Wrap is integer-aligned (4096.0)
    // so cell boundaries stay in step and the wrap is an imperceptible reshuffle.
    float xc = uv.x * cols + mod(u_time * 3.0, 4096.0);
    float cell = floor(xc);
    float fx = fract(xc) - 0.5;
    float present = step(1.0 - clamp(mag, 0.0, 1.0) * 0.9, hash(cell + seed));

    // asymmetric gaussian: short CRT afterglow smear trailing to the LEFT
    float k = (fx < 0.0) ? 6.0 : 22.0;             // left tail longer than right
    float bead = present * exp(-fx * fx * k);
    float band = exp(-dy * dy * 5200.0);           // vertical confinement to the rung
    // phosphor persistence: a slow per-cell flicker toward full brightness
    float glow = 0.5 + 0.5 * sin(u_time * 2.2 + cell * 0.7 + seed);
    float life = smoothstep(0.0, 0.16, uv.x);      // dies off the left edge
    float b = bead * band * mag * life * (0.6 + 0.5 * glow);
    col += c * b * (king > 0.5 ? 1.7 : 1.15);      // additive: overlapping walls SUM

    // integrity ring at the live reading column (right side) for meaningful walls
    if (mag > 0.32) {
      vec2 center = vec2(0.865, y);
      vec2 p = (uv - center); p.x *= aspect;
      float r = mix(0.020, 0.040, mag);
      float ring = integrityRing(p, r, mag);
      ringCol += c * ring * (king > 0.5 ? 1.0 : 0.6);
    }
  }
  col += ringCol * 0.9;

  // ── LAYER 3 · overlays ───────────────────────────────────────────────────
  // spot scan (sky) — drifts gently across the rungs
  {
    float sy = u_spotY + sin(u_time * 0.35) * 0.02;
    float d = abs(uv.y - sy);
    col += REF * exp(-d * d * 5500.0) * 0.5;
    // travelling highlight sweeping along the scan line (square manually — pow() with a
    // negative base is undefined in GLSL, and this base straddles zero)
    float sx = fract(-u_time * 0.08) - uv.x;
    float sweep = exp(-sx * sx * 60.0);
    col += REF * exp(-d * d * 5500.0) * sweep * 0.6;
  }
  // gamma-flip — ONE violet dashed rule (fixes flip-color drift)
  {
    float d = abs(uv.y - u_flipY);
    float dash = step(0.5, fract(uv.x * 40.0));
    col += BRAND * exp(-d * d * 9000.0) * dash * 0.5;
  }

  // ── CRT finish · scanlines + vignette + gentle tone map ─────────────────
  float scan = 0.94 + 0.06 * sin(uv.y * u_res.y * 1.4);
  col *= scan;
  vec2 vig = uv - 0.5;
  col *= 1.0 - dot(vig, vig) * 0.55;               // vignette toward the void
  col = col / (col + vec3(0.72));                   // soft filmic knee, keeps the black black
  col = pow(col, vec3(0.92));                       // slight gamma lift on the phosphor

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── Tiny inline GL bootstrap (no deps) ─────────────────────────────────────── */

interface GLScene {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
  loseCtx: WEBGL_lose_context | null;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Fail soft — surface in dev, never throw in prod.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[DealersLadder] shader compile failed:", gl.getShaderInfoLog(sh));
    }
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildScene(canvas: HTMLCanvasElement): GLScene | null {
  const attrs: WebGLContextAttributes = {
    alpha: true, // let the CSS gradient show through if we ever stop clearing opaque
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: false,
  };
  const gl =
    (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ||
    (canvas.getContext("experimental-webgl", attrs) as WebGLRenderingContext | null);
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders can be detached/deleted immediately after a successful link.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[DealersLadder] program link failed:", gl.getProgramInfoLog(program));
    }
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  // Full-screen quad as a triangle strip in clip space.
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  gl.useProgram(program);
  const loc = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uniforms: GLScene["uniforms"] = {
    u_res: gl.getUniformLocation(program, "u_res"),
    u_time: gl.getUniformLocation(program, "u_time"),
    u_rowCount: gl.getUniformLocation(program, "u_rowCount"),
    u_rowY: gl.getUniformLocation(program, "u_rowY"),
    u_rowMag: gl.getUniformLocation(program, "u_rowMag"),
    u_rowSign: gl.getUniformLocation(program, "u_rowSign"),
    u_rowKing: gl.getUniformLocation(program, "u_rowKing"),
    u_spotY: gl.getUniformLocation(program, "u_spotY"),
    u_flipY: gl.getUniformLocation(program, "u_flipY"),
  };

  const loseCtx = gl.getExtension("WEBGL_lose_context");

  return { gl, program, buffer, uniforms, loseCtx };
}

/* ── Data → uniform packing ─────────────────────────────────────────────────── */

interface PackedBook {
  count: number;
  rowY: Float32Array;
  rowMag: Float32Array;
  rowSign: Float32Array;
  rowKing: Float32Array;
  spotY: number;
  flipY: number;
}

/**
 * Map real strikes onto the vertical axis. The band is padded a few % beyond the
 * min/max strike so beads never clip the edges, and spot/flip land in-band — this is
 * what kills the fabricated "17% above spot" ladder: geometry follows the real strikes.
 */
function packBook(book: GammaBook): PackedBook {
  const rows = book.rows.slice(0, MAX_ROWS);
  const strikes = rows.map((r) => r.strike);
  const lo = Math.min(...strikes, book.spot, book.flip);
  const hi = Math.max(...strikes, book.spot, book.flip);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));

  const rowY = new Float32Array(MAX_ROWS);
  const rowMag = new Float32Array(MAX_ROWS);
  const rowSign = new Float32Array(MAX_ROWS);
  const rowKing = new Float32Array(MAX_ROWS);

  rows.forEach((r, i) => {
    rowY[i] = norm(r.strike);
    // clamp defensively — the E2E asserts [0,1] but a live feed hiccup must not blow up geometry.
    rowMag[i] = Math.max(0, Math.min(1, Number.isFinite(r.magnitude) ? r.magnitude : 0));
    rowSign[i] = r.sign;
    rowKing[i] = r.king ? 1 : 0;
  });

  return {
    count: rows.length,
    rowY,
    rowMag,
    rowSign,
    rowKing,
    spotY: norm(book.spot),
    flipY: norm(book.flip),
  };
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export interface DealersLadderBackgroundProps {
  /** Live clean-GEX book. Falls back to a recorded SPX 0DTE snapshot. */
  book?: GammaBook;
  /** Extra classes for the fixed/absolute positioning wrapper. */
  className?: string;
  /** Overall opacity of the effect layer (the ground shows through underneath). */
  opacity?: number;
}

/** Static reduced-motion / no-WebGL fallback: the frozen crisp book as a CSS gradient. */
const STATIC_GRADIENT =
  "radial-gradient(120% 90% at 86% 42%, rgba(255,210,63,0.12), transparent 42%)," + // king glow
  "radial-gradient(90% 70% at 86% 70%, rgba(255,45,85,0.10), transparent 46%)," + // put wall
  "radial-gradient(80% 60% at 20% 30%, rgba(0,230,118,0.08), transparent 55%)," + // call side
  "radial-gradient(70% 90% at 50% 108%, rgba(34,211,238,0.08), transparent 55%)," + // dark pool
  "linear-gradient(180deg, #040407 0%, #06060c 55%, #040407 100%)";

export default function DealersLadderBackground({
  book = DEFAULT_BOOK,
  className = "",
  opacity = 1,
}: DealersLadderBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // `static` = show CSS gradient only (reduced-motion, no-WebGL, or context lost).
  const [mode, setMode] = useState<"gl" | "static">("static");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // FULL prefers-reduced-motion fallback: no GL, no rAF — the static gradient stands.
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) {
      setMode("static");
      return;
    }

    const scene = buildScene(canvas);
    if (!scene) {
      setMode("static"); // WebGL unavailable → gradient, never throw.
      return;
    }
    setMode("gl");

    const { gl, uniforms } = scene;
    const packed = packBook(book);

    let raf = 0;
    let running = false;
    let contextLost = false;
    // Monotonic tape clock: accumulate only while running, so pausing (offscreen /
    // hidden) freezes the tape instead of jumping it forward on resume.
    let elapsed = 0;
    let last = performance.now();

    // ── sizing (DPR capped at 2, resize + DPR-change aware) ──────────────────
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const draw = (now: number) => {
      raf = 0;
      if (contextLost) return;
      // Clamp the delta: a paused one-off repaint or a throttled background tab must
      // not fast-forward the tape. Only credit real per-frame time while running.
      const dt = running ? Math.min(now - last, 50) : 0;
      elapsed += dt;
      last = now;
      const t = elapsed / 1000;
      gl.uniform2f(uniforms.u_res, canvas.width, canvas.height);
      gl.uniform1f(uniforms.u_time, t);
      gl.uniform1i(uniforms.u_rowCount, packed.count);
      gl.uniform1fv(uniforms.u_rowY, packed.rowY);
      gl.uniform1fv(uniforms.u_rowMag, packed.rowMag);
      gl.uniform1fv(uniforms.u_rowSign, packed.rowSign);
      gl.uniform1fv(uniforms.u_rowKing, packed.rowKing);
      gl.uniform1f(uniforms.u_spotY, packed.spotY);
      gl.uniform1f(uniforms.u_flipY, packed.flipY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (running) raf = requestAnimationFrame(draw);
    };

    const play = () => {
      if (running || contextLost) return;
      running = true;
      last = performance.now(); // resume the clock without crediting paused time
      raf = requestAnimationFrame(draw);
    };
    const pause = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    // ── pause when offscreen OR document hidden ──────────────────────────────
    let onScreen = true;
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen && !document.hidden) play();
        else pause();
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (!document.hidden && onScreen) play();
      else pause();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ── resize handling ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      resize();
      // Repaint one frame immediately if paused so a resize isn't a blank flash.
      if (!running && !contextLost) requestAnimationFrame(draw);
    });
    ro.observe(canvas);
    const onDprChange = () => resize();
    window.addEventListener("resize", onDprChange);

    // ── context loss: render nothing, never throw; recover if it comes back ──
    const onLost = (e: Event) => {
      e.preventDefault(); // required for a restore to ever fire
      contextLost = true;
      pause();
      setMode("static");
    };
    const onRestored = () => {
      contextLost = false;
      // Rebuild is handled by remounting; simplest safe path is to fall back to static.
      // (Callers can key the component to force a fresh GL scene if desired.)
      setMode("static");
    };
    canvas.addEventListener("webglcontextlost", onLost as EventListener, false);
    canvas.addEventListener("webglcontextrestored", onRestored as EventListener, false);

    // reduced-motion can be toggled at runtime (OS setting) — respect it live.
    const onReduceChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        pause();
        setMode("static");
      }
    };
    // Safari <14 uses addListener; guard both.
    if (mql.addEventListener) mql.addEventListener("change", onReduceChange);
    else mql.addListener(onReduceChange);

    // kick off
    if (!document.hidden) play();

    // ── teardown ─────────────────────────────────────────────────────────────
    return () => {
      pause();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onDprChange);
      canvas.removeEventListener("webglcontextlost", onLost as EventListener, false);
      canvas.removeEventListener("webglcontextrestored", onRestored as EventListener, false);
      if (mql.removeEventListener) mql.removeEventListener("change", onReduceChange);
      else mql.removeListener(onReduceChange);
      // Free GL objects, then force the driver to reclaim the context.
      try {
        gl.deleteBuffer(scene.buffer);
        gl.deleteProgram(scene.program);
        scene.loseCtx?.loseContext();
      } catch {
        /* context may already be gone — ignore */
      }
    };
    // Re-run only when the book identity changes (packBook reads it once).
  }, [book]);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        opacity,
        // The static gradient is ALWAYS the substrate — it shows in reduced-motion,
        // no-WebGL, and context-lost cases with zero extra work.
        background: STATIC_GRADIENT,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          // Fade the canvas out (revealing the gradient) whenever GL isn't driving it.
          opacity: mode === "gl" ? 1 : 0,
          transition: "opacity 240ms ease",
        }}
      />
    </div>
  );
}
