/**
 * Best-effort persistence for zerodte_discovery_events (Phase 2a).
 *
 * Throttled like rejections.ts — one row per ticker per DISTINCT state transition,
 * not one row per ~2min scan cycle. Scan/persist never blocks on a write failure.
 */
import {
  dbConfigured,
  getMeta,
  setMeta,
  insertZeroDteDiscoveryEvent,
  tryAdvisoryLock,
  releaseAdvisoryLock,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { EnrichedZeroDteSetup, ZeroDteGateRejection } from "./board";
import type { MarketStateSnapshot } from "./market-state-engine";
import { weightedScoreForMerge } from "./market-state-engine";

const DISCOVERY_EVENT_CURSOR_KEY = "zerodte_discovery_event_cursor";

type CursorEntry = { date: string; key: string };

function loadCursor(raw: string | null, today: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && entry.date === today && typeof entry.key === "string") {
        map.set(id, entry.key);
      }
    }
  } catch {
    // corrupt — treat as empty
  }
  return map;
}

async function readCursor(today: string): Promise<Map<string, string>> {
  const raw = await getMeta(DISCOVERY_EVENT_CURSOR_KEY);
  return loadCursor(raw, today);
}

async function writeCursor(today: string, map: Map<string, string>): Promise<void> {
  const obj: Record<string, CursorEntry> = {};
  for (const [id, key] of map.entries()) obj[id] = { date: today, key };
  await setMeta(DISCOVERY_EVENT_CURSOR_KEY, JSON.stringify(obj));
}

function objectId(sessionDate: string, ticker: string): string {
  return `${sessionDate}:${ticker.toUpperCase()}`;
}

/** Score bucket — avoids a row every cycle when score jitters ±1. */
function detectedStateKey(score: number, origins: readonly string[]): string {
  const bucket = Math.round(score / 5) * 5;
  return JSON.stringify({ kind: "detected", bucket, origins: [...origins].sort() });
}

function gateBlockedStateKey(gate: string, direction: string): string {
  return JSON.stringify({ kind: "gate_blocked", gate, direction });
}

function commitStateKey(): string {
  return JSON.stringify({ kind: "commit" });
}

function shouldWrite(cursor: Map<string, string>, id: string, key: string): boolean {
  if (cursor.get(id) === key) return false;
  cursor.set(id, key);
  return true;
}

// Lock key for the read-modify-write below. DISCOVERY_EVENT_CURSOR_KEY is ONE shared
// platform_meta row keyed by `${sessionDate}:${ticker}`, and all three functions below
// (persistDiscoveryDetectedEvents / persistDiscoveryGateBlockedEvents /
// persistDiscoveryCommitEvents) read the WHOLE blob, mutate their own in-memory copy, and
// write the WHOLE blob back — so they must serialize against EACH OTHER, not just against
// repeat calls of the same function. One global key (not per-function) is deliberate for
// exactly that reason.
//
// MUST be atomic across callers: within a single warmZeroDteBoard cycle (scan.ts),
// persistDiscoveryGateBlockedEvents is called from persistZeroDteScan, persistDiscoveryCommitEvents
// is called from persistZeroDteScan's atomic-commit path, and persistDiscoveryDetectedEvents +
// persistDiscoveryGateBlockedEvents (again, for a DIFFERENT top-level rejection population) are
// called from warmZeroDteBoard itself — all as fire-and-forget (`void ... .catch(...)`), so every
// one of these can be in flight at once. Before this fix, readCursor (read) then writeCursor
// (write) were two separate unlocked Postgres round-trips: if two calls interleave — both read
// the SAME base map before either writes, both mutate their own in-memory copy, both write —
// whichever setMeta resolves LAST silently clobbers the other's additions, losing the ticker(s)
// it was adding AND the dedup history for every other ticker already in the blob it read before
// the race. That causes duplicate zerodte_discovery_events rows immediately and on later ticks (a
// clobbered ticker reads as "never logged" again). Pure observability data — never gates a live
// trade — but a genuine, confirmed lost-update bug, same shape as REJECTION_CURSOR_WRITE_LOCK in
// ./rejections.ts and x-rate-budget.ts's BUDGET_WRITE_LOCK. Serialize the whole
// read+mutate+write with the same tryAdvisoryLock/releaseAdvisoryLock primitive, same bounded
// retry (non-blocking "try", not a queue — the holder releases within a couple of round-trips).
const DISCOVERY_EVENT_CURSOR_WRITE_LOCK = "zerodte-discovery-event-cursor-write";
const DISCOVERY_EVENT_LOCK_MAX_ATTEMPTS = 30;
const DISCOVERY_EVENT_LOCK_RETRY_MS = 60;

