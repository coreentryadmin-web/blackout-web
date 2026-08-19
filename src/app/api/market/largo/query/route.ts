import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { validateAttachments } from "@/lib/largo/core/image-attachment";
import { largoConfigured, runLargoQuery, runLargoQueryStream, isSseClientDisconnect, SseClientDisconnected, type LargoTurnOptions } from "@/lib/largo-terminal";
import { parseLargoDepth } from "@/lib/largo/largo-depth";
import type { LargoPlayContext } from "@/lib/largo/session-metadata";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { largoBudgetKey, secondsUntilEtMidnight, largoDailyQueryBudget } from "@/lib/largo-budget";
import {
  aiSpendKey,
  aiSpendKillSwitchUsd,
  aiSpendLocalBackstopFrac,
  AI_SPEND_HEADROOM_LUA,
  isOverAiSpendCeiling,
  isOverAiSpendLocalBackstop,
} from "@/lib/ai-spend-ledger";
import { currentProcessAiSpendUsd } from "@/lib/providers/anthropic";
import { LocalConcurrencyBackstop, largoLocalMaxConcurrent } from "@/lib/largo-local-gate";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  LARGO_INFLIGHT_KEY,
  LARGO_INFLIGHT_ACQUIRE_LUA,
  largoGlobalMaxConcurrent,
  largoInflightTtlMs,
  inflightStaleCutoff,
} from "@/lib/largo-global-gate";
import { randomUUID } from "node:crypto";
import { shouldRejectLargoWithoutRedis } from "@/lib/largo-redis-policy";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { largoMemberRouteDeadlineMs } from "@/lib/providers/config";

// ---------------------------------------------------------------------------
// Largo concurrency gate — max 2 simultaneous queries per user, Redis-backed.
// Fails open (acquired = true) when Redis is unavailable so queries still work.
// ---------------------------------------------------------------------------

type GateRedis = {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | number): Promise<"OK">;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<number>;
} | null;

const MAX_LARGO_CONCURRENT = 2;
const LARGO_TTL_S = 180; // 3 min — auto-expire stuck counters

// Process-local concurrency backstop. The per-user Redis gate below FAILS OPEN on Redis
// loss, which would let a premium surge uncork unbounded concurrent Claude tool-loops. This
// in-memory counter is consulted ONLY in the fail-open paths so a Redis outage degrades to
// (cap × replica count) instead of "unbounded"; with Redis healthy it is never touched and
// the per-user gate stays fully authoritative. See largo-local-gate.ts for the rationale.
const largoBackstop = new LocalConcurrencyBackstop(largoLocalMaxConcurrent());

type LargoSlot = { acquired: boolean; redis: GateRedis; localSlot: boolean };

// Atomic acquire: INCR + EXPIRE in one round-trip so a crash between the two can
// never leave a counter with no TTL (which would lock the user out until their
// next request re-applied expire) — LARGO-7. Returns the post-incr count.
const ACQUIRE_LUA =
  "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";

// Fail-open fallback: no per-user Redis gate available, so admit iff the process-local
// backstop has a free slot. `localSlot` flags that a backstop reservation is held (release
// must give it back) and forces redis=null so downstream Redis ops correctly no-op.
function acquireViaBackstop(): LargoSlot {
  const ok = largoBackstop.tryAcquire();
  return { acquired: ok, redis: null, localSlot: ok };
}

async function acquireLargoSlot(userId: string): Promise<LargoSlot> {
  // getUwCacheRedis returns a minimal RedisClient type; cast to GateRedis so we
  // can call incr/decr/expire/eval which ioredis supports at runtime.
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return acquireViaBackstop(); // fail-open WITH local backstop: no Redis → no per-user gate

  const key = `largo:active:${userId}`;
  try {
    const count = Number(await redis.eval(ACQUIRE_LUA, 1, key, LARGO_TTL_S));
    if (count > MAX_LARGO_CONCURRENT) {
      await redis.decr(key);
      return { acquired: false, redis, localSlot: false };
    }
    return { acquired: true, redis, localSlot: false };
  } catch {
    // Redis error → fail-open, but still bounded by the local backstop
    return acquireViaBackstop();
  }
}

async function releaseLargoSlot(userId: string, redis: GateRedis, localSlot: boolean): Promise<void> {
  if (localSlot) largoBackstop.release(); // give back the in-memory reservation, if any
  if (!redis) return;
  const key = `largo:active:${userId}`;
  try {
    const val = await redis.decr(key);
    if (val < 0) await redis.set(key, 0); // clamp to 0 if it goes negative
  } catch {
    /* non-fatal — TTL will clean up the key within LARGO_TTL_S seconds */
  }
}

