/** Entry-centered excursion layout for the PnL panel — pure math, no React. */

export type ExcursionGraphicMarker = {
  key: "worst" | "entry" | "best" | "current";
  label: string;
  pct: number;
  /** 0..100 position on the horizontal bar (entry pinned at 50). */
  posPct: number;
};

export type EntryCenteredExcursionLayout = {
  worst: number;
  best: number;
  current: number | null;
  markers: ExcursionGraphicMarker[];
};

export type JourneyNode = {
  key: "entry" | "peak" | "close";
  label: string;
  pct: number;
  /** Normalized 0..1 x/y for the journey spine SVG. */
  x: number;
  y: number;
};

export type TradeJourneyLayout = {
  nodes: JourneyNode[];
  /** SVG path d connecting entry → peak → close in chronological story order. */
  pathD: string;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Map a P&L % onto the entry-centered bar (worst=left, entry=50, best=right). */
export function pctToEntryCenteredPos(worst: number, best: number, pct: number): number {
  if (pct < 0) {
    if (worst >= 0) return 50;
    return clamp(50 * ((pct - worst) / (0 - worst)), 2, 48);
  }
  if (pct > 0) {
    if (best <= 0) return 50;
    return clamp(50 + 50 * (pct / best), 52, 98);
  }
  return 50;
}

/** Build marker positions for the MAE/MFE bar. Returns null when extremes are missing. */
export function entryCenteredExcursionLayout(
  worst: number | null | undefined,
  best: number | null | undefined,
  current: number | null | undefined,
  opts?: { closed?: boolean },
): EntryCenteredExcursionLayout | null {
  if (worst == null || !Number.isFinite(worst) || best == null || !Number.isFinite(best)) return null;
  const lo = Math.min(worst, best);
  const hi = Math.max(worst, best);
  const cur = current != null && Number.isFinite(current) ? current : null;
  const closeLabel = opts?.closed ? "Close" : "Current";

  const markers: ExcursionGraphicMarker[] = [
    { key: "worst", label: "Worst", pct: lo, posPct: pctToEntryCenteredPos(lo, hi, lo) },
    { key: "entry", label: "Entry", pct: 0, posPct: 50 },
    { key: "best", label: "Best", pct: hi, posPct: pctToEntryCenteredPos(lo, hi, hi) },
  ];

  if (cur != null) {
    markers.push({
      key: "current",
      label: closeLabel,
      pct: cur,
      posPct: pctToEntryCenteredPos(lo, hi, cur),
    });
  }

  return { worst: lo, best: hi, current: cur, markers };
}

/** Journey spine: entry → peak → current/close with y = inverted P&L (higher = visually up). */
export function tradeJourneyLayout(
  worst: number | null | undefined,
  best: number | null | undefined,
  current: number | null | undefined,
  opts?: { closed?: boolean },
): TradeJourneyLayout | null {
  if (best == null || !Number.isFinite(best)) return null;
  const lo = worst != null && Number.isFinite(worst) ? Math.min(worst, best) : 0;
  const hi = Math.max(best, current ?? 0, 0);
  const floor = Math.min(lo, current ?? 0, 0);
  const span = hi - floor || 1;
  const toY = (pct: number): number => clamp(0.88 - ((pct - floor) / span) * 0.76, 0.08, 0.92);

  const closeLabel = opts?.closed ? "Close" : "Now";
  const cur = current != null && Number.isFinite(current) ? current : null;

  const nodes: JourneyNode[] = [
    { key: "entry", label: "Entry", pct: 0, x: 0.1, y: toY(0) },
    { key: "peak", label: "Peak", pct: hi, x: 0.78, y: toY(hi) },
  ];
  if (cur != null) {
    nodes.push({ key: "close", label: closeLabel, pct: cur, x: 0.48, y: toY(cur) });
  }

  const ordered = [nodes[0], nodes[1], nodes[2] ?? nodes[1]];
  const pathPts = cur != null ? [nodes[0], nodes[1], nodes[2]!] : [nodes[0], nodes[1]];
  const pathD = pathPts
    .map((n, i) => `${i === 0 ? "M" : "L"}${(n.x * 200).toFixed(1)},${(n.y * 72).toFixed(1)}`)
    .join(" ");

  return { nodes, pathD };
}

export function formatExcursionPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}
