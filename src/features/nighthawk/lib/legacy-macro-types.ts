export type LegacyMacroContext = {
  spxPremarket: number | null;
  priorClose: number | null;
  overnightGapPts: number | null;
  regime: string | null;
  gexBias: string | null;
  callWall: number | null;
  putWall: number | null;
  summary: { confirmed: number; degraded: number; invalidated: number; unverified: number } | null;
};
