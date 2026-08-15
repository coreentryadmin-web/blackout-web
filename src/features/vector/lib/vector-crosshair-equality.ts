import type { VectorCrosshairState } from "@/features/vector/components/VectorCrosshairLegend";

function wallsEqual(
  a: VectorCrosshairState["callWalls"],
  b: VectorCrosshairState["callWalls"]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.strike !== b[i]!.strike || a[i]!.pct !== b[i]!.pct) return false;
  }
  return true;
}

function darkPoolEqual(
  a: VectorCrosshairState["darkPoolLevels"],
  b: VectorCrosshairState["darkPoolLevels"]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.strike !== b[i]!.strike || a[i]!.pct !== b[i]!.pct) return false;
  }
  return true;
}

function gexCellEqual(
  a: VectorCrosshairState["gexCell"],
  b: VectorCrosshairState["gexCell"]
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.strike === b.strike && a.value === b.value;
}

/** Skip React state updates when hover legend payload is unchanged. */
export function vectorCrosshairStatesEqual(
  prev: VectorCrosshairState | null,
  next: VectorCrosshairState | null
): boolean {
  if (prev === next) return true;
  if (prev == null || next == null) return prev === next;
  return (
    prev.time === next.time &&
    prev.close === next.close &&
    prev.lens === next.lens &&
    prev.flip === next.flip &&
    wallsEqual(prev.callWalls, next.callWalls) &&
    wallsEqual(prev.putWalls, next.putWalls) &&
    darkPoolEqual(prev.darkPoolLevels, next.darkPoolLevels) &&
    gexCellEqual(prev.gexCell, next.gexCell)
  );
}
