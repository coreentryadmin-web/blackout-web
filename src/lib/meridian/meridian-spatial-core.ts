/**
 * Meridian spatial/3D core — pure layout + projection math for the depth layer.
 *
 * ── WHY CSS 3D + SVG AND NOT THREE.JS ────────────────────────────────────────────────
 * Every spatial view Meridian's data supports is 2.5D: layered rings on parallel planes, and
 * a tilted disc of orbiting pillars. Neither needs a scene graph, lighting, materials or a
 * depth buffer. Three.js/R3F would add ~150KB gzipped to a desk whose brief explicitly says
 * never to hurt initial load, in exchange for no additional ENCODING — the information is
 * carried by radius, size, colour and parallax, all of which CSS transforms and SVG express
 * exactly. The tilt is a single `rotateX/rotateY` on a `preserve-3d` parent: compositor-only,
 * no per-frame layout, and it degrades to a flat, fully readable diagram the moment 3D is
 * unavailable or unwanted. If a genuinely volumetric view ever earns its place (a real
 * surface over strike x time), that is the point to reach for WebGL — and to lazy-load it.
 *
 * ── WHAT IS DELIBERATELY NOT BUILT ───────────────────────────────────────────────────
 * Measured against the live payload, not assumed:
 *   • Globe / map — earnings data carries no geography. A globe would be the exact
 *     "floating object because it looks futuristic" the brief rules out.
 *   • Ranking towers over districts/regions — no such dimension exists here.
 *   • Depth-based time scrubber — the event payload is CURRENT STATE only. There are no
 *     historical score snapshots (`estimate_revision_timeline` returns 0 rows live), so
 *     scrubbing "through weeks" would animate invented history.
 *   • Peer distribution — of 360 timeline rows only 22 carry a surprise value, and a
 *     PRE-print ticker has none at all, so the selected entity would be absent from its own
 *     distribution in the common case. The premise fails on the data.
 * Each of those needs a data change first, not a rendering change.
 */

import { clamp, num, round, type MeridianDimension, DIMENSION_ORDER, PILLAR_DIMENSION } from "./meridian-viz-core";

// ── Perspective projection ───────────────────────────────────────────────────────────

export type Point3 = { x: number; y: number; z: number };
export type Projected = { x: number; y: number; /** 0..1, 1 = nearest the viewer */ depth: number; scale: number };

/**
 * Project a point in a unit cube onto the screen under a tilt, with weak perspective.
 *
 * `scale` is returned separately so callers size marks by depth — the cue that actually makes
 * a tilted disc read as tilted. Perspective strength is deliberately mild (`d` large relative
 * to the unit box): a strong lens exaggerates near-orbit differences and would make radius,
 * which ENCODES influence here, unreadable. Depth must decorate the encoding, never distort it.
 */
export function project(p: Point3, tiltXDeg: number, tiltYDeg: number, d = 3.2): Projected {
  const rx = (tiltXDeg * Math.PI) / 180;
  const ry = (tiltYDeg * Math.PI) / 180;
  // Rotate about Y then X.
  const cx = Math.cos(ry), sx = Math.sin(ry);
  const x1 = p.x * cx + p.z * sx;
  const z1 = -p.x * sx + p.z * cx;
  const cy = Math.cos(rx), sy = Math.sin(rx);
  const y2 = p.y * cy - z1 * sy;
  const z2 = p.y * sy + z1 * cy;
  const k = d / (d + z2);
  return {
    x: round(x1 * k, 5),
    y: round(y2 * k, 5),
    depth: round(clamp((z2 + 1) / 2, 0, 1), 5),
    scale: round(k, 5),
  };
}

// ── Pillar orbital system ────────────────────────────────────────────────────────────

export type OrbitalNode = {
  pillar: string;
  label: string;
  dimension: MeridianDimension;
  lean: "bullish" | "bearish" | "neutral";
  /** Angle in degrees around the disc. */
  angle: number;
  /** 0..1 — distance from centre. SMALLER = more influential (see below). */
  radius: number;
  /** 0..1 — mark size, from |score|. */
  size: number;
  weight: number;
  score: number;
  detail: string;
};

