/**
 * Singleton UW WebSocket manager — multiplex socket per official UW examples.
 * @see https://github.com/unusual-whales/api-examples
 */
import { persistAndPublishFlowAlert } from "@/lib/flow-persist";
import {
  normalizeDarkPoolWsPayload,
  parseUwFlowAlert,
  type DarkPoolSnapshot,
} from "@/lib/providers/unusual-whales";

type UwChannel = "flow_alerts" | "market_tide" | "off_lit_trades";

type Handler = (data: unknown) => void;

type ChannelState = "idle" | "connecting" | "open" | "auth_failed";

const CHANNEL_JOIN_NAME: Record<UwChannel, string> = {
  flow_alerts: "flow_alerts",
  market_tide: "market_tide",
  off_lit_trades: "off_lit_trades",
};

const AUTH_FAILED_BACKOFF_MS = 5 * 60_000;

const UW_API_KEY = (process.env.UW_API_KEY ?? "").trim();
const UW_CLIENT_ID = process.env.UW_CLIENT_API_ID ?? "100001";

function normalizeSocketRoot(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  if (trimmed.endsWith("/api/socket")) {
    return "wss://api.unusualwhales.com/socket";
  }
  return trimmed;
}

function buildSocketUrl(): string {
  const root = normalizeSocketRoot(
    process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/socket"
  );
  return `${root}?token=${encodeURIComponent(UW_API_KEY)}`;
}

function channelFromWireName(name: string): UwChannel | null {
  const n = name.replace(/-/g, "_");
  if (n === "flow_alerts") return "flow_alerts";
  if (n === "market_tide") return "market_tide";
  if (n === "off_lit_trades") return "off_lit_trades";
  return null;
}

class UwSocketManager {
  private ws: WebSocket | null = null;
  private handlers = new Map<UwChannel, Set<Handler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private joined = new Set<UwChannel>();
  private authenticated = new Map<UwChannel, boolean>();
  private channelState = new Map<UwChannel, ChannelState>();
  private authFailedUntil = 0;
  private lastCloseReason: string | null = null;
  private authFailedLogged = false;
  private connectStarted = false;

  private channelsWithHandlers(): UwChannel[] {
    return (["flow_alerts", "market_tide", "off_lit_trades"] as UwChannel[]).filter(
      (ch) => (this.handlers.get(ch)?.size ?? 0) > 0
    );
  }

