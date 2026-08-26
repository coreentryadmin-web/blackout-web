/** Catalyst row surfaced in Vector pick evidence (earnings or Benzinga event). */
export type VectorPickCatalyst = {
  kind: "earnings" | "catalyst";
  label: string;
  detail?: string;
  daysUntil?: number;
  when?: "premarket" | "afterhours" | null;
};

/** Server-enriched desk context merged into ranking + evidence. */
export type VectorPickEnrichmentData = {
  gexKingStrike?: number | null;
  maxPain?: number | null;
  strikeTotals?: Record<string, number>;
  catalysts?: VectorPickCatalyst[];
  newsHeadline?: string | null;
};
