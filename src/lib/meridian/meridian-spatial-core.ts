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

const ORBIT_INNER = 0.34;
const ORBIT_OUTER = 1;

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
