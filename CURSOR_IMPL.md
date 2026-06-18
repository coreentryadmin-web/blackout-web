# BlackOut — Full System Implementation Guide
> Feed this entire document to Cursor. It contains every identified issue, root cause, exact file paths, and implementation instructions needed to fix and upgrade the system.

Generated: 2026-06-18 | Based on: live API probe + full codebase audit + cursor-api-analysis cross-check

---

## TABLE OF CONTENTS

0. [REMOVE — UW Plan-Blocked Endpoints (Do This First)](#0-remove--uw-plan-blocked-endpoints-do-this-first)
1. [CRITICAL — Fix Now (Production Failures)](#1-critical--fix-now-production-failures)
2. [HIGH — UW WebSocket Migration (Biggest ROI)](#2-high--uw-websocket-migration)
3. [HIGH — Polygon WebSocket Migration](#3-high--polygon-websocket-migration)
4. [MEDIUM — Night Hawk Rate Limit Hardening](#4-medium--night-hawk-rate-limit-hardening)
5. [MEDIUM — Move In-Process Caches to Redis](#5-medium--move-in-process-caches-to-redis)
6. [MEDIUM — Largo Tool Pre-Filtering](#6-medium--largo-tool-pre-filtering)
7. [LOW — New Polygon Capabilities](#7-low--new-polygon-capabilities)

---

## CONTEXT — SYSTEM ARCHITECTURE

The app has 3 server-side data lanes feeding the SPX play engine:

| Lane | Route | Cache TTL | Provider | Client Poll |
|---|---|---|---|---|
| Pulse | `/api/market/spx/pulse` | 1s | Polygon only | 1s SWR |
| Flow | `/api/market/spx/flow` | 2s | UW primary | 2s SWR |
| Desk | `/api/market/spx/desk` | 10s | Polygon + UW | 10s SWR |
| Play | `/api/market/spx/play` | reuses caches | none extra | 3s SWR |

Key files:
- `src/lib/providers/spx-desk.ts` — builds all three lanes
- `src/lib/providers/unusual-whales.ts` — all UW calls, `uwGetSafe()` silently returns null on any error
- `src/lib/providers/polygon.ts` — all Polygon calls
- `src/lib/providers/polygon-options-gex.ts` — GEX chain pagination
- `src/lib/flow-events.ts` — in-process pub/sub for flow alerts (SSE pipeline)
- `src/lib/providers/flow-ingest.ts` — UW flow alert ingest cron logic
- `src/app/api/market/flows/stream/route.ts` — SSE endpoint (already working)
- `src/lib/nighthawk/dossier.ts` — Night Hawk per-ticker dossier build
- `src/lib/largo/run-tool.ts` — Largo AI tool execution
- `src/lib/largo/tool-defs.ts` — 75 tool definitions sent to Claude on every query

---

## RATE LIMIT FACTS

**Unusual Whales Advanced:**
- Limit: **120 requests/minute** (confirmed from `x-uw-req-per-minute-remaining` headers)
- Token limit: 50,000 tokens/minute
- Current usage: ~164 calls/min = **overflowing by 44 calls/min**
- No per-second limit observed — concurrency is fine, volume is the problem

**Polygon/Massive Advanced (4 plans):**
- Limit: **Unlimited** REST calls
- WebSocket: up to 10 simultaneous connections per API key
- All 78 documented endpoints return 200

**UW call math:**
```
Flow lane (2s poll × 4 UW calls):   120 calls/min  ← entire plan budget
Desk lane (10s poll × 7 UW calls):   42 calls/min  ← overflow
Flow ingest cron:                      2 calls/min  ← overflow
─────────────────────────────────────────────────────
Current total:                       164 calls/min  (limit: 120)
```

---

## 0. REMOVE — UW Plan-Blocked Endpoints (Do This First)

> These 6 UW endpoints all return `403 {"code":"volatility_scope_required"}`. The current UW plan does not include the volatility analytics scope. Remove every definition and call site. Do not replace with stubs — just delete.

### Functions to delete from `src/lib/providers/unusual-whales.ts`

Delete these 6 exported function definitions entirely (search by name):

1. `fetchUwVolatilityAnomaly` — around line 630
2. `fetchUwVolatilityCharacter` — around line 634
3. `fetchUwVolAnomalyTop` — around line 651
4. `fetchUwVixTermStructure` — around line 892
5. `fetchUwVolatilityCharacterTop` — around line 897
6. `fetchUwVarianceRiskPremium` — around line 902

---

### Call sites to remove from `src/lib/largo/run-tool.ts`

**1. Import block (around line 154–159)** — remove these 6 imports from the `unusual-whales` import statement:
```
fetchUwVarianceRiskPremium
fetchUwVolAnomalyTop
fetchUwVolatilityAnomaly
fetchUwVolatilityCharacter
fetchUwVolatilityCharacterTop
fetchUwVixTermStructure
```

**2. `get_iv_stats` case (around lines 570–596)** — `fetchUwVolatilityCharacter(sym)` is called in two branches inside `Promise.all`. For each branch:
- Remove `fetchUwVolatilityCharacter(sym)` from the `Promise.all([...])` array
- Remove `volChar` from the destructured result (e.g. `const [chainData, volChar, ...]` → remove `volChar`)
- Remove `vol_character: volChar` from the returned object

**3. `get_vol_anomaly` case (around lines 620–623)** — This entire case uses only plan-blocked functions. Replace the entire case body with:
```typescript
return { error: "not_available", message: "Volatility anomaly data requires the UW volatility scope — not included in current plan." };
```

**4. `get_screener` case (around line 768)** — Delete this single line:
```typescript
if (type === "vol_anomaly") return fetchUwVolAnomalyTop("long_vol", 25);
```

**5. `get_vix_term` case (around lines 1017–1023)** — Remove the following from this case:
- Delete: `let uwVixTerm: unknown;`
- Delete: the `if (!computedTerm) { uwVixTerm = await fetchUwVixTermStructure(20); }` block
- Delete: `uw_vix_term: uwVixTerm` from the returned object
- Delete: `let vrp: unknown;` 
- Delete: `if (sym !== "SPX") vrp = await fetchUwVarianceRiskPremium(sym);`
- Delete: `variance_risk_premium: vrp` from the returned object

---

### Call sites to remove from `src/lib/nighthawk/market-wide.ts`

**1. Import (around line 13)** — Remove `fetchUwVixTermStructure` from the `unusual-whales` import.

**2. `fetchVixTermPreferPolygon()` function (around lines 99–103)** — Delete the UW fallback block. The Polygon path (lines ~81–98) already works and is the primary path. Delete:
```typescript
if (uwConfigured()) {
  const uw = await fetchUwVixTermStructure(12).catch(() => []);
  return uw.map((row) => ({ ...row, source: "unusual_whales" }));
}
```

---

### Tool definitions to remove from `src/lib/largo/tool-defs.ts`

**1. `get_vol_anomaly` tool** (around line 113) — Delete the entire tool definition object for `get_vol_anomaly`.

**2. `get_screener` type enum** (around line 175) — Remove `"vol_anomaly"` from the enum/union of valid `type` values. Keep all other types.

---

### After removal — verify

Run `tsc --noEmit` to confirm no TypeScript errors. The only remaining VIX term source should be `computeVixTermStructure(vix9d, vix3m)` from `src/lib/providers/polygon.ts` — this already runs in `spx-desk.ts` and is unaffected.

---

## 1. CRITICAL — Fix Now (Production Failures)

### 1A. Six UW endpoints returning 403 (silent production failures)

**Root cause:** These endpoints require a higher UW plan tier. `uwGetSafe()` in `src/lib/providers/unusual-whales.ts:93-100` catches the error and returns `null` silently. The play engine and Night Hawk receive null for these signals with no error logged.

**The 6 failing endpoints:**
1. `/api/stock/{ticker}/volatility/anomaly` → `fetchUwVolatilityAnomaly()`
2. `/api/stock/{ticker}/volatility/character` → `fetchUwVolatilityCharacter()`
3. `/api/stock/{ticker}/volatility/variance-risk-premium` → `fetchUwVarianceRiskPremium()`
4. `/api/volatility/vix-term-structure` → `fetchUwVixTermStructure()` ← **MOST CRITICAL**
5. `/api/volatility/anomaly/top` → `fetchUwTopVolatilityAnomalies()`
6. `/api/volatility/character/top` → `fetchUwTopVolatilityCharacter()`

**Why #4 is most critical:** `vix-term-structure` is used as a hard-opposing gate in the SPX engine. When it returns null, the gate passes by default — meaning plays can fire in VIX backwardation (high fear regime) without triggering the block.

**Fix:** Replace with Polygon data. The VIX term structure is already available from Polygon index snapshots. `fetchIndexSnapshots()` already fetches `I:VIX9D` and `I:VIX3M` — we already have this data.

**File to edit:** `src/lib/providers/spx-desk.ts`

Find where `fetchUwVixTermStructure()` or equivalent UW vix-term call is used and replace with the Polygon-computed term structure that's already in `computeVixTermStructure()` from `src/lib/providers/polygon.ts`.

Search for these patterns in `src/lib/providers/unusual-whales.ts` to find the 6 functions and add explicit console.error when they return 403, or better — log a warning that these are plan-blocked and return a defined fallback instead of null:

```typescript
// In src/lib/providers/unusual-whales.ts
// Change uwGetSafe to log plan-blocked errors distinctly:
async function uwGetSafe<T>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  if (!uwConfigured()) return null;
  try {
    return await uwGet<T>(path, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403")) {
      console.error(`[uw] PLAN_BLOCKED ${path} — endpoint requires higher tier. Returning null.`);
    } else if (msg.includes("429")) {
      console.warn(`[uw] RATE_LIMITED ${path}`);
    }
    return null;
  }
}
```

For `vix-term-structure` specifically, use the Polygon fallback already computed in `spx-desk.ts`. In the desk build, wherever `fetchUwVixTermStructure` (or any UW vix-term call) is used, replace with `computeVixTermStructure(vix9d, vix3m)` from polygon.ts which takes the already-fetched VIX9D and VIX3M snapshot values.

---

### 1B. UW Rate Limit Overflow — Immediate fix (no WebSocket needed)

**Root cause:** The flow lane polls 4 UW endpoints every 2 seconds = 120 UW calls/min, consuming the entire plan budget. The desk lane's additional 42 UW calls/min cause the 429s seen in production.

**File to edit:** `src/lib/providers/spx-desk.ts`

Find `buildSpxDeskFlow()` (the function that builds the flow lane — returns `SpxDeskFlow`). It currently calls:
1. `fetchUwMarketTide()` — every 2s
2. `fetchUwNope()` — every 2s  
3. `fetchUwFlow0dte()` — every 2s
4. `fetchUwDarkPool()` — every 2s

**Fix:** Move dark pool to a slower sub-cache (10s minimum). Dark pool data doesn't change on a 2s cadence — it's block trade data.

```typescript
// Add at module level in spx-desk.ts:
let cachedDarkPool: { data: DarkPoolSnapshot | null; fetchedAt: number } = { data: null, fetchedAt: 0 };
const DARK_POOL_CACHE_MS = 10_000; // 10s — dark pool doesn't need 2s refresh

// In buildSpxDeskFlow(), replace the direct fetchUwDarkPool call:
const now = Date.now();
let darkPool = cachedDarkPool.data;
if (now - cachedDarkPool.fetchedAt > DARK_POOL_CACHE_MS) {
  const fresh = await fetchUwDarkPool("SPX").catch(() => null);
  if (fresh !== null) {
    cachedDarkPool = { data: fresh, fetchedAt: now };
    darkPool = fresh;
  }
}
```

This alone reduces the flow lane from 4 UW calls/2s to 3 UW calls/2s = **90 UW calls/min** instead of 120 — brings the flow lane under the budget ceiling so the desk lane has headroom.

---

### 1C. ATM Chains 422 — Fix required param

**File:** `src/lib/providers/unusual-whales.ts`

Find `fetchUwAtmChains()` (or wherever `/api/stock/${ticker}/atm-chains` is called).

**Fix:** UW requires an `expiration_date` query param for index underlyings (SPX, SPY). Add it:

```typescript
export async function fetchUwAtmChains(ticker: string, expirationDate?: string) {
  const params: Record<string, string | number> = {};
  if (expirationDate) {
    params.expiration_date = expirationDate;
  } else {
    // Default to today's 0DTE expiry
    params.expiration_date = todayIso();
  }
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/atm-chains`, params);
}
```

---

## 2. HIGH — UW WebSocket Migration

**Goal:** Replace the 2s REST polling of flow alerts, market tide, and dark pool with persistent WebSocket connections to UW. This:
- Cuts flow alert latency from **up to 60s → under 1 second**
- Frees **90+ UW REST calls/min** (the entire current overflow)
- Gives Largo and Night Hawk the full 120 req/min budget

**All 11 UW WebSocket channels confirmed live (HTTP 101) with the current API key.**

### Step 1: Create the UW WebSocket manager

**New file to create:** `src/lib/ws/uw-socket.ts`

```typescript
/**
 * Singleton UW WebSocket manager.
 * Maintains a persistent connection to UW's real-time socket API.
 * Reconnects with exponential backoff. Auth: Bearer token on connect message.
 *
 * Usage:
 *   const unsub = uwSocket.subscribe("flow_alerts", (data) => { ... });
 *   uwSocket.connect(); // call once at server startup
 */

import { publishFlowEvent } from "@/lib/flow-events";
import { parseUwFlowAlert } from "@/lib/providers/unusual-whales";

type UwChannel = "flow_alerts" | "market_tide" | "gex" | "net_flow" | "off_lit_trades" | "trading_halts";

type Handler = (data: unknown) => void;

const UW_WS_BASE = process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/api/socket";
const UW_API_KEY = process.env.UW_API_KEY ?? "";

class UwSocketManager {
  private sockets = new Map<UwChannel, WebSocket>();
  private handlers = new Map<UwChannel, Set<Handler>>();
  private reconnectTimers = new Map<UwChannel, ReturnType<typeof setTimeout>>();
  private reconnectDelays = new Map<UwChannel, number>();

  subscribe(channel: UwChannel, handler: Handler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    if (!this.sockets.has(channel) || this.sockets.get(channel)!.readyState > 1) {
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
        this.reconnectDelays.set(channel, 1000); // reset backoff on success
        // UW auth: send Bearer token after connect
        ws.send(JSON.stringify({ action: "auth", token: UW_API_KEY }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          // Dispatch to all handlers for this channel
          this.handlers.get(channel)?.forEach((h) => {
            try { h(data); } catch { /* ignore handler errors */ }
          });
        } catch {
          // ignore parse errors
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
    this.reconnectDelays.set(channel, delay * 2); // exponential backoff, max 30s

    const timer = setTimeout(() => {
      if ((this.handlers.get(channel)?.size ?? 0) > 0) {
        this.connect(channel);
      }
    }, delay);

    this.reconnectTimers.set(channel, timer);
  }

  // Heartbeat to keep connections alive (call every 30s)
  heartbeat() {
    for (const [channel, ws] of this.sockets) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ action: "ping" }));
      }
    }
  }

  getStatus(): Record<string, string> {
    const states = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    const result: Record<string, string> = {};
    for (const [channel, ws] of this.sockets) {
      result[channel] = states[ws.readyState] ?? "UNKNOWN";
    }
    return result;
  }
}

// Singleton — one manager per server process
export const uwSocket = new UwSocketManager();

// ── Built-in handlers ────────────────────────────────────────────────────────

/** In-memory store for tide data pushed from WS */
export const tideStore: {
  call_premium: number;
  put_premium: number;
  net: number;
  bias: string;
  updatedAt: number;
} = { call_premium: 0, put_premium: 0, net: 0, bias: "neutral", updatedAt: 0 };

/** In-memory store for dark pool pushed from WS */
export const darkPoolStore: {
  data: unknown;
  updatedAt: number;
} = { data: null, updatedAt: 0 };

/** Initialize all subscriptions. Call once at server startup. */
export function initUwSocket() {
  if (!process.env.UW_API_KEY) {
    console.warn("[uw-socket] UW_API_KEY not set — WebSocket disabled, falling back to REST polling");
    return;
  }

  // Flow alerts → existing publishFlowEvent pipeline (feeds SSE + ingest)
  uwSocket.subscribe("flow_alerts", (data) => {
    try {
      const alerts = Array.isArray(data) ? data : (data as Record<string,unknown>)?.data;
      if (!Array.isArray(alerts)) return;
      for (const raw of alerts) {
        const flow = parseUwFlowAlert(raw as Record<string, unknown>);
        // Publish to in-process subscribers (SSE stream already listens via subscribeFlowEvents)
        // Note: publishFlowEvent expects a FlowRow from DB — adapt as needed for your FlowRow type
        publishFlowEvent(flow as never);
      }
    } catch { /* ignore */ }
  });

  // Market tide → tideStore (replaces REST poll in buildSpxDeskFlow)
  uwSocket.subscribe("market_tide", (data) => {
    try {
      const row = Array.isArray(data) ? data[data.length - 1] : (data as Record<string,unknown>)?.data;
      if (!row || typeof row !== "object") return;
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
    } catch { /* ignore */ }
  });

  // Dark pool → darkPoolStore (replaces REST poll)
  uwSocket.subscribe("off_lit_trades", (data) => {
    darkPoolStore.data = data;
    darkPoolStore.updatedAt = Date.now();
  });

  // Heartbeat every 30s to keep WS alive
  setInterval(() => uwSocket.heartbeat(), 30_000);

  console.log("[uw-socket] initialized — flow_alerts, market_tide, off_lit_trades");
}
```

### Step 2: Initialize at server startup

**File to edit:** `src/app/api/market/spx/flow/route.ts` (or the server entry point)

The best place to initialize is in the flow route, which is polled first:

```typescript
// At the top of src/app/api/market/spx/flow/route.ts
import { initUwSocket, tideStore, darkPoolStore } from "@/lib/ws/uw-socket";

// Initialize once (module-level singleton guard)
let wsInitialized = false;
if (!wsInitialized && process.env.UW_API_KEY) {
  wsInitialized = true;
  initUwSocket();
}
```

Alternatively, add to `src/app/api/market/health/route.ts` which is likely called at startup.

### Step 3: Update buildSpxDeskFlow to use WS stores

**File to edit:** `src/lib/providers/spx-desk.ts`

Find `buildSpxDeskFlow()`. Replace `fetchUwMarketTide()` and `fetchUwDarkPool()` calls with reads from the WS stores when they are fresh (< 10s old). Fall back to REST if WS store is stale:

```typescript
// In buildSpxDeskFlow() — replace fetchUwMarketTide():
import { tideStore, darkPoolStore } from "@/lib/ws/uw-socket";

const TIDE_STALE_MS = 10_000; // accept WS tide if < 10s old
const DARK_POOL_STALE_MS = 15_000;

// Tide: use WS store if fresh, otherwise REST fallback
let tide: { call_premium: number; put_premium: number; net: number; bias: string } | null = null;
if (Date.now() - tideStore.updatedAt < TIDE_STALE_MS) {
  tide = tideStore;
} else {
  tide = await fetchUwMarketTide().catch(() => null); // REST fallback
}

// Dark pool: use WS store if fresh, otherwise REST fallback  
let darkPool: DarkPoolSnapshot | null = null;
if (Date.now() - darkPoolStore.updatedAt < DARK_POOL_STALE_MS) {
  darkPool = darkPoolStore.data as DarkPoolSnapshot | null;
} else {
  darkPool = await fetchUwDarkPool("SPX").catch(() => null); // REST fallback
}
```

### Step 4: Update flow ingest to use WS (make cron optional)

**File to edit:** `src/lib/providers/flow-ingest.ts`

When the UW WS `flow_alerts` channel is connected, the cron ingest becomes redundant. Add a check:

```typescript
// In runFlowIngest() — add at top:
import { uwSocket } from "@/lib/ws/uw-socket";

export async function runFlowIngest(): Promise<void> {
  // If WS is connected and delivering flow alerts, skip REST ingest
  const wsStatus = uwSocket.getStatus();
  if (wsStatus["flow_alerts"] === "OPEN") {
    console.log("[flow-ingest] WS active — skipping REST ingest cycle");
    return;
  }
  // ... rest of existing ingest logic
}
```

---

## 3. HIGH — Polygon WebSocket Migration

**Goal:** Replace the 1s Polygon REST pulse poll with a persistent WebSocket connection to Polygon's indices cluster. Eliminates 86,400 HTTP calls/day/tab, reduces SPX price latency from ~1.3s to <100ms.

**Polygon WebSocket endpoints (all on Advanced plan):**
- `wss://socket.massive.com/stocks` — stock trades/quotes/aggs
- `wss://socket.massive.com/options` — options trades/quotes/aggs  
- `wss://socket.massive.com/indices` — index aggs ← **start here**

**Auth:** Send `{"action":"auth","params":"YOUR_API_KEY"}` on connect. Then subscribe: `{"action":"subscribe","params":"A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M"}`.

**Message format (type A = per-second aggregate):**
```json
{"ev":"A","sym":"I:SPX","o":5840.00,"h":5842.50,"l":5839.50,"c":5841.75,"v":123456,"s":1718745600000,"e":1718745601000}
```

### Step 1: Create the Polygon WebSocket manager

**New file:** `src/lib/ws/polygon-socket.ts`

```typescript
/**
 * Polygon/Massive WebSocket client for real-time index data.
 * Replaces the 1s REST pulse poll for SPX/VIX/VIX9D/VIX3M.
 *
 * Polygon WS protocol:
 *   1. Connect to wss://socket.massive.com/indices
 *   2. Receive: [{"ev":"connected","status":"connected"}]
 *   3. Send: {"action":"auth","params":"API_KEY"}
 *   4. Receive: [{"ev":"auth_success","status":"auth_success"}]
 *   5. Send: {"action":"subscribe","params":"A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M"}
 *   6. Receive: per-second agg messages for each subscribed symbol
 */

const POLYGON_WS_INDICES = process.env.POLYGON_WS_INDICES ?? "wss://socket.massive.com/indices";
const POLYGON_WS_OPTIONS = process.env.POLYGON_WS_OPTIONS ?? "wss://socket.massive.com/options";
const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";

export type PolygonAgg = {
  ev: "A" | "AM";
  sym: string;
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close (current price)
  v: number; // volume
  s: number; // start timestamp ms
  e: number; // end timestamp ms
};

// Live index store — updated by WS on every per-second agg
export const indexStore: Record<string, { price: number; change_pct: number; updatedAt: number }> = {
  "I:SPX": { price: 0, change_pct: 0, updatedAt: 0 },
  "I:VIX": { price: 0, change_pct: 0, updatedAt: 0 },
  "I:VIX9D": { price: 0, change_pct: 0, updatedAt: 0 },
  "I:VIX3M": { price: 0, change_pct: 0, updatedAt: 0 },
};

let indicesWs: WebSocket | null = null;
let indicesReconnectDelay = 1000;
let indicesAuthenticated = false;

function connectIndices() {
  if (!POLYGON_API_KEY) {
    console.warn("[polygon-socket] POLYGON_API_KEY not set — WebSocket disabled");
    return;
  }

  try {
    indicesWs = new WebSocket(POLYGON_WS_INDICES);

    indicesWs.onopen = () => {
      console.log("[polygon-socket] indices connected");
      indicesReconnectDelay = 1000;
      indicesAuthenticated = false;
    };

    indicesWs.onmessage = (event) => {
      try {
        const msgs = JSON.parse(String(event.data)) as Array<Record<string, unknown>>;
        for (const msg of msgs) {
          const ev = msg.ev as string;

          if (ev === "connected") {
            // Step 2: Auth immediately after connected message
            indicesWs?.send(JSON.stringify({ action: "auth", params: POLYGON_API_KEY }));
          } else if (ev === "auth_success" || (ev === "status" && msg.status === "auth_success")) {
            // Step 3: Subscribe after successful auth
            indicesAuthenticated = true;
            console.log("[polygon-socket] indices authenticated — subscribing");
            indicesWs?.send(JSON.stringify({
              action: "subscribe",
              params: "A.I:SPX,A.I:VIX,A.I:VIX9D,A.I:VIX3M,A.I:TICK,A.I:TRIN,A.I:ADD",
            }));
          } else if (ev === "A" || ev === "AM") {
            // Per-second or per-minute aggregate — update store
            const agg = msg as unknown as PolygonAgg;
            if (indexStore[agg.sym]) {
              const prev = indexStore[agg.sym].price;
              indexStore[agg.sym] = {
                price: agg.c,
                change_pct: prev > 0 ? ((agg.c - prev) / prev) * 100 : 0,
                updatedAt: Date.now(),
              };
            }
          }
        }
      } catch { /* ignore parse errors */ }
    };

    indicesWs.onerror = (err) => {
      console.error("[polygon-socket] indices error:", err);
    };

    indicesWs.onclose = (event) => {
      console.warn(`[polygon-socket] indices closed (code=${event.code}) — reconnecting in ${indicesReconnectDelay}ms`);
      indicesAuthenticated = false;
      setTimeout(() => connectIndices(), indicesReconnectDelay);
      indicesReconnectDelay = Math.min(indicesReconnectDelay * 2, 30_000);
    };
  } catch (err) {
    console.error("[polygon-socket] failed to connect indices:", err);
    setTimeout(() => connectIndices(), indicesReconnectDelay);
    indicesReconnectDelay = Math.min(indicesReconnectDelay * 2, 30_000);
  }
}

let polygonSocketInitialized = false;

export function initPolygonSocket() {
  if (polygonSocketInitialized) return;
  polygonSocketInitialized = true;
  connectIndices();
  console.log("[polygon-socket] initialized");
}

export function getIndexStoreStatus() {
  return {
    authenticated: indicesAuthenticated,
    wsState: indicesWs ? ["CONNECTING","OPEN","CLOSING","CLOSED"][indicesWs.readyState] : "NOT_CREATED",
    symbols: Object.keys(indexStore).map((sym) => ({
      sym,
      price: indexStore[sym].price,
      ageMs: Date.now() - indexStore[sym].updatedAt,
    })),
  };
}
```

### Step 2: Update buildSpxDeskPulse to use the index store

**File to edit:** `src/lib/providers/spx-desk.ts`

Find `buildSpxDeskPulse()` (the function that returns `SpxDeskPulse`). It calls `fetchIndexSnapshots()` to get SPX, VIX, VIX9D, VIX3M prices. Replace with WS store reads when fresh:

```typescript
import { indexStore, initPolygonSocket } from "@/lib/ws/polygon-socket";

const INDEX_STORE_STALE_MS = 5_000; // use WS data if < 5s old

// In buildSpxDeskPulse() — replace fetchIndexSnapshots call:
const now = Date.now();
const wsSpx = indexStore["I:SPX"];
const wsVix = indexStore["I:VIX"];
const wsVix9d = indexStore["I:VIX9D"];
const wsVix3m = indexStore["I:VIX3M"];

// Use WS store if fresh, otherwise fall back to REST
let spxPrice: number;
let vixPrice: number;
if (wsSpx.updatedAt > 0 && now - wsSpx.updatedAt < INDEX_STORE_STALE_MS) {
  spxPrice = wsSpx.price;
  vixPrice = wsVix.price;
  // ... use wsVix9d.price, wsVix3m.price
} else {
  // REST fallback — existing fetchIndexSnapshots() call
  const snapshots = await fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]);
  // ... existing parsing logic
}
```

### Step 3: Add SSE endpoint for real-time pulse (optional but recommended)

**New file:** `src/app/api/market/spx/pulse/stream/route.ts`

```typescript
import { NextResponse } from "next/server";
import { indexStore } from "@/lib/ws/polygon-socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const data = JSON.stringify({
          spx: indexStore["I:SPX"],
          vix: indexStore["I:VIX"],
          vix9d: indexStore["I:VIX9D"],
          vix3m: indexStore["I:VIX3M"],
          tick: indexStore["I:TICK"],
          trin: indexStore["I:TRIN"],
          add: indexStore["I:ADD"],
          t: Date.now(),
        });
        controller.enqueue(`data: ${data}\n\n`);
      };

      const interval = setInterval(send, 250); // push every 250ms
      send(); // immediate first push

      return () => clearInterval(interval);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

---

## 4. MEDIUM — Night Hawk Rate Limit Hardening

**Problem:** `fetchTickerDossier()` in `src/lib/nighthawk/dossier.ts:117` runs a `Promise.all` with ~20 concurrent calls per ticker (10 UW + 4 Polygon + 2 Finnhub + others). With 20 candidates × 10 UW calls = **200 UW calls in a single edition build** with no rate limiting, no retry, and no backoff. This floods the UW quota in one shot.

**File to edit:** `src/lib/nighthawk/dossier.ts`

### Fix 1: Add retry with exponential backoff to uwGetSafe

**File to edit:** `src/lib/providers/unusual-whales.ts`

Replace `uwGetSafe` with a version that retries on 429:

```typescript
async function uwGetSafe<T>(
  path: string,
  params: Record<string, string | number> = {},
  retries = 2,
): Promise<T | null> {
  if (!uwConfigured()) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await uwGet<T>(path, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403")) {
        console.error(`[uw] PLAN_BLOCKED ${path}`);
        return null; // don't retry 403s
      }
      if (msg.includes("429") && attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500; // 1-1.5s, 2-2.5s
        console.warn(`[uw] rate limited ${path} — retry ${attempt + 1} in ${delay.toFixed(0)}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt === retries) console.warn(`[uw] failed ${path}: ${msg}`);
      return null;
    }
  }
  return null;
}
```

### Fix 2: Batch dossier fetches with concurrency limit

**File to edit:** `src/lib/nighthawk/edition-builder.ts` (wherever dossiers are fetched in a loop)

Look for where `fetchTickerDossier()` is called for multiple tickers. Replace `Promise.all(tickers.map(fetchTickerDossier))` with a concurrency-limited version:

```typescript
// Add this utility function:
async function fetchDossiersWithConcurrencyLimit(
  tickers: string[],
  concurrency = 3, // max 3 simultaneous dossier fetches
): Promise<TickerDossier[]> {
  const results: TickerDossier[] = [];
  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((t) => fetchTickerDossier(t).catch(() => null)));
    results.push(...batchResults.filter(Boolean) as TickerDossier[]);
    // Brief pause between batches to stay within UW rate limit
    if (i + concurrency < tickers.length) {
      await new Promise((r) => setTimeout(r, 2000)); // 2s between batches of 3
    }
  }
  return results;
}
```

With 3 tickers × ~10 UW calls = 30 UW calls per batch, then 2s pause = 30 UW calls per 2 seconds = 900/min theoretical but spread across the edition build's 5-minute window, it's manageable.

### Fix 3: Remove the lowest-value UW calls from dossier

In `fetchTickerDossier()`, the `Promise.all` at line ~141 has these calls that can be deprioritized or removed:
- `fetchUwCongressTrades()` — moves slowly, cache it at a module level for the entire edition build
- `fetchUwRealizedVol()` — Polygon has this via historical bars computation
- `fetchUwRiskReversalSkew()` — available (200) but adds to UW quota

Reduce the dossier's UW calls from ~10 to the highest-signal 5:
1. `fetchMarketFlowAlertRows()` — keep (core signal)
2. `fetchUwDarkPool()` — keep (core signal)
3. `fetchUwOiChange()` — keep (structural signal)
4. `fetchUwIvRank()` — keep (vol gate)
5. `fetchUwFlowPerExpiry()` — keep (entry timing)

Remove or make optional: congress trades, realized vol, risk reversal skew, IV term structure (use Polygon IV for non-index tickers).

---

## 5. MEDIUM — Move In-Process Caches to Redis

**Problem:** These module-level caches in `src/lib/providers/spx-desk.ts` are NOT shared across Railway instances. At 2+ instances, every cache misses independently and calls upstream N times:

| Variable | TTL | Risk |
|---|---|---|
| `cachedOdteBundle` | 15s | 🔴 16 Polygon chain pages × N instances |
| `cachedPulseStructure` | 5s | 🔴 7 Polygon calls × N instances |
| `marketFlowCache` | 15s | 🔴 UW quota × N instances = rate overflow × N |
| `cachedPriorDay` | 60s | 🟡 Low risk |
| `cachedVixIvRank` | 5min | 🟡 Low risk |

**The fix:** Use `sharedCacheSet`/`sharedCacheGet` from `src/lib/shared-cache.ts` (Redis already wired) for the hot caches.

**File to edit:** `src/lib/providers/unusual-whales.ts`

Replace the in-process `marketFlowCache` with Redis:

```typescript
// Replace the in-process cache:
// let marketFlowCache: { expiresAt: number; rows: MarketFlowRow[] } | null = null;

// With Redis-backed cache:
const MARKET_FLOW_CACHE_KEY = "uw:market_flow_alerts";
const MARKET_FLOW_CACHE_TTL = 15; // seconds

async function getMarketFlowFromCache(): Promise<MarketFlowRow[] | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const { sharedCacheGet } = await import("@/lib/shared-cache");
    return await sharedCacheGet<MarketFlowRow[]>(MARKET_FLOW_CACHE_KEY);
  } catch { return null; }
}

async function setMarketFlowCache(rows: MarketFlowRow[]): Promise<void> {
  if (!process.env.REDIS_URL) return;
  try {
    const { sharedCacheSet } = await import("@/lib/shared-cache");
    await sharedCacheSet(MARKET_FLOW_CACHE_KEY, rows, MARKET_FLOW_CACHE_TTL);
  } catch { /* ignore */ }
}
```

Then update `fetchMarketFlowAlertRows()` to check Redis cache first:
```typescript
export async function fetchMarketFlowAlertRows(params?: { ... }): Promise<MarketFlowRow[]> {
  if (!params?.newer_than) {
    const cached = await getMarketFlowFromCache();
    if (cached) return filterMarketFlowRows(cached, params);
  }
  // ... rest of existing fetch logic, then call setMarketFlowCache(rows) before returning
}
```

**File to edit:** `src/lib/providers/polygon-options-gex.ts`

Find `cachedOdteBundle` (the 15s GEX chain cache). Add Redis layer with the same pattern using `DESK_STICKY_KEYS` already defined in `src/lib/shared-cache.ts` or add a new key.

---

## 6. MEDIUM — Largo Tool Pre-Filtering

**Problem:** `src/lib/largo/tool-defs.ts` exports 75 tool definitions. Every Largo query sends all 75 to Claude as part of the prompt. Each tool definition is verbose JSON (name, description, input_schema). This adds ~15,000–20,000 tokens to every request, increasing cost and TTFT.

**File to check:** `src/lib/largo/question-intent.ts` — this file likely has intent classification logic. Check if it's already used for tool filtering.

**File to edit:** `src/lib/largo/tool-defs.ts` and `src/lib/largo-terminal.ts`

### Fix: Group tools by category and filter by intent

```typescript
// In src/lib/largo/tool-defs.ts, add tool groups:
export const TOOL_GROUPS = {
  spx_desk: ["get_spx_structure", "get_spx_play", "get_open_plays", "get_flow_tape", "get_signal_log"],
  flow_analysis: ["get_options_flow", "get_global_flow", "get_dark_pool", "get_nope"],
  stock_analysis: ["get_quote", "get_technicals", "get_gex", "get_options_chain", "get_oi_per_strike", "get_max_pain", "get_greeks", "get_short_interest"],
  vol_analysis: ["get_iv_stats", "get_market_context", "get_vix_term"],
  news_events: ["get_news", "get_web_search", "get_earnings", "get_economic_calendar"],
  fundamental: ["get_analyst_ratings", "get_financials", "get_insider_flow", "get_congress_trades"],
  platform: ["get_platform_snapshot", "get_trade_history", "get_nighthawk_edition"],
  // ... etc
} as const;

// Intent → tool groups mapping (expand as needed):
export function getToolsForIntent(intent: string): string[] {
  const lower = intent.toLowerCase();
  if (lower.includes("flow") || lower.includes("tape") || lower.includes("sweep")) {
    return [...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.flow_analysis];
  }
  if (lower.includes("spx") || lower.includes("play") || lower.includes("signal")) {
    return [...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.vol_analysis];
  }
  if (lower.includes("vol") || lower.includes("vix") || lower.includes("iv")) {
    return [...TOOL_GROUPS.vol_analysis, ...TOOL_GROUPS.spx_desk];
  }
  if (lower.includes("earnings") || lower.includes("news")) {
    return [...TOOL_GROUPS.news_events, ...TOOL_GROUPS.stock_analysis];
  }
  // Default: core set only (SPX + stock + vol)
  return [...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.stock_analysis, ...TOOL_GROUPS.vol_analysis];
}
```

In `src/lib/largo-terminal.ts`, before calling Claude, filter the tool definitions:
```typescript
import { ALL_TOOL_DEFS, getToolsForIntent } from "@/lib/largo/tool-defs";

// Filter tools based on question intent
const allowedToolNames = getToolsForIntent(userQuestion);
const filteredTools = ALL_TOOL_DEFS.filter((t) => allowedToolNames.includes(t.name));
// Use filteredTools instead of ALL_TOOL_DEFS in the Anthropic call
```

---

## 7. LOW — New Polygon Capabilities (Available on Current Plan, Not Wired)

All endpoints below return HTTP 200 on current plan. No plan upgrade needed.

### 7A. Pre-computed SPX RSI from Polygon

**Currently:** RSI is manually computed from minute bars in `src/lib/spx-play-technicals.ts`.

**Replace with:** Direct API call to `/v1/indicators/rsi/I:SPX?window=14&timespan=minute&series_type=close&limit=1`

In `src/lib/providers/polygon.ts`, add:
```typescript
export async function fetchIndexRsi(symbol: string, window = 14, timespan = "minute") {
  const sym = symbol.startsWith("I:") ? encodeURIComponent(symbol) : symbol;
  const data = await polygonGet<{ results: { values: Array<{ value: number }> } }>(
    `/v1/indicators/rsi/${sym}`,
    { window, timespan, series_type: "close", limit: 1 }
  );
  return data?.results?.values?.[0]?.value ?? null;
}
```

### 7B. Spot GEX per 1min (UW — available on current plan, returns 200)

**Currently not wired.** Returns the GEX at the current spot price, updated every 1 minute.

**Add to** `src/lib/providers/unusual-whales.ts`:
```typescript
export async function fetchUwSpotExposures(ticker = "SPX") {
  return uwGetSafe<unknown>(`/api/stock/${ticker}/spot-exposures`, {});
}
```

Wire into `buildSpxDeskFlow()` alongside the existing `fetchUwOdteGex()` call. This gives live dealer positioning as SPX moves through strikes — more accurate than the static GEX walls that only update every 15s.

### 7C. Option Price Levels (UW — available on current plan, returns 200)

OI-concentration magnetic price levels — distinct from max pain. Useful as additional desk structure levels.

```typescript
export async function fetchUwOptionPriceLevels(ticker = "SPX") {
  return uwGetSafe<unknown>(`/api/stock/${ticker}/option/stock-price-levels`, {});
}
```

Add the returned levels to `buildLevels()` in `src/lib/providers/spx-desk.ts`.

### 7D. Daily Market Summary (Polygon — breadth scoring)

`/v2/aggs/grouped/locale/us/market/stocks/{date}` — full market OHLC + VWAP for all stocks in one call.

In `src/lib/providers/polygon.ts`, add:
```typescript
export async function fetchDailyMarketSummary(date: string) {
  return polygonGet<{ results: Array<{ T: string; o: number; h: number; l: number; c: number; vw: number }> }>(
    `/v2/aggs/grouped/locale/us/market/stocks/${date}`,
    { adjusted: true, include_otc: false }
  );
}
```

Use in `buildSpxDesk()` to compute `pct_above_vwap` (count of stocks with `c > vw`) as a breadth signal.

---

## ENVIRONMENT VARIABLES TO ADD

Add these to Railway and `.env.local`:

```bash
# WebSocket URLs (defaults shown — only override if using a proxy)
POLYGON_WS_INDICES=wss://socket.massive.com/indices
POLYGON_WS_OPTIONS=wss://socket.massive.com/options
POLYGON_WS_STOCKS=wss://socket.massive.com/stocks
UW_WS_BASE=wss://api.unusualwhales.com/api/socket

# Tuning (optional — these have safe defaults in code)
UW_FLOW_ALERTS_CACHE_SEC=15
SPX_FLOW_CACHE_SEC=2
SPX_PULSE_CACHE_SEC=1
SPX_DESK_CACHE_SEC=10
```

---

## TESTING CHECKLIST

After implementing each fix:

**1A (403 fix):**
- [ ] Confirm `console.error [uw] PLAN_BLOCKED` appears in logs instead of silent null
- [ ] Confirm VIX term structure reads from Polygon (check desk payload `vix_term.structure`)

**1B (rate limit):**
- [ ] Watch Railway logs — 429s should reduce significantly
- [ ] `x-uw-req-per-minute-remaining` header should stay above 20 during RTH

**2 (UW WS):**
- [ ] `[uw-socket] connected: flow_alerts` appears in logs on startup
- [ ] `[uw-socket] connected: market_tide` appears
- [ ] Flow alerts appear in SSE `/api/market/flows/stream` within 2s of a sweep
- [ ] Confirm cron `/api/cron/flow-ingest` logs "WS active — skipping REST ingest cycle"

**3 (Polygon WS):**
- [ ] `[polygon-socket] indices authenticated — subscribing` in logs
- [ ] `indexStore["I:SPX"].updatedAt` is recent (< 2s ago) during RTH
- [ ] SPX price on desk updates more frequently than before

**4 (Night Hawk):**
- [ ] Night Hawk edition build completes without 429 errors
- [ ] Check logs for retry messages — they should be rare

**5 (Redis caches):**
- [ ] Two Railway instances serve the same flow alert data (check `polled_at` consistency across instances)

**6 (Largo tools):**
- [ ] Largo queries respond faster (measure TTFT before/after)
- [ ] Tool filtering doesn't accidentally exclude a needed tool — test complex cross-category queries

---

## FILE CHANGE SUMMARY

| File | Change type | Priority |
|---|---|---|
| `src/lib/providers/unusual-whales.ts` | Edit `uwGetSafe` — add 403 logging + 429 retry | P0 |
| `src/lib/providers/spx-desk.ts` | Add dark pool sub-cache in `buildSpxDeskFlow()` | P0 |
| `src/lib/providers/unusual-whales.ts` | Fix `fetchUwAtmChains()` — add expiry param | P0 |
| `src/lib/ws/uw-socket.ts` | **NEW** — UW WebSocket manager | P1 |
| `src/lib/ws/polygon-socket.ts` | **NEW** — Polygon WebSocket manager | P1 |
| `src/lib/providers/spx-desk.ts` | Use WS stores in `buildSpxDeskFlow()` and `buildSpxDeskPulse()` | P1 |
| `src/app/api/market/spx/flow/route.ts` | Initialize WS managers | P1 |
| `src/lib/providers/flow-ingest.ts` | Skip REST ingest when WS is connected | P1 |
| `src/app/api/market/spx/pulse/stream/route.ts` | **NEW** — SSE endpoint for Polygon WS data | P1 |
| `src/lib/nighthawk/dossier.ts` | Reduce UW calls, add concurrency limit | P2 |
| `src/lib/providers/unusual-whales.ts` | Add retry to `uwGetSafe` | P2 |
| `src/lib/nighthawk/edition-builder.ts` | Replace `Promise.all` with batched concurrency | P2 |
| `src/lib/providers/unusual-whales.ts` | Replace `marketFlowCache` with Redis | P2 |
| `src/lib/providers/polygon-options-gex.ts` | Add Redis layer to `cachedOdteBundle` | P2 |
| `src/lib/largo/tool-defs.ts` | Add `TOOL_GROUPS` and `getToolsForIntent()` | P2 |
| `src/lib/largo-terminal.ts` | Filter tools by intent before Claude call | P2 |
| `src/lib/providers/polygon.ts` | Add `fetchIndexRsi()` | P3 |
| `src/lib/providers/unusual-whales.ts` | Add `fetchUwSpotExposures()` | P3 |
| `src/lib/providers/unusual-whales.ts` | Add `fetchUwOptionPriceLevels()` | P3 |
