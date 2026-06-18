/**
 * Singleton UW WebSocket manager — flow alerts, market tide, dark pool.
 */
import { persistAndPublishFlowAlert } from "@/lib/flow-persist";
import {
  normalizeDarkPoolWsPayload,
  parseUwFlowAlert,
  type DarkPoolSnapshot,
} from "@/lib/providers/unusual-whales";

type UwChannel = "flow_alerts" | "market_tide" | "off_lit_trades";

type Handler = (data: unknown) => void;

const UW_WS_BASE = process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/api/socket";
const UW_API_KEY = process.env.UW_API_KEY ?? "";

class UwSocketManager {
  private sockets = new Map<UwChannel, WebSocket>();
  private handlers = new Map<UwChannel, Set<Handler>>();
  private reconnectTimers = new Map<UwChannel, ReturnType<typeof setTimeout>>();
  private reconnectDelays = new Map<UwChannel, number>();
  private authenticated = new Map<UwChannel, boolean>();

  private isAuthError(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const r = data as Record<string, unknown>;
    const err = String(r.error ?? r.message ?? "").toLowerCase();
    return (
      r.status === "error" ||
      r.auth === false ||
      err.includes("unauthorized") ||
      err.includes("forbidden") ||
      err.includes("invalid") && err.includes("key")
    );
  }

  private looksLikePayload(data: unknown): boolean {
    if (Array.isArray(data)) return data.length > 0;
    if (!data || typeof data !== "object") return false;
    const r = data as Record<string, unknown>;
    return Array.isArray(r.data) || r.ticker != null || r.premium != null;
  }

  private dispatch(channel: UwChannel, data: unknown) {
    if (this.isAuthError(data)) {
      this.authenticated.set(channel, false);
      return;
    }
    if (!this.authenticated.get(channel)) {
      if (this.looksLikePayload(data)) {
        this.authenticated.set(channel, true);
      } else {
        return;
      }
    }
    this.handlers.get(channel)?.forEach((h) => {
      try {
        h(data);
      } catch {
        /* ignore handler errors */
      }
    });
  }

  subscribe(channel: UwChannel, handler: Handler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    const ws = this.sockets.get(channel);
    if (!ws || ws.readyState > 1) {
      this.connect(channel);
    }
    return () => this.handlers.get(channel)?.delete(handler);
  }

  private connect(channel: UwChannel) {
    if (!UW_API_KEY) {
      console.warn(`[uw-socket] UW_API_KEY not set — cannot connect ${channel}`);
      return;
    }

    try {
      const ws = new WebSocket(`${UW_WS_BASE}/${channel}`);
      this.sockets.set(channel, ws);

      ws.onopen = () => {
        console.log(`[uw-socket] connected: ${channel}`);
        this.reconnectDelays.set(channel, 1000);
        this.authenticated.set(channel, false);
        ws.send(JSON.stringify({ action: "auth", key: UW_API_KEY }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          this.dispatch(channel, data);
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = (err) => {
        console.error(`[uw-socket] error on ${channel}:`, err);
      };

      ws.onclose = (event) => {
        console.warn(`[uw-socket] closed ${channel} (code=${event.code}) — reconnecting...`);
        this.scheduleReconnect(channel);
      };
    } catch (err) {
      console.error(`[uw-socket] failed to open ${channel}:`, err);
      this.scheduleReconnect(channel);
    }
  }

  private scheduleReconnect(channel: UwChannel) {
    const existing = this.reconnectTimers.get(channel);
    if (existing) clearTimeout(existing);

    const delay = Math.min(this.reconnectDelays.get(channel) ?? 1000, 30_000);
    this.reconnectDelays.set(channel, delay * 2);

    const timer = setTimeout(() => {
      if ((this.handlers.get(channel)?.size ?? 0) > 0) {
        this.connect(channel);
      }
    }, delay);

    this.reconnectTimers.set(channel, timer);
  }

  heartbeat() {
    for (const ws of Array.from(this.sockets.values())) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ action: "ping" }));
      }
    }
  }

  getStatus(): Record<string, string> {
    const states = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    const result: Record<string, string> = {};
    for (const [channel, ws] of Array.from(this.sockets.entries())) {
      result[channel] = states[ws.readyState] ?? "UNKNOWN";
    }
    return result;
  }

  getChannelHealth(): Record<
    UwChannel,
    { ws_state: string; authenticated: boolean; handlers: number }
  > {
    const states = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    const channels: UwChannel[] = ["flow_alerts", "market_tide", "off_lit_trades"];
    const out = {} as Record<UwChannel, { ws_state: string; authenticated: boolean; handlers: number }>;
    for (const channel of channels) {
      const ws = this.sockets.get(channel);
      out[channel] = {
        ws_state: ws ? states[ws.readyState] ?? "UNKNOWN" : "NOT_CREATED",
        authenticated: Boolean(this.authenticated.get(channel)),
        handlers: this.handlers.get(channel)?.size ?? 0,
      };
    }
    return out;
  }
}

