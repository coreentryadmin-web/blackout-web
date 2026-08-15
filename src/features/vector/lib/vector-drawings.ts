/**
 * Member drawing annotations on the Vector intraday chart — pure types + geometry.
 * Persisted per ticker via vector-drawings-store.ts; rendered by price-lines (hline)
 * and vector-drawings-primitive.ts (everything else).
 */

export type VectorDrawTool =
  | "select"
  | "hline"
  | "trend"
  | "ray"
  | "rect"
  | "text"
  | "fib"
  | "vline";

export type VectorDrawColorId = "cyan" | "green" | "red" | "amber" | "white";

export const VECTOR_DRAW_COLORS: Record<VectorDrawColorId, string> = {
  cyan: "#22d3ee",
  green: "#a3e635",
  red: "#ff2d55",
  amber: "#ff8a3d",
  white: "#e7eef6",
};

export const VECTOR_DRAW_COLOR_IDS = Object.keys(VECTOR_DRAW_COLORS) as VectorDrawColorId[];

export type VectorDrawingBase = {
  id: string;
  color: VectorDrawColorId;
  createdAt: number;
};

export type VectorHLineDrawing = VectorDrawingBase & {
  kind: "hline";
  price: number;
  label?: string;
};

export type VectorTrendDrawing = VectorDrawingBase & {
  kind: "trend" | "ray";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
};

export type VectorRectDrawing = VectorDrawingBase & {
  kind: "rect";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
};

export type VectorTextDrawing = VectorDrawingBase & {
  kind: "text";
  t: number;
  price: number;
  text: string;
};

export type VectorFibDrawing = VectorDrawingBase & {
  kind: "fib";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
};

export type VectorVLineDrawing = VectorDrawingBase & {
  kind: "vline";
  t: number;
  label?: string;
};

export type VectorDrawing =
  | VectorHLineDrawing
  | VectorTrendDrawing
  | VectorRectDrawing
  | VectorTextDrawing
  | VectorFibDrawing
  | VectorVLineDrawing;

export const VECTOR_FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const VECTOR_DRAW_TOOL_LABELS: Record<VectorDrawTool, string> = {
  select: "Select",
  hline: "Horizontal",
  trend: "Trendline",
  ray: "Ray",
  rect: "Zone",
  text: "Text",
  fib: "Fib",
  vline: "Vertical",
};

export const VECTOR_DRAW_TOOL_SHORTCUTS: Partial<Record<VectorDrawTool, string>> = {
  select: "V",
  hline: "H",
  trend: "T",
  ray: "R",
  rect: "Z",
  text: "N",
  fib: "F",
  vline: "I",
};

let drawIdSeq = 0;

/** Stable-enough client id for a new drawing. */
export function newDrawingId(): string {
  drawIdSeq += 1;
  return `draw-${Date.now()}-${drawIdSeq}`;
}

export function isVectorDrawColorId(v: unknown): v is VectorDrawColorId {
  return typeof v === "string" && (VECTOR_DRAW_COLOR_IDS as readonly string[]).includes(v);
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Filter malformed persisted rows — never crash the chart on a bad localStorage blob. */
export function sanitizeDrawing(raw: unknown): VectorDrawing | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isVectorDrawColorId(o.color)) return null;
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
  const base = { id: o.id, color: o.color, createdAt };

  switch (o.kind) {
    case "hline":
      return isFiniteNum(o.price) && o.price > 0
        ? { ...base, kind: "hline", price: o.price, label: typeof o.label === "string" ? o.label : undefined }
        : null;
    case "trend":
    case "ray":
      return isFiniteNum(o.t1) && isFiniteNum(o.p1) && isFiniteNum(o.t2) && isFiniteNum(o.p2)
        ? { ...base, kind: o.kind, t1: o.t1, p1: o.p1, t2: o.t2, p2: o.p2 }
        : null;
    case "rect":
      return isFiniteNum(o.t1) && isFiniteNum(o.p1) && isFiniteNum(o.t2) && isFiniteNum(o.p2)
        ? { ...base, kind: "rect", t1: o.t1, p1: o.p1, t2: o.t2, p2: o.p2 }
        : null;
    case "text":
      return isFiniteNum(o.t) && isFiniteNum(o.price) && typeof o.text === "string" && o.text.length > 0
        ? { ...base, kind: "text", t: o.t, price: o.price, text: o.text.slice(0, 120) }
        : null;
    case "fib":
      return isFiniteNum(o.t1) && isFiniteNum(o.p1) && isFiniteNum(o.t2) && isFiniteNum(o.p2)
        ? { ...base, kind: "fib", t1: o.t1, p1: o.p1, t2: o.t2, p2: o.p2 }
        : null;
    case "vline":
      return isFiniteNum(o.t)
        ? { ...base, kind: "vline", t: o.t, label: typeof o.label === "string" ? o.label : undefined }
        : null;
    default:
      return null;
  }
}

