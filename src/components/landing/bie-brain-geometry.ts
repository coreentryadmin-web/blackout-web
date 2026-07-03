// Pure SVG path builders for BieBrainBanner — split out from the component so the
// generated path syntax is unit-testable without a browser/DOM.

/** Quadratic-bezier "root" curve from the BIE core down to an instrument node —
 *  control point pulled toward the node's y so the curve droops like a dendrite. */
export function spokePath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2;
  const cy = y0 + (y1 - y0) * 0.55;
  return `M${x0},${y0} Q${cx},${cy} ${x1},${y1}`;
}

/** Shallow upward arc directly between two adjacent instrument nodes (same y) —
 *  the "mesh" connections that make the diagram read as a network, not just a star. */
export function meshPath(x0: number, x1: number, y: number, bow: number): string {
  const cx = (x0 + x1) / 2;
  const cy = y - bow;
  return `M${x0},${y} Q${cx},${cy} ${x1},${y}`;
}