  private markAuthFailed(reason: string) {
    this.authFailedUntil = Date.now() + AUTH_FAILED_BACKOFF_MS;
    this.lastCloseReason = reason;
    for (const ch of ["flow_alerts", "market_tide", "off_lit_trades"] as UwChannel[]) {
      this.authenticated.set(ch, false);
      this.channelState.set(ch, "auth_failed");
    }
    this.joined.clear();
    this.teardownSocket();
    if (!this.authFailedLogged) {
      this.authFailedLogged = true;
      console.error(`[uw-socket] auth failed (${reason}) — check UW_API_KEY`);
    }
    this.scheduleReconnect();
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private teardownSocket() {
    const ws = this.ws;
    this.ws = null;
    this.connectStarted = false;
    if (ws && ws.readyState <= 1) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect() {
    if (this.channelsWithHandlers().length === 0) return;
    this.clearReconnect();
    const delay =
      Date.now() < this.authFailedUntil
        ? Math.max(0, this.authFailedUntil - Date.now())
        : Math.min(this.reconnectDelay, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.authFailedLogged = false;
      this.connect();
    }, delay || 1000);
  }

  private sendJoin(channel: UwChannel) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        channel: CHANNEL_JOIN_NAME[channel],
        msg_type: "join",
      })
    );
  }

  private joinActiveChannels() {
    for (const channel of this.channelsWithHandlers()) {
      if (!this.joined.has(channel)) {
        this.sendJoin(channel);
      }
    }
  }

  private dispatch(channel: UwChannel, payload: unknown) {
    if (
      payload &&
      typeof payload === "object" &&
      "status" in (payload as Record<string, unknown>)
    ) {
      const status = String((payload as Record<string, unknown>).status ?? "");
      if (status === "ok") {
        this.joined.add(channel);
        this.authenticated.set(channel, true);
        this.channelState.set(channel, "open");
        this.lastCloseReason = null;
        return;
      }
    }

    this.authenticated.set(channel, true);
    this.channelState.set(channel, "open");
    this.lastCloseReason = null;

    this.handlers.get(channel)?.forEach((h) => {
      try {
        h(payload);
      } catch {
        /* ignore handler errors */
      }
    });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (Array.isArray(parsed) && parsed.length >= 2) {
      const wireChannel = String(parsed[0] ?? "");
      const channel = channelFromWireName(wireChannel);
      if (channel) {
        this.dispatch(channel, parsed[1]);
      }
      return;
    }

    if (parsed && typeof parsed === "object") {
      const row = parsed as Record<string, unknown>;
      if (row.error) {
        const err = String(row.error).toLowerCase();
        if (err.includes("unauthorized") || err.includes("forbidden") || err.includes("invalid token")) {
          this.markAuthFailed(String(row.error));
        }
      }
    }
  }

  subscribe(channel: UwChannel, handler: Handler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    this.connect();
    if (this.ws?.readyState === 1 && !this.joined.has(channel)) {
      this.sendJoin(channel);
    }
    return () => {
      this.handlers.get(channel)?.delete(handler);
    };
  }

  private connect() {
    if (!UW_API_KEY) {
      this.markAuthFailed("UW_API_KEY not set");
      return;
    }

    if (this.channelsWithHandlers().length === 0) return;

    if (Date.now() < this.authFailedUntil) {
      for (const ch of this.channelsWithHandlers()) {
        this.channelState.set(ch, "auth_failed");
      }
      this.scheduleReconnect();
      return;
    }

    if (this.ws && this.ws.readyState <= 1) return;
    if (this.connectStarted) return;

    this.clearReconnect();
    this.connectStarted = true;
    for (const ch of this.channelsWithHandlers()) {
      this.channelState.set(ch, "connecting");
    }

    try {
      const ws = new WebSocket(buildSocketUrl(), {
        headers: {
          Accept: "application/json",
          "UW-CLIENT-API-ID": UW_CLIENT_ID,
        },
      } as unknown as string[]);
      this.ws = ws;

      ws.onopen = () => {
        this.connectStarted = false;
        this.reconnectDelay = 1000;
        console.log("[uw-socket] multiplex connected — joining channels");
        this.joinActiveChannels();
      };

      ws.onmessage = (event) => {
        this.handleMessage(String(event.data));
      };

      ws.onerror = () => {
        /* onclose carries actionable detail */
      };

      ws.onclose = (event) => {
        this.connectStarted = false;
        const reason = event.reason?.trim() || `code=${event.code}`;
        this.lastCloseReason = reason;
        this.ws = null;
        this.joined.clear();
        for (const ch of ["flow_alerts", "market_tide", "off_lit_trades"] as UwChannel[]) {
          this.authenticated.set(ch, false);
          if (this.channelState.get(ch) !== "auth_failed") {
            this.channelState.set(ch, "idle");
          }
        }

        const authFailure =
          event.code === 1008 ||
          event.code === 4401 ||
          event.code === 4403 ||
          /401|403|unauthorized|forbidden|authentication/i.test(reason);

        if (authFailure) {
          this.markAuthFailed(reason);
          return;
        }

        console.warn(`[uw-socket] multiplex closed (${reason}) — reconnecting`);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
        this.scheduleReconnect();
      };
    } catch (err) {
      this.connectStarted = false;
      const msg = err instanceof Error ? err.message : "open failed";
      console.warn(`[uw-socket] failed to open: ${msg}`);
      this.scheduleReconnect();
    }
  }

  heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const pingable = ws as WebSocket & { ping?: () => void };
    if (typeof pingable.ping === "function") {
      try {
        pingable.ping();
      } catch {
        /* ignore */
      }
    }
  }

  getStatus(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const channel of ["flow_alerts", "market_tide", "off_lit_trades"] as UwChannel[]) {
      if (this.channelState.get(channel) === "auth_failed") {
        result[channel] = "AUTH_FAILED";
      } else if (this.authenticated.get(channel)) {
        result[channel] = "OPEN";
      } else if (this.ws?.readyState === 1) {
        result[channel] = "CONNECTING";
      } else {
        result[channel] = "CLOSED";
      }
    }
    return result;
  }

  getChannelHealth(): Record<
    UwChannel,
    {
      ws_state: string;
      authenticated: boolean;
      handlers: number;
      auth_failed: boolean;
      auth_retry_at: number | null;
      last_close_reason: string | null;
      last_error: string | null;
    }
  > {
    const channels: UwChannel[] = ["flow_alerts", "market_tide", "off_lit_trades"];
    const multiplexOpen = this.ws?.readyState === 1;
    const out = {} as Record<
      UwChannel,
      {
        ws_state: string;
        authenticated: boolean;
        handlers: number;
        auth_failed: boolean;
        auth_retry_at: number | null;
        last_close_reason: string | null;
        last_error: string | null;
      }
    >;

    for (const channel of channels) {
      const authFailed = this.channelState.get(channel) === "auth_failed";
      const authed = Boolean(this.authenticated.get(channel));
      const retryAt = this.authFailedUntil > Date.now() ? this.authFailedUntil : null;
      out[channel] = {
        ws_state: authFailed
          ? "AUTH_FAILED"
          : authed
            ? "OPEN"
            : multiplexOpen
              ? "CONNECTING"
              : "CLOSED",
        authenticated: authed,
        handlers: this.handlers.get(channel)?.size ?? 0,
        auth_failed: authFailed,
        auth_retry_at: retryAt,
        last_close_reason: this.lastCloseReason,
        last_error: authFailed ? this.lastCloseReason : null,
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

  uwSocket.subscribe("flow_alerts", (payload) => {
    try {
      const block = Array.isArray(payload) ? payload : [payload];
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

  uwSocket.subscribe("market_tide", (payload) => {
    try {
      const row = Array.isArray(payload) ? payload[payload.length - 1] : payload;
      if (!row || typeof row !== "object") return;
      if ("status" in (row as Record<string, unknown>)) return;
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

  uwSocket.subscribe("off_lit_trades", (payload) => {
    if (payload && typeof payload === "object" && "status" in (payload as Record<string, unknown>)) {
      return;
    }
    const normalized = normalizeDarkPoolWsPayload(payload);
    if (normalized) {
      lastDarkPoolMessageAt = Date.now();
      darkPoolStore.data = normalized;
      darkPoolStore.updatedAt = Date.now();
    }
  });

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => uwSocket.heartbeat(), 30_000);
  }

  console.log("[uw-socket] initialized — multiplex flow_alerts, market_tide, off_lit_trades");
}

export function getUwSocketHealth() {
  const now = Date.now();
  const channels = uwSocket.getChannelHealth();
  const authFailedChannels = (Object.entries(channels) as [UwChannel, (typeof channels)[UwChannel]][])
    .filter(([, row]) => row.auth_failed)
    .map(([ch]) => ch);
  return {
    configured: Boolean(UW_API_KEY),
    initialized: uwSocketInitialized,
    auth_failed: authFailedChannels.length > 0,
    auth_failed_channels: authFailedChannels,
    channels,
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
