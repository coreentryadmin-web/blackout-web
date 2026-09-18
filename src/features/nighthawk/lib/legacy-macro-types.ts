export type LegacyMacroContext = {
  spxPremarket: number | null;
  priorClose: number | null;
  overnightGapPts: number | null;
  regime: string | null;
  /** deriveComposite()'s authored regime strategy sentence — a human-readable companion to
   *  `regime`'s raw enum, sourced from GET /api/platform/intel's regime.playbook via the
   *  nighthawk-morning-confirm cron. Null whenever regime itself is unavailable/stale, or when
   *  reconstructed from the DB fallback (that path can't recover it — see
   *  morning-status-from-db.ts). */
  playbook: string | null;
  gexBias: string | null;
  callWall: number | null;
  putWall: number | null;
  summary: { confirmed: number; degraded: number; invalidated: number; unverified: number } | null;
};
