/**
 * Dynamic column widths for Vector/Legacy X Ads tables.
 * Percentages in CSS break when columns are hidden or Legacy adds extra columns (e.g. stock).
 */

export type BoardColumnLayoutKey =
  | "compare"
  | "pick"
  | "status"
  | "premium"
  | "stock"
  | "entryMark"
  | "peak"
  | "path"
  | "updated";

const FR_WEIGHTS: Record<Exclude<BoardColumnLayoutKey, "compare">, number> = {
  pick: 22,
  status: 12,
  premium: 11,
  stock: 10,
  entryMark: 13,
  peak: 8,
  path: 17,
  updated: 14,
};

const COMPARE_PX = 36;

function weightFor(key: string): number {
  if (key === "compare") return 0;
  return FR_WEIGHTS[key as Exclude<BoardColumnLayoutKey, "compare">] ?? 10;
}

/** Pixel-perfect col widths for the visible column set (sums to 100% minus compare fixed cols). */
export function computeBoardColumnWidths(keys: string[]): string[] {
  const compareCount = keys.filter((k) => k === "compare").length;
  const fixedPx = compareCount * COMPARE_PX;
  const frKeys = keys.filter((k) => k !== "compare");
  const totalFr = frKeys.reduce((sum, k) => sum + weightFor(k), 0) || 1;

  return keys.map((key) => {
    if (key === "compare") return `${COMPARE_PX}px`;
    const share = weightFor(key) / totalFr;
    if (compareCount > 0) {
      const pct = share * 100;
      return `calc((100% - ${fixedPx}px) * ${pct / 100})`;
    }
    return `${(share * 100).toFixed(4)}%`;
  });
}