// The innermost orbit has to CLEAR the core mark, not merely be smaller than the disc: a heavy
// pillar lands here, and at 0.34 its orb painted straight over the centre (observed live on
// AXIL). Set from the geometry — core mark radius + the largest orb radius + a hair.
export const ORBIT_INNER = 0.42;
const ORBIT_OUTER = 1;

/** The orbit guide radii, as fractions of R. Exported so the rings the component draws are the
 *  same band the layout places nodes in — two hard-coded copies drift the moment one changes. */
export const ORBIT_GUIDES = [ORBIT_INNER, (ORBIT_INNER + ORBIT_OUTER) / 2, ORBIT_OUTER] as const;

/**
 * Lay pillars out as an orbital system around the verdict.
 *
 * The encoding, stated so it can be checked rather than admired:
 *   ANGLE  — grouped into per-dimension sectors, so related pillars cluster and "relationship"
 *            is literal angular proximity. Sector width is proportional to how many pillars a
 *            dimension actually has, so a 4-pillar dimension is not squeezed to match a 1.
 *   RADIUS — INVERSE weight. Heavy pillars sit CLOSE to the centre because they pull the
 *            verdict hardest; light ones drift to the rim. This is the one non-obvious choice
 *            and it is deliberate: "near the middle" reads as "near the answer".
 *   SIZE   — |score|, the magnitude this pillar contributed.
 *   COLOUR — lean.
 *
 * A viewer can therefore answer "what is driving this verdict, and do the heavy things agree?"
 * from position and colour alone — which is the whole justification for spending depth on it.
 */
export function orbitalLayout(
  signals: ReadonlyArray<{ pillar?: string | null; label?: string | null; lean?: string | null; weight?: number | null; score?: number | null; detail?: string | null }> | null | undefined
): OrbitalNode[] {
  const rows = (signals ?? []).filter((s) => s.pillar && PILLAR_DIMENSION[String(s.pillar)]);
  if (rows.length === 0) return [];

  const weights = rows.map((s) => Math.abs(num(s.weight) ?? 1) || 1);
  const maxWeight = Math.max(...weights);
  const minWeight = Math.min(...weights);
  // Normalize across the OBSERVED spread, not 0..max: otherwise a book whose lightest pillar
  // still carries real weight never reaches the rim, and most of the orbit range goes unused.
  // The question the ring answers is "which pillars dominate THIS verdict", which is relative.
  const wSpan = maxWeight - minWeight;
  const scores = rows.map((s) => Math.abs(num(s.score) ?? 0));
  const maxScore = Math.max(...scores, 1);

  // Group into dimensions, preserving the canonical dimension order around the disc.
  const byDim = new Map<MeridianDimension, typeof rows>();
  for (const s of rows) {
    const dim = PILLAR_DIMENSION[String(s.pillar)]!;
    byDim.set(dim, [...(byDim.get(dim) ?? []), s]);
  }
  const dims = DIMENSION_ORDER.filter((d) => byDim.has(d));
  const total = rows.length;

  const out: OrbitalNode[] = [];
  let angleCursor = 0;
  for (const dim of dims) {
    const members = byDim.get(dim)!;
    const sectorDeg = (members.length / total) * 360;
    members.forEach((s, i) => {
      const w = Math.abs(num(s.weight) ?? 1) || 1;
      const sc = Math.abs(num(s.score) ?? 0);
      // Spread members evenly INSIDE their sector, centred — so a lone pillar sits at the
      // sector's midpoint rather than on its boundary where it would read as belonging to
      // the neighbouring dimension.
      const step = sectorDeg / (members.length + 1);
      out.push({
        pillar: String(s.pillar),
        label: s.label ?? String(s.pillar),
        dimension: dim,
        lean: (s.lean === "bullish" || s.lean === "bearish" ? s.lean : "neutral") as OrbitalNode["lean"],
        angle: round(angleCursor + step * (i + 1), 3),
        // All-equal weights carry no ranking, so they share one mid orbit rather than being
        // forced apart into a hierarchy the data does not contain.
        radius: round(
          wSpan > 0
            ? ORBIT_OUTER - ((w - minWeight) / wSpan) * (ORBIT_OUTER - ORBIT_INNER)
            : (ORBIT_OUTER + ORBIT_INNER) / 2,
          4
        ),
        size: round(clamp(sc / maxScore, 0.18, 1), 4),
        weight: w,
        score: num(s.score) ?? 0,
        detail: s.detail ?? "",
      });
    });
    angleCursor += sectorDeg;
  }
  return out;
}

