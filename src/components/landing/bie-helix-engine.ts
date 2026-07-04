// Geometry for the alive BIE helix mesh — pure functions, unit-testable.

import { chordPath, goldenSpiralPoint, pointOnEllipse } from "./bie-brain-geometry";

export type Satellite = {
  id: string;
  label: string;
  detail: string;
  angleDeg: number;
  /** 0 = inner intelligence ring, 1 = mid, 2 = outer deliver ring */
  ring: 0 | 1 | 2;
  accent: string;
};

export type PlacedSatellite = Satellite & { x: number; y: number; rx: number; ry: number };

export type MeshWire = {
  id: string;
  d: string;
  kind: "spoke" | "ring" | "cross" | "rung" | "feedback";
  accent: string;
  satelliteId?: string;
};

const RING_SCALE: Record<0 | 1 | 2, number> = { 0: 0.38, 1: 0.58, 2: 0.78 };

export function ringRadii(ring: 0 | 1 | 2, maxRx: number, maxRy: number): { rx: number; ry: number } {
  const s = RING_SCALE[ring];
  return { rx: maxRx * s, ry: maxRy * s };
}

export function placeSatellite(
  cx: number,
  cy: number,
  sat: Satellite,
  maxRx: number,
  maxRy: number
): PlacedSatellite {
  const { rx, ry } = ringRadii(sat.ring, maxRx, maxRy);
  const { x, y } = pointOnEllipse(cx, cy, rx, ry, sat.angleDeg);
  return { ...sat, x, y, rx, ry };
}

export function placeSatellites(
  cx: number,
  cy: number,
  satellites: Satellite[],
  maxRx: number,
  maxRy: number
): PlacedSatellite[] {
  return satellites.map((s) => placeSatellite(cx, cy, s, maxRx, maxRy));
}

/** Ellipse path for a visible ring guide (SVG `d`). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

/** DNA-style rungs between two ellipses at the same radii, phase-shifted by half a step. */
export function buildHelixRungs(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
  phaseOffsetDeg: number
): { x1: number; y1: number; x2: number; y2: number; depth: number }[] {
  const rungs: { x1: number; y1: number; x2: number; y2: number; depth: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a1 = (360 / count) * i + phaseOffsetDeg;
    const a2 = a1 + 180;
    const p1 = pointOnEllipse(cx, cy, rx, ry, a1);
    const p2 = pointOnEllipse(cx, cy, rx * 0.92, ry * 0.92, a2);
    const rad = ((a1 - 90) * Math.PI) / 180;
    const depth = Math.abs(Math.cos(rad));
    rungs.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, depth });
  }
  return rungs;
}

export function buildMeshWires(
  cx: number,
  cy: number,
  placed: PlacedSatellite[],
  outputsId: string
): MeshWire[] {
  const wires: MeshWire[] = [];

  for (const s of placed) {
    wires.push({
      id: `spoke-${s.id}`,
      d: chordPath(cx, cy, s.x, s.y, cx, cy, 0),
      kind: "spoke",
      accent: s.accent,
      satelliteId: s.id,
    });
  }

  const byRing = new Map<number, PlacedSatellite[]>();
  for (const s of placed) {
    const list = byRing.get(s.ring) ?? [];
    list.push(s);
    byRing.set(s.ring, list);
  }

  for (const [, ringSats] of byRing) {
    const sorted = [...ringSats].sort((a, b) => a.angleDeg - b.angleDeg);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      wires.push({
        id: `ring-${a.id}-${b.id}`,
        d: chordPath(a.x, a.y, b.x, b.y, cx, cy, 18 + a.ring * 8),
        kind: "ring",
        accent: "#5df7ff",
      });
    }
    if (sorted.length >= 3) {
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const b = sorted[(i + 2) % sorted.length];
        wires.push({
          id: `cross-${a.id}-${b.id}`,
          d: chordPath(a.x, a.y, b.x, b.y, cx, cy, 36 + a.ring * 12),
          kind: "cross",
          accent: "#bf5fff",
        });
      }
    }
  }

  const outputs = placed.find((s) => s.id === outputsId);
  if (outputs) {
    wires.push({
      id: "feedback-loop",
      d: chordPath(outputs.x, outputs.y, cx, cy, cx, cy, -72),
      kind: "feedback",
      accent: "#bf5fff",
      satelliteId: outputsId,
    });
  }

  return wires;
}

export function buildStarField(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  count: number
): { x: number; y: number; r: number; opacity: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const p = goldenSpiralPoint(cx, cy, maxRx, maxRy, i, count);
    return {
      x: p.x,
      y: p.y,
      r: i % 7 === 0 ? 1.4 : 0.9,
      opacity: 0.15 + (i % 5) * 0.08,
    };
  });
}

/** Path for a captured particle: outer edge → core → exit toward outputs. */
export function captureParticlePath(
  cx: number,
  cy: number,
  entryAngle: number,
  maxRx: number,
  maxRy: number,
  exitAngle: number
): string {
  const outer = pointOnEllipse(cx, cy, maxRx * 0.92, maxRy * 0.92, entryAngle);
  const mid = pointOnEllipse(cx, cy, maxRx * 0.5, maxRy * 0.5, entryAngle + 40);
  const exit = pointOnEllipse(cx, cy, maxRx * 0.72, maxRy * 0.72, exitAngle);
  return `M ${outer.x} ${outer.y} Q ${mid.x} ${mid.y} ${cx} ${cy} Q ${mid.x + 12} ${mid.y - 8} ${exit.x} ${exit.y}`;
}

export function pulseTiming(kind: MeshWire["kind"], i: number): { dur: number; delay: number } {
  const base = kind === "spoke" ? 2.2 : kind === "ring" ? 3.4 : kind === "feedback" ? 5.2 : 4.8;
  return { dur: base + (i % 4) * 0.28, delay: -((i * 0.53) % base) };
}
