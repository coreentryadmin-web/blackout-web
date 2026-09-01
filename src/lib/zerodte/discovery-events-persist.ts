/**
 * Best-effort persistence for zerodte_discovery_events (Phase 2a).
 *
 * Throttled like rejections.ts — one row per ticker per DISTINCT state transition,
 * not one row per ~2min scan cycle. Scan/persist never blocks on a write failure.
 */
import { dbConfigured, getMeta, setMeta, insertZeroDteDiscoveryEvent } from "@/lib/db";
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

/** Top post-gate candidates — default cap 24 (FLOW 48 + rails, throttled per ticker). */
export async function persistDiscoveryDetectedEvents(
  setups: readonly EnrichedZeroDteSetup[],
  marketState: MarketStateSnapshot | null,
  opts?: { maxEvents?: number }
): Promise<number> {
  if (!dbConfigured() || setups.length === 0) return 0;
  const today = todayEtYmd();
  const cursor = await readCursor(today);
  const maxEvents = opts?.maxEvents ?? 24;

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
}

export async function persistDiscoveryGateBlockedEvents(
  rejections: readonly ZeroDteGateRejection[]
): Promise<number> {
  if (!dbConfigured() || rejections.length === 0) return 0;
  const today = todayEtYmd();
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
}

export async function persistDiscoveryCommitEvents(
  committed: readonly EnrichedZeroDteSetup[]
): Promise<number> {
  if (!dbConfigured() || committed.length === 0) return 0;
  const today = todayEtYmd();
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
}