/** Screen position for an orbital node under a tilt. Radius is in unit-disc space. */
export function orbitalPoint(node: OrbitalNode, tiltXDeg: number, tiltYDeg: number): Projected {
  const rad = (node.angle * Math.PI) / 180;
  return project({ x: Math.cos(rad) * node.radius, y: Math.sin(rad) * node.radius, z: 0 }, tiltXDeg, tiltYDeg);
}

// ── Tilt from pointer ────────────────────────────────────────────────────────────────

/**
 * Pointer position (0..1 within an element) → tilt degrees.
 *
 * Capped low on purpose. Past roughly 14° a tilted ring's near and far edges differ enough in
 * apparent radius that a viewer starts reading the distortion as data — which inverts the
 * point of the whole layer. The cap is the difference between an instrument that responds and
 * a toy that wobbles.
 */
export function tiltFromPointer(nx: number, ny: number, maxDeg = 12): { x: number; y: number } {
  const cx = clamp(nx, 0, 1) - 0.5;
  const cy = clamp(ny, 0, 1) - 0.5;
  return {
    // Y pointer drives rotateX with an inverted sign so the surface leans TOWARD the cursor.
    x: round(-cy * 2 * maxDeg, 3),
    y: round(cx * 2 * maxDeg, 3),
  };
}

// ── Concentric ring stack ────────────────────────────────────────────────────────────

export type RingLayer = {
  key: "pillars" | "agreement" | "confidence";
  label: string;
  /** 0..1 fill of the ring. */
  value: number;
  /** Radius as a fraction of the halo's outer radius. */
  radius: number;
  /** Z offset in px — layers sit on parallel planes so tilt separates them. */
  z: number;
};

const CONFIDENCE_VALUE: Record<string, number> = { low: 0.33, medium: 0.66, high: 1 };

/**
 * Three concentric layers on parallel Z planes: the pillar ring, the agreement ring, and the
 * confidence core. They are distinct QUESTIONS, which is why depth separates them rather than
 * colour: "what does the evidence say", "does it agree", "how sure is the model". Flattened
 * into one ring they read as a single score and the distinction is lost — which is exactly
 * what the flat halo could not express.
 *
 * Returns null when agreement is unknown; a stack missing its middle layer would imply
 * consensus we did not measure.
 */
export function ringStack(
  agreement: number | null | undefined,
  confidence: string | null | undefined,
  pillarFill = 1
): RingLayer[] | null {
  const a = num(agreement);
  if (a === null) return null;
  const conf = CONFIDENCE_VALUE[String(confidence ?? "").toLowerCase()] ?? null;
  const layers: RingLayer[] = [
    { key: "pillars", label: "Evidence", value: clamp(pillarFill, 0, 1), radius: 1, z: 0 },
    { key: "agreement", label: "Agreement", value: clamp(a, 0, 1), radius: 0.8, z: 14 },
  ];
  // Confidence is optional — an unlabelled model confidence must not become a full core.
  if (conf !== null) {
    // 0.62, not 0.46: measured on the rendered halo, the tighter core ring cut straight through
    // the centred verdict/score/agreement text. The innermost ring must clear the readout —
    // depth is worthless if it costs the number it surrounds.
    layers.push({ key: "confidence", label: "Confidence", value: conf, radius: 0.62, z: 28 });
  }
  return layers;
}

