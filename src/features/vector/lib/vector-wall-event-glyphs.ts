import { kingStrikeByTime } from "./vector-wall-rail-core";
import type { StrikeTrail, VectorWallLens } from "./vector-wall-history";
import type { VectorWallEvent, VectorWallEventKind } from "./vector-wall-events";

/** Visual vocabulary for sparse rail punctuation — circles stay beads; these sit on top. */
export type WallEventGlyphShape =
  | "birth_tick"
  | "death_x"
  | "handover_diamond"
  | "flip_triangle"
  | "break_chevron"
  | "flip_tick";

export type WallEventGlyph = {
  time: number;
  strike: number;
  shape: WallEventGlyphShape;
  side: "call" | "put" | "flip" | "spot";
  severity: "info" | "warn";
};

/** Event kinds worth drawing — building/fading are narrated in terminal only (too dense for the rail). */
export const CHART_GLYPH_EVENT_KINDS: ReadonlySet<VectorWallEventKind> = new Set([
  "call_wall_shift",
  "put_wall_shift",
  "call_wall_new",
  "put_wall_new",
  "call_wall_gone",
  "put_wall_gone",
  "flip_shift",
  "spot_crossed_flip",
  "spot_broke_call",
  "spot_broke_put",
]);

const KIND_SHAPE: Partial<Record<VectorWallEventKind, WallEventGlyphShape>> = {
  call_wall_shift: "handover_diamond",
  put_wall_shift: "handover_diamond",
  call_wall_new: "birth_tick",
  put_wall_new: "birth_tick",
  call_wall_gone: "death_x",
  put_wall_gone: "death_x",
  flip_shift: "flip_tick",
  spot_crossed_flip: "flip_triangle",
  spot_broke_call: "break_chevron",
  spot_broke_put: "break_chevron",
};

function sideFromKind(kind: VectorWallEventKind): "call" | "put" | "flip" | "spot" {
  if (kind.startsWith("call_")) return "call";
  if (kind.startsWith("put_")) return "put";
  if (kind === "spot_crossed_flip" || kind === "flip_shift") return "flip";
  return "spot";
}

function glyphKey(g: WallEventGlyph): string {
  return `${g.time}:${Math.round(g.strike)}:${g.shape}`;
}

function dedupeGlyphs(glyphs: WallEventGlyph[]): WallEventGlyph[] {
  const seen = new Set<string>();
  const out: WallEventGlyph[] = [];
  for (const g of glyphs) {
    const k = glyphKey(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}

/** Map a wall event to a chart glyph when it carries an anchor and is in the sparse draw set. */
export function wallEventToGlyph(ev: VectorWallEvent): WallEventGlyph | null {
  if (!CHART_GLYPH_EVENT_KINDS.has(ev.kind)) return null;
  const shape = KIND_SHAPE[ev.kind];
  if (!shape) return null;
  const strike = ev.strike ?? ev.flip;
  if (strike == null || !Number.isFinite(strike) || strike <= 0) return null;
  return {
    time: ev.time,
    strike,
    shape,
    side: ev.side ?? sideFromKind(ev.kind),
    severity: ev.severity,
  };
}

/** Birth/death + king handover glyphs derived from the trails actually on screen. */
export function trailDerivedGlyphs(
  trails: StrikeTrail[],
  side: "call" | "put",
  earliestBucket: number
): WallEventGlyph[] {
  const glyphs: WallEventGlyph[] = [];
  for (const trail of trails) {
    const pts = trail.points;
    if (pts.length === 0) continue;
    const first = pts[0]!;
    if (first.time > earliestBucket) {
      glyphs.push({
        time: first.time,
        strike: trail.strike,
        shape: "birth_tick",
        side,
        severity: "info",
      });
    }
    if (!trail.active && pts.length > 0) {
      const last = pts[pts.length - 1]!;
      glyphs.push({
        time: last.time,
        strike: trail.strike,
        shape: "death_x",
        side,
        severity: "info",
      });
    }
  }

  const kings = kingStrikeByTime(trails);
  const times = [...kings.keys()].sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    const t1 = times[i]!;
    const k0 = kings.get(times[i - 1]!)!;
    const k1 = kings.get(t1)!;
    if (k0 !== k1) {
      glyphs.push({
        time: t1,
        strike: k1,
        shape: "handover_diamond",
        side,
        severity: "info",
      });
    }
  }
  return glyphs;
}

export function composeWallEventGlyphs(opts: {
  events: readonly VectorWallEvent[];
  callTrails: StrikeTrail[];
  putTrails: StrikeTrail[];
  lens: VectorWallLens;
  earliestBucket: number;
  cursorTime?: number;
}): WallEventGlyph[] {
  const { events, callTrails, putTrails, lens, earliestBucket, cursorTime } = opts;
  const glyphs: WallEventGlyph[] = [];

  for (const ev of events) {
    if (ev.lens !== lens) continue;
    if (cursorTime != null && ev.time > cursorTime) continue;
    const g = wallEventToGlyph(ev);
    if (g) glyphs.push(g);
  }

  glyphs.push(...trailDerivedGlyphs(callTrails, "call", earliestBucket));
  glyphs.push(...trailDerivedGlyphs(putTrails, "put", earliestBucket));

  return dedupeGlyphs(glyphs);
}

type CanvasCtx = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "fill"
  | "closePath"
  | "strokeStyle"
  | "fillStyle"
  | "lineWidth"
  | "globalAlpha"
>;

/** Paint one glyph centered at (x, y) — called from the rail primitive after beads. */
export function drawWallEventGlyph(
  ctx: CanvasCtx,
  shape: WallEventGlyphShape,
  x: number,
  y: number,
  color: string,
  alpha: number,
  severity: "info" | "warn"
): void {
  const a = Math.min(1, alpha * (severity === "warn" ? 1 : 0.92));
  const stroke = color;
  const warn = "#fbbf24";
  ctx.save();
  ctx.lineWidth = shape === "birth_tick" ? 2 : 1.5;

  switch (shape) {
    case "birth_tick": {
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
      ctx.stroke();
      break;
    }
    case "death_x": {
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = a * 0.55;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
      break;
    }
    case "handover_diamond": {
      ctx.fillStyle = stroke;
      ctx.globalAlpha = a * 0.85;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "flip_triangle": {
      ctx.fillStyle = severity === "warn" ? warn : "#22d3ee";
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 6, y + 5);
      ctx.lineTo(x - 6, y + 5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "break_chevron": {
      ctx.strokeStyle = warn;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 3);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x + 5, y - 3);
      ctx.stroke();
      break;
    }
    case "flip_tick": {
      ctx.strokeStyle = "#22d3ee";
      ctx.globalAlpha = a * 0.75;
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
