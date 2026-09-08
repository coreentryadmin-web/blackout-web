/** Pure conviction letter mapping — kept separate from scorer.ts so client bundles avoid db/format imports. */

export function convictionFromScore(score: number): string {
  if (score >= 70) return "A+";
  if (score >= 55) return "A";
  if (score >= 40) return "B";
  return "C";
}

/** Ordinal rank for conviction letters (higher = stronger). Unknown letters read as B. */
export function convictionRank(conviction: string): number {
  const c = conviction.trim().toUpperCase();
  if (c === "A+") return 4;
  if (c === "A") return 3;
  if (c === "B") return 2;
  if (c === "C") return 1;
  return 2;
}