export const uwSocket = new UwSocketManager();

export const tideStore: {
  call_premium: number;
  put_premium: number;
  net: number;
  bias: string;
  updatedAt: number;
} = { call_premium: 0, put_premium: 0, net: 0, bias: "neutral", updatedAt: 0 };

export const darkPoolStore: {
  data: DarkPoolSnapshot | null;
  updatedAt: number;
} = { data: null, updatedAt: 0 };

let uwSocketInitialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastFlowMessageAt: number | null = null;
let lastTideMessageAt: number | null = null;
let lastDarkPoolMessageAt: number | null = null;

export function initUwSocket() {
  if (uwSocketInitialized) return;
  if (!UW_API_KEY) {
    console.warn("[uw-socket] UW_API_KEY not set — WebSocket disabled, falling back to REST polling");
    return;
  }
  uwSocketInitialized = true;

  uwSocket.subscribe("flow_alerts", (data) => {
    try {
      const block = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
      if (!Array.isArray(block)) return;
      lastFlowMessageAt = Date.now();
      for (const raw of block) {
        if (!raw || typeof raw !== "object") continue;
        const flow = parseUwFlowAlert(raw as Record<string, unknown>);
        void persistAndPublishFlowAlert(raw as Record<string, unknown>, flow);
      }
    } catch {
      /* ignore */
    }
  });

  uwSocket.subscribe("market_tide", (data) => {
    try {
      const row = Array.isArray(data) ? data[data.length - 1] : (data as Record<string, unknown>)?.data;
      if (!row || typeof row !== "object") return;
      lastTideMessageAt = Date.now();
      const r = row as Record<string, unknown>;
      const call = Number(r.net_call_premium ?? r.call_premium ?? 0);
      const put = Number(r.net_put_premium ?? r.put_premium ?? 0);
      Object.assign(tideStore, {
        call_premium: call,
        put_premium: put,
        net: call - put,
        bias: call > put ? "bullish" : put > call ? "bearish" : "neutral",
        updatedAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  });

  uwSocket.subscribe("off_lit_trades", (data) => {
    const normalized = normalizeDarkPoolWsPayload(data);
    if (normalized) {
      lastDarkPoolMessageAt = Date.now();
      darkPoolStore.data = normalized;
      darkPoolStore.updatedAt = Date.now();
    }
  });

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => uwSocket.heartbeat(), 30_000);
  }

  console.log("[uw-socket] initialized — flow_alerts, market_tide, off_lit_trades");
}

export function getUwSocketHealth() {
  const now = Date.now();
  return {
    configured: Boolean(UW_API_KEY),
    initialized: uwSocketInitialized,
    channels: uwSocket.getChannelHealth(),
    last_message_at: {
      flow_alerts: lastFlowMessageAt,
      market_tide: lastTideMessageAt,
      off_lit_trades: lastDarkPoolMessageAt,
    },
    last_message_age_ms: {
      flow_alerts: lastFlowMessageAt ? now - lastFlowMessageAt : null,
      market_tide: lastTideMessageAt ? now - lastTideMessageAt : null,
      off_lit_trades: lastDarkPoolMessageAt ? now - lastDarkPoolMessageAt : null,
    },
    stores: {
      tide_updated_at: tideStore.updatedAt || null,
      dark_pool_updated_at: darkPoolStore.updatedAt || null,
    },
  };
}