// ---------------------------------------------------------------------------
// Cross-replica GLOBAL concurrency ceiling (audit §3.7) — caps total simultaneous Largo queries
// across ALL users + replicas, on top of the per-user gate. Acquired AFTER the per-user gate so only
// queries that already passed per-user consume global capacity. Leak-safe ZSET (a crashed replica's
// reservation self-heals on the next acquire, see largo-global-gate.ts). FAILS OPEN on Redis loss —
// the per-process local backstop already bounds that path, so this ceiling only binds when Redis is
// healthy. Reuses the per-user gate's Redis handle: if that was null (fail-open), this is a no-op
// too, keeping both gates consistent on an outage.
// ---------------------------------------------------------------------------

type GlobalSlot = { acquired: boolean; reqId: string | null; redis: GateRedis };

async function acquireLargoGlobalSlot(redis: GateRedis): Promise<GlobalSlot> {
  if (!redis) return { acquired: true, reqId: null, redis }; // fail-open: no Redis → no global gate
  const reqId = randomUUID();
  const now = Date.now();
  const ttlMs = largoInflightTtlMs();
  try {
    const ok = Number(
      await redis.eval(
        LARGO_INFLIGHT_ACQUIRE_LUA,
        1,
        LARGO_INFLIGHT_KEY,
        inflightStaleCutoff(now, ttlMs),
        largoGlobalMaxConcurrent(),
        now,
        reqId,
        ttlMs
      )
    );
    if (ok === 1) return { acquired: true, reqId, redis };
    return { acquired: false, reqId: null, redis }; // at the org-wide cap
  } catch {
    return { acquired: true, reqId: null, redis }; // Redis error → fail-open (backstop bounds blast radius)
  }
}

async function releaseLargoGlobalSlot(slot: GlobalSlot): Promise<void> {
  if (!slot.redis || !slot.reqId) return; // nothing reserved (fail-open path)
  try {
    await slot.redis.zrem(LARGO_INFLIGHT_KEY, slot.reqId);
  } catch {
    /* non-fatal — a stranded reservation is pruned by the staleCutoff on the next acquire within TTL */
  }
}

// ---------------------------------------------------------------------------
// Largo per-user DAILY query budget — bounds unbounded cost exposure (audit P1).
// CHECK reads the daily counter (fail-open like the concurrency gate); RECORD
// atomically INCR+EXPIREs it (same Lua pattern) only AFTER a query runs so the
// daily key always carries a TTL. Cost is bounded because each query is itself
// cost-capped by anthropicToolLoop's maxRounds*maxTokens.
// ---------------------------------------------------------------------------