export function snapPriceToBar(
  price: number,
  bar: { open: number; high: number; low: number; close: number } | null | undefined
): number {
  if (!bar) return price;
  const candidates = [bar.open, bar.high, bar.low, bar.close];
  let best = price;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - price);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** Fib price levels between two anchor prices (low→high independent of click order). */
export function fibPrices(p1: number, p2: number): { ratio: number; price: number }[] {
  const lo = Math.min(p1, p2);
  const hi = Math.max(p1, p2);
  const span = hi - lo;
  return VECTOR_FIB_RATIOS.map((ratio) => ({ ratio, price: lo + span * ratio }));
}

export type ChartPoint = { t: number; p: number };

/** Extend a segment through the right chart edge (ray tool). */
export function rayEndPoint(
  p1: ChartPoint,
  p2: ChartPoint,
  rightTime: number
): ChartPoint {
  const dt = p2.t - p1.t;
  if (Math.abs(dt) < 1e-6) return { t: rightTime, p: p2.p };
  const slope = (p2.p - p1.p) / dt;
  return { t: rightTime, p: p2.p + slope * (rightTime - p2.t) };
}

/** Squared distance from point to segment in time×price space (cheap hit test). */
export function dist2ToSegment(
  t: number,
  p: number,
  t1: number,
  p1: number,
  t2: number,
  p2: number
): number {
  const dx = t2 - t1;
  const dy = p2 - p1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    const d0 = t - t1;
    const d1 = p - p1;
    return d0 * d0 + d1 * d1;
  }
  let u = ((t - t1) * dx + (p - p1) * dy) / len2;
  u = Math.max(0, Math.min(1, u));
  const px = t1 + u * dx;
  const py = p1 + u * dy;
  const dtx = t - px;
  const dpy = p - py;
  return dtx * dtx + dpy * dpy;
}

/** Pick the nearest drawing to a chart click (select / delete). */
export function hitTestDrawing(
  drawings: readonly VectorDrawing[],
  t: number,
  p: number,
  tolTimeSec: number,
  tolPrice: number
): string | null {
  let bestId: string | null = null;
  let bestScore = Infinity;
  const tol2 = tolTimeSec * tolTimeSec + tolPrice * tolPrice;

  for (const d of drawings) {
    let score = Infinity;
    switch (d.kind) {
      case "hline":
        score = ((p - d.price) / tolPrice) ** 2;
        break;
      case "trend":
        score = dist2ToSegment(t, p, d.t1, d.p1, d.t2, d.p2) / tol2;
        break;
      case "ray":
        score = dist2ToSegment(t, p, d.t1, d.p1, d.t2, d.p2) / tol2;
        break;
      case "rect": {
        const tLo = Math.min(d.t1, d.t2);
        const tHi = Math.max(d.t1, d.t2);
        const pLo = Math.min(d.p1, d.p2);
        const pHi = Math.max(d.p1, d.p2);
        const inside = t >= tLo && t <= tHi && p >= pLo && p <= pHi;
        score = inside ? 0 : dist2ToSegment(t, p, d.t1, d.p1, d.t2, d.p2) / tol2;
        break;
      }
      case "text":
        score = ((t - d.t) / tolTimeSec) ** 2 + ((p - d.price) / tolPrice) ** 2;
        break;
      case "fib":
        for (const { price } of fibPrices(d.p1, d.p2)) {
          score = Math.min(score, ((p - price) / tolPrice) ** 2);
        }
        break;
      case "vline":
        score = ((t - d.t) / tolTimeSec) ** 2;
        break;
    }
    if (score < bestScore && score <= 4) {
      bestScore = score;
      bestId = d.id;
    }
  }
  return bestId;
}

export function drawingNeedsSecondClick(tool: VectorDrawTool): boolean {
  return tool === "trend" || tool === "ray" || tool === "rect" || tool === "fib";
}

export function createDrawingFromClick(
  tool: VectorDrawTool,
  color: VectorDrawColorId,
  point: ChartPoint,
  anchor: ChartPoint | null,
  text?: string
): VectorDrawing | null {
  const base = { color, createdAt: Date.now(), id: newDrawingId() };
  switch (tool) {
    case "hline":
      return { ...base, kind: "hline", price: point.p };
    case "vline":
      return { ...base, kind: "vline", t: point.t };
    case "text":
      return text
        ? { ...base, kind: "text", t: point.t, price: point.p, text: text.slice(0, 120) }
        : null;
    case "trend":
    case "ray":
    case "rect":
    case "fib":
      if (!anchor) return null;
      return { ...base, kind: tool, t1: anchor.t, p1: anchor.p, t2: point.t, p2: point.p };
    default:
      return null;
  }
}
