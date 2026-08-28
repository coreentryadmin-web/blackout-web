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

export type VectorPickClosuresResponse = {
  available: boolean;
  degraded?: boolean;
  note?: string;
  closed?: VectorClosurePlay[];
};
