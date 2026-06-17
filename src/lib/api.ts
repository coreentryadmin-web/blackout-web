const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const API_KEY = process.env.DASHBOARD_API_SECRET ?? "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}key=${API_KEY}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    next: { revalidate: 0 }, // always fresh
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── SPX ───────────────────────────────────────────────────────────────────────

export interface SpxState {
  available: boolean;
  as_of: string;
  price: number;
  vwap: number;
  lod: number;
  hod: number;
  vix: number | null;
  vix_change_pct: number;
  spx_change_pct: number;
  above_vwap: boolean;
  uw_iv_rank: number | null;
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  adv: number | null;
  dec: number | null;
  trin: number | null;
  tick: number | null;
  sector_bias: string | null;
  sector_leaders: Array<{ sector: string; change_pct: number }>;
  sector_laggards: Array<{ sector: string; change_pct: number }>;
  tide_bias: string | null;
  tide_call: number | null;
  tide_put: number | null;
  nope: { nope: number; call_delta: number; put_delta: number } | null;
  vol_regime: { realized_vol: number; skew: number } | null;
  chart_levels: {
    regime: string | null;
    vah: number | null;
    val: number | null;
    poc: number | null;
    fib_382: number | null;
    fib_50: number | null;
    fib_618: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    onh: number | null;
    onl: number | null;
    pdh: number | null;
    pdl: number | null;
  };
}

export const fetchSpxState = () => apiFetch<SpxState>("/api/spx/state");

// ── Flows ─────────────────────────────────────────────────────────────────────

export interface FlowAlert {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
}

export const fetchFlows = (params?: { limit?: number; ticker?: string; min_premium?: number }) => {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.ticker) qs.set("ticker", params.ticker);
  if (params?.min_premium) qs.set("min_premium", String(params.min_premium));
  return apiFetch<{ flows: FlowAlert[]; count: number }>(`/api/flows/recent?${qs}`);
};

// ── Night Hawk ────────────────────────────────────────────────────────────────

export interface NightHawkPlay {
  ticker: string;
  direction: string;
  score: number;
  streak_days: number;
  iv_rank: number;
  entry_premium: number;
  dte_range: string;
  posted_at: string;
  summary: string;
}

export const fetchNightHawkPlays = () =>
  apiFetch<{ plays: NightHawkPlay[] }>("/api/nighthawk/plays");

// ── Heatmap ───────────────────────────────────────────────────────────────────

export interface HeatmapData {
  sectors: Array<{ name: string; change_pct: number; volume?: number }>;
  movers: Array<{ ticker: string; change_pct: number; price: number; volume?: number }>;
  as_of: string;
}

export const fetchHeatmap = () => apiFetch<HeatmapData>("/api/heatmap");

// ── Largo ─────────────────────────────────────────────────────────────────────

export const queryLargo = (question: string, sessionId: string) =>
  apiFetch<{ answer: string; session_id: string }>("/api/largo/query", {
    method: "POST",
    body: JSON.stringify({ question, session_id: sessionId }),
  });

// ── WebSocket ─────────────────────────────────────────────────────────────────

export function createFlowSocket(onMessage: (alert: FlowAlert) => void): WebSocket {
  const wsBase = API_BASE.replace(/^https/, "wss").replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws/flows?key=${API_KEY}`);
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type !== "heartbeat") onMessage(data as FlowAlert);
    } catch {}
  };
  return ws;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtPremium(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtPrice(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function pctClass(n: number | null): string {
  if (n == null) return "num-neutral";
  return n >= 0 ? "num-bull" : "num-bear";
}
