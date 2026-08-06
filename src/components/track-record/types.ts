/** Shape returned by GET /api/track-record — do not change without API coordination. */
export interface SpxStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
}

export interface NhStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgWinnerPct: number | null;
  avgLoserPct: number | null;
  profitFactor: number | null;
  /** total - wins - losses: 'open'/'ambiguous' outcomes. Undefined on older payloads. */
  unresolved?: number;
  /** wins + losses — the denominator winRatePct was computed over, and the ripeness gate
   *  the card must use. `total` includes `unresolved` and is NOT the sample behind the rate.
   *  Undefined on older payloads. */
  decided?: number;
}

export interface TrackRecordPayload {
  spxSlayer: SpxStats;
  nightHawk: NhStats;
  methodology: string;
  liveData?: boolean;
  available?: boolean;
}

export type TrackRecordLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; data: TrackRecordPayload; fetchedAt: Date };