/** Runs `fn` (a read-modify-write critical section against DISCOVERY_EVENT_CURSOR_KEY) while
 *  holding DISCOVERY_EVENT_CURSOR_WRITE_LOCK, so the three exported functions below can never
 *  clobber each other's cursor additions. Falls back to running unlocked (logged) after bounded
 *  retries rather than silently dropping the write forever — worse than the locked path, but no
 *  worse than before this fix. */
async function withDiscoveryEventCursorLock<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < DISCOVERY_EVENT_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(DISCOVERY_EVENT_CURSOR_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, DISCOVERY_EVENT_LOCK_RETRY_MS));
      continue;
    }
    try {
      return await fn();
    } finally {
      await releaseAdvisoryLock(DISCOVERY_EVENT_CURSOR_WRITE_LOCK);
    }
  }
  console.warn(
    `[zerodte-discovery-events] could not acquire ${DISCOVERY_EVENT_CURSOR_WRITE_LOCK} after ${DISCOVERY_EVENT_LOCK_MAX_ATTEMPTS} attempts — writing unlocked`
  );
  return fn();
}

/** Top post-gate candidates — default cap 24 (FLOW 48 + rails, throttled per ticker). */
export async function persistDiscoveryDetectedEvents(
  setups: readonly EnrichedZeroDteSetup[],
  marketState: MarketStateSnapshot | null,
  opts?: { maxEvents?: number }
): Promise<number> {
  if (!dbConfigured() || setups.length === 0) return 0;
  const today = todayEtYmd();
  const maxEvents = opts?.maxEvents ?? 24;

  return withDiscoveryEventCursorLock(async () => {
    const cursor = await readCursor(today);

    const ranked = [...setups]
      .sort((a, b) => {
        const wa =
          marketState && marketState.confidence > 0
            ? weightedScoreForMerge(a.score, a.discovery_origin, marketState)
            : a.score;
        const wb =
          marketState && marketState.confidence > 0
            ? weightedScoreForMerge(b.score, b.discovery_origin, marketState)
            : b.score;
        return wb - wa;
      })
      .slice(0, maxEvents);

    let written = 0;
    for (const s of ranked) {
      const id = objectId(today, s.ticker);
      const weighted =
        marketState && marketState.confidence > 0
          ? weightedScoreForMerge(s.score, s.discovery_origin, marketState)
          : null;
      const key = detectedStateKey(s.score, s.discovery_origin);
      if (!shouldWrite(cursor, id, key)) continue;
      await insertZeroDteDiscoveryEvent({
        session_date: today,
        ticker: s.ticker,
        kind: "detected",
        origins: [...s.discovery_origin],
        score: s.score,
        weighted_score: weighted,
        detail: s.gate?.verdict ?? null,
        payload: {
          contract_horizon: s.contract_horizon,
          direction: s.direction,
          play_type: s.play_type,
        },
      });
      written += 1;
    }
    if (written > 0) await writeCursor(today, cursor);
    return written;
  });
}

export async function persistDiscoveryGateBlockedEvents(
  rejections: readonly ZeroDteGateRejection[]
): Promise<number> {
  if (!dbConfigured() || rejections.length === 0) return 0;
  const today = todayEtYmd();

  return withDiscoveryEventCursorLock(async () => {
    const cursor = await readCursor(today);
    let written = 0;

    for (const r of rejections) {
      const id = objectId(today, r.ticker);
      const gate = r.gate_failed ?? "unknown";
      const key = gateBlockedStateKey(gate, r.direction ?? "long");
      if (!shouldWrite(cursor, id, key)) continue;
      await insertZeroDteDiscoveryEvent({
        session_date: today,
        ticker: r.ticker,
        kind: "gate_blocked",
        gate_code: gate,
        score: null,
        detail: r.reason ?? null,
        payload: {
          direction: r.direction,
          gross_premium: r.gross_premium,
          threshold: r.threshold,
        },
      });
      written += 1;
    }
    if (written > 0) await writeCursor(today, cursor);
    return written;
  });
}

export async function persistDiscoveryCommitEvents(
  committed: readonly EnrichedZeroDteSetup[]
): Promise<number> {
  if (!dbConfigured() || committed.length === 0) return 0;
  const today = todayEtYmd();

  return withDiscoveryEventCursorLock(async () => {
    const cursor = await readCursor(today);
    let written = 0;

    for (const s of committed) {
      const id = objectId(today, s.ticker);
      const key = commitStateKey();
      if (!shouldWrite(cursor, id, key)) continue;
      await insertZeroDteDiscoveryEvent({
        session_date: today,
        ticker: s.ticker,
        kind: "commit",
        origins: [...s.discovery_origin],
        score: s.score,
        gate_code: s.gate?.verdict ?? "COMMIT",
        detail: s.play_type,
        payload: {
          contract_horizon: s.contract_horizon,
          direction: s.direction,
          actual_dte_at_commit: s.actual_dte_at_commit,
        },
      });
      written += 1;
    }
    if (written > 0) await writeCursor(today, cursor);
    return written;
  });
}
