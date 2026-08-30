export type VectorClosurePlay = {
  id: number;
  ticker: string;
  session_date: string;
  contract: {
    occ: string;
    side: string;
    strike: number;
    expiry: string;
    label: string | null;
  };
  rank: number | null;
  role: string | null;
  entry_mid: number | null;
  close_mid: number | null;
  premium_pct_from_entry: number | null;
  close_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  closed_at: string;
};

export type VectorLeaderPlay = {
  id: number;
  ticker: string;
  session_date: string;
  contract: VectorClosurePlay["contract"];
  rank: number | null;
  role: string | null;
  entry_mid: number | null;
  live_mid: number | null;
  premium_pct_from_entry: number | null;
  peak_premium_pct: number | null;
  action_status: string;
  action_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  updated_at: string;
  is_winner: boolean;
  tier?: "elite" | "standard";
  /** Archived closure that hit the winner floor — still shown on Winners tab. */
  closed_winner?: boolean;
};

export type VectorPickBoardResponse = {
  available: boolean;
  degraded?: boolean;
  note?: string;
  session_date?: string;
  coverage?: {
    leaders: number;
    winners: number;
    closed: number;
    note?: string;
  };
  leaders?: VectorLeaderPlay[];
  winners?: VectorLeaderPlay[];
  closed?: VectorClosurePlay[];
};

/** @deprecated use VectorPickBoardResponse */
export type VectorPickClosuresResponse = VectorPickBoardResponse;