const BUDGET_RESERVE_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if c > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return c
`;

/**
 * Atomically reserve one daily budget slot (INCR, refund if over cap).
 * Closes the check-then-act race where concurrent requests all saw count < cap
 * and all ran. Fails OPEN (allow) when Redis is null/errors — same as before.
 */
async function reserveLargoBudget(userId: string, redis: GateRedis): Promise<boolean> {
  if (!redis) return true; // fail-open: no Redis → no budget gate
  try {
    const reserved = await redis.eval(
      BUDGET_RESERVE_LUA,
      1,
      largoBudgetKey(userId),
      secondsUntilEtMidnight(),
      largoDailyQueryBudget()
    );
    return Number(reserved) !== 0;
  } catch {
    return true; // Redis error → fail-open
  }
}

// ---------------------------------------------------------------------------
// ORG-WIDE hard kill-switch — bounds total daily Anthropic spend across ALL users and
// replicas. Reads the cross-replica spend ledger (anthropic.ts writes it) and rejects new
// Largo queries once the org total is AT/over the absolute DAILY_AI_SPEND_KILL_USD ceiling.
// OPT-IN: disabled unless the env ceiling is set (see aiSpendKillSwitchUsd).
//
// FAILS CLOSED on Redis loss (audit #5/#6): a Redis blip is exactly when an unbounded Claude loop
// is most dangerous, so instead of no-op'ing to "allow" we fall back to the SAME per-process
// AI-spend backstop the provider layer uses (currentProcessAiSpendUsd vs frac × ceiling). With
// Redis UP the authoritative cross-replica total is used unchanged.
// ---------------------------------------------------------------------------

/** True when daily Anthropic spend is AT/over the hard ceiling and new queries must be rejected.
 *  Kill-switch disarmed → always false (allow). Redis up → cross-replica ledger. Redis down → the
 *  conservative per-process backstop (fail CLOSED), NOT a blanket allow. */
async function isLargoKillSwitchTripped(): Promise<boolean> {
  const ceiling = aiSpendKillSwitchUsd();
  if (ceiling == null) return false; // kill-switch not armed → never blocks
  const localBackstopTripped = () =>
    isOverAiSpendLocalBackstop(currentProcessAiSpendUsd(), ceiling, aiSpendLocalBackstopFrac());
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return localBackstopTripped(); // Redis down → fail CLOSED to the local backstop
  try {
    const headroom = await redis.eval(AI_SPEND_HEADROOM_LUA, 1, aiSpendKey(), String(ceiling));
    if (Number(headroom) === 0) return true;
    const raw = await redis.get(aiSpendKey());
    return isOverAiSpendCeiling(Number(raw ?? 0), ceiling);
  } catch {
    return localBackstopTripped(); // Redis error → fail CLOSED to the local backstop
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Keep mobile/CF proxies from killing silent tool-loop SSE legs (40–90s with no tokens). */
const LARGO_SSE_HEARTBEAT_MS = 12_000;

/** Hard ceiling before ALB idle timeout (120s) — return a member-visible error, not a gateway 504. */
const LARGO_ROUTE_DEADLINE_MS = largoMemberRouteDeadlineMs();

const LARGO_ROUTE_TIMEOUT_MESSAGE =
  "This question ran long before the desk could finish. Try Quick read, or ask about one ticker or one desk.";

class LargoRouteDeadlineError extends Error {
  constructor() {
    super("Largo route deadline exceeded");
    this.name = "LargoRouteDeadlineError";
  }
}

function largoRouteDeadlineRace<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn(
        `[market/largo/query] exceeded ${LARGO_ROUTE_DEADLINE_MS}ms route deadline — returning before ALB 504`
      );
      reject(new LargoRouteDeadlineError());
    }, LARGO_ROUTE_DEADLINE_MS);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function wantsStream(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get("stream") === "1") return true;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — Largo is locked to non-admins until it ships (every call spends Anthropic tokens).
  const locked = await requireToolApi("largo");
  if (locked) return locked;

  if (!largoConfigured()) {
    return NextResponse.json(
      { error: "AI assistant unavailable" },
      { status: 503 }
    );
  }

  // Fail-closed when Redis is down (audit F-1): without Redis there is no per-user budget
  // gate and the org spend ledger is blind. Opt out via LARGO_REDIS_FAILOPEN=1 (local dev).
  const gateRedis = (await getUwCacheRedis()) as GateRedis;
  if (shouldRejectLargoWithoutRedis(gateRedis != null)) {
    return NextResponse.json(
      { error: "Largo is temporarily unavailable. Please retry in a moment." },
      { status: 503 },
    );
  }

  let body: {
    question?: string;
    session_id?: string;
    images?: unknown;
    depth?: string;
    historical?: boolean;
    play_context?: unknown;
    desk_scope?: string;
    desk_scope_args?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = String(body.question ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();

  // ATTACHMENTS — validated at the boundary, before any slot, budget or token is spent.
  //
  // Ordered ahead of the gates on purpose: a malformed upload is the caller's mistake and must
  // cost them nothing but a 400. Validating after the daily-budget reserve would burn one of the
  // member's queries on a file their phone mislabelled.
  //
  // Everything about the payload is attacker-controlled — bytes, declared type and length alike —
  // so validateAttachments re-derives the media type from the magic bytes and measures size from
  // the base64 length without decoding. See image-attachment.ts for why each rule exists.
  const attachments = validateAttachments(body.images);
  if (!attachments.ok) {
    return NextResponse.json({ error: attachments.error }, { status: 400 });
  }
  const images = attachments.blocks;

  // An image alone IS a question — "what do you make of this?" is implied by the act of pasting a
  // chart. Requiring text would make the obvious interaction fail for no reason.
  if (!question && images.length === 0) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // A concrete stand-in rather than an empty string: every downstream stage (intent analysis,
  // capability ranking, the query plan, the persisted transcript) is written against a real
  // question, and "" would quietly degrade all of them at once.
  const effectiveQuestion = question || "What do you make of this?";

  if (question.length > 4000) {
    return NextResponse.json({ error: "question too long" }, { status: 400 });
  }

  const resolvedSessionId = sessionId || `web-${authResult.userId}-${Date.now()}`;

  const turnOptions: LargoTurnOptions = {
    depth: parseLargoDepth(body.depth),
    historicalMode: Boolean(body.historical),
    playContext:
      body.play_context && typeof body.play_context === "object"
        ? (body.play_context as LargoPlayContext)
        : null,
    deskScope: typeof body.desk_scope === "string" ? body.desk_scope : null,
    deskScopeArgs:
      body.desk_scope_args && typeof body.desk_scope_args === "object"
        ? (body.desk_scope_args as LargoTurnOptions["deskScopeArgs"])
        : null,
  };

  // Org-wide kill-switch — checked FIRST (cheap GET, no side effects, holds no slot). If the
  // whole org has burned past the hard daily spend ceiling, reject before doing any work.
  if (await isLargoKillSwitchTripped()) {
    return NextResponse.json(
      { error: "Largo is temporarily paused: the platform-wide daily AI spend limit has been reached. Try again after midnight ET." },
      { status: 503 }
    );
  }

  // Concurrency gate — max MAX_LARGO_CONCURRENT simultaneous queries per user.
  const userId = authResult.userId;
  const slot = await acquireLargoSlot(userId);
  if (!slot.acquired) {
    return NextResponse.json(
      { error: "Too many active Largo sessions. Please wait for a previous query to complete." },
      { status: 429 }
    );
  }

  // Org-wide concurrency ceiling — reject (releasing the per-user slot we just took) if the WHOLE
  // cluster is at capacity, so a premium surge can't fan out unbounded Claude tool-loops across
  // replicas. Acquired after the per-user gate; reuses its Redis handle so both fail open together.
  const globalSlot = await acquireLargoGlobalSlot(slot.redis);
  if (!globalSlot.acquired) {
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
    return NextResponse.json(
      { error: "Largo is at peak capacity right now. Please retry in a few seconds." },
      { status: 503 }
    );
  }

  // Daily budget — atomic reserve (INCR + refund if over cap) closes the concurrent
  // check-then-act race. Fail-open inside. One reserve before BOTH branches; slot
  // is consumed even if the query later errors (token cost already incurred once work starts —
  // we reserve before work, so a mid-flight hangup still counts).
  if (!(await reserveLargoBudget(userId, slot.redis))) {
    await releaseLargoGlobalSlot(globalSlot);
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
    return NextResponse.json(
      { error: `Daily Largo query limit reached (${largoDailyQueryBudget()}/day). Try again after midnight ET.` },
      { status: 429 }
    );
  }

  if (wantsStream(req)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const markClosed = () => {
          closed = true;
        };
        req.signal.addEventListener("abort", markClosed, { once: true });

        const send = (payload: unknown): boolean => {
          if (closed || req.signal.aborted) {
            closed = true;
            return false;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            return true;
          } catch (err) {
            closed = true;
            if (!isSseClientDisconnect(err)) {
              console.warn("[market/largo/query stream] enqueue failed:", err);
            }
            return false;
          }
        };

        const heartbeatTimer = setInterval(() => {
          send({ type: "ping", t: Date.now() });
        }, LARGO_SSE_HEARTBEAT_MS);
        send({ type: "ping", t: Date.now() });

        try {
          await largoRouteDeadlineRace(
            runLargoQueryStream(
              effectiveQuestion,
              resolvedSessionId,
              userId,
              (event) => {
                if (!send(event)) {
                  closed = true;
                  throw new SseClientDisconnected();
                }
              },
              // The browser ALWAYS takes this branch — the terminal requests text/event-stream. An
              // images argument omitted here reaches the model as a turn with no picture and produces
              // a fluent answer about a chart nobody sent, which is the worst possible failure of
              // this feature and the one with no error to notice.
              images,
              turnOptions
            )
          );
        } catch (error) {
          if (error instanceof LargoRouteDeadlineError) {
            send({ type: "error", message: LARGO_ROUTE_TIMEOUT_MESSAGE });
            return;
          }
          if (isSseClientDisconnect(error)) return;
          console.error("[market/largo/query stream]", error);
          send({ type: "error", message: "Largo query failed" });
        } finally {
          clearInterval(heartbeatTimer);
          closed = true;
          // Budget was reserved atomically before the stream started — do not INCR again.
          // Release both concurrency slots (global then per-user) before closing the controller.
          await releaseLargoGlobalSlot(globalSlot);
          await releaseLargoSlot(userId, slot.redis, slot.localSlot);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        ...NO_STORE_HEADERS,
        Connection: "keep-alive",
        Pragma: "no-cache",
      },
    });
  }

  try {
    const result = await largoRouteDeadlineRace(
      runLargoQuery(effectiveQuestion, resolvedSessionId, userId, images, turnOptions)
    );
    return NextResponse.json(result, {
      headers: {
        ...NO_STORE_HEADERS,
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    if (error instanceof LargoRouteDeadlineError) {
      return NextResponse.json(
        { error: LARGO_ROUTE_TIMEOUT_MESSAGE },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
    console.error("[market/largo/query]", error);
    return NextResponse.json({ error: "Largo query failed" }, { status: 502, headers: NO_STORE_HEADERS });
  } finally {
    // Budget was reserved atomically before the query — do not INCR again.
    // Release both concurrency slots (global then per-user) whether success or failure.
    await releaseLargoGlobalSlot(globalSlot);
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
  }
}