// ── Orbital label placement ──────────────────────────────────────────────────────────

export type OrbitalGeometry = {
  /** The box size actually used — may exceed the requested one, see MIN_ORBITAL_SIZE. */
  size: number;
  /** Radius of the outermost orbit, px. */
  R: number;
  /** Radius of the ring every LABEL is projected onto, px. */
  rimR: number;
  /** Room a rim label actually has before it leaves the box, px. */
  labelMaxW: number;
};

/**
 * Disc geometry for a given box size.
 *
 * The orbit radius is set by what the LABELS need, not by what looks generous for the orbs:
 * the box has to hold `rimR + label width`, so the disc is deliberately small relative to its
 * container. Sizing the disc first and hoping the text fits is exactly what put four labels on
 * top of each other in the live NKLR render.
 */
export function orbitalGeometry(size: number): OrbitalGeometry {
  // The margin is what the LABELS get: room = half - rimR = margin - 10. Growing the box grows
  // the disc; only this margin widens the labels. 68px of room forced "Street / analysts",
  // "News & catalysts" and "Insider activity" to ellipsis on the live render, so it is now 96.
  //
  // Capped as a FRACTION of the box as well, because on a small box a fixed 96 leaves almost no
  // disc — and `labelMaxW` is DERIVED rather than a second constant, so a label can never be
  // allowed to be wider than the room it has. A constant that has to agree with a geometry is a
  // constant that eventually disagrees with it.
  const box = Math.max(size, MIN_ORBITAL_SIZE);
  const margin = Math.min(LABEL_MARGIN, box * 0.3);
  const R = box / 2 - margin;
  const rimR = R + 10;
  return { size: box, R, rimR, labelMaxW: round(box / 2 - rimR, 3) };
}

const LABEL_MARGIN = 96;

/**
 * Below this the diagram cannot be drawn honestly: the innermost orbit stops clearing the core
 * mark, so the heaviest pillar — the one the reader most needs — paints over the centre. Rather
 * than render a broken disc at whatever size it was handed, the geometry takes the floor and the
 * component sizes its box from `geo.size`. Refusing to shrink past a legibility limit is the
 * same principle as "no data, no mark": better a diagram that takes the room it needs than one
 * that lies at the size it was given.
 */
export const MIN_ORBITAL_SIZE = 300;

/**
 * Where a node's label sits, expressed as an offset from the ORB (which is where the label is
 * mounted in the DOM) plus a horizontal anchor.
 *
 * Every label lands on ONE shared rim ring, so the gap between two labels is their ANGULAR
 * separation — which the layout already guarantees, since each pillar gets its own slot inside
 * its dimension's sector. Anchoring a label under its own orb instead (the obvious choice)
 * collides as soon as pillars sit at similar radii, and a constant radial nudge does not help
 * because inner orbs stay inner.
 *
 * The anchor makes the text read OUTWARD from the disc — right-side nodes start at the rim,
 * left-side nodes end at it. Without it the text runs back across the diagram and over the core.
 */
export function orbitalLabelOffset(
  node: Pick<OrbitalNode, "angle" | "radius">,
  geo: OrbitalGeometry
): { lx: number; ly: number; anchor: "0%" | "-50%" | "-100%" } {
  const a = (node.angle * Math.PI) / 180;
  const d = geo.rimR - node.radius * geo.R;
  const cos = Math.cos(a);
  return {
    lx: round(cos * d, 3),
    ly: round(Math.sin(a) * d, 3),
    // The dead band around vertical keeps a near-top/bottom label centred rather than flipping
    // side on a fractional angle change.
    anchor: cos > 0.25 ? "0%" : cos < -0.25 ? "-100%" : "-50%",
  };
}
