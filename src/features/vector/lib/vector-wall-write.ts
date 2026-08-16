import "server-only";

import { isEtCashRth } from "@/lib/et-market-hours";
import { appendSessionWallSample } from "./vector-wall-persist";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import type { WallHistorySample } from "./vector-wall-history";

/** Which durable writer stamped a bucket — every path must tag itself for attribution. */
export type WallWriteSource =
  | "bead-recorder-universe"
  | "bead-recorder-active"
  | "cron-universe-snapshot"
  | "sse-hub"
  | "dynamic-ticker-warm"
  | "walls-warm";

export type WallWriteSkipReason =
  | "outside_rth"
  | "empty_session"
  | "append_noop"
  | "append_failed";

export type WallWriteResult = {
  written: boolean;
  skipped?: WallWriteSkipReason;
};

export type WallWriteObservabilitySnapshot = {
  totals: Record<string, number>;
  lastSuccessAt: Record<string, number>;
  consecutiveFailures: Record<string, number>;
  darkTickers: string[];
};

const writeTotals = new Map<string, number>();
const lastSuccessAt = new Map<string, number>();
const consecutiveFailures = new Map<string, number>();

const DARK_THRESHOLD = 3;

function obsKey(source: WallWriteSource, ticker: string, horizon: VectorDteHorizon): string {
  return `${source}:${ticker}:${horizon}`;
}

function bumpTotal(source: WallWriteSource, outcome: "written" | WallWriteSkipReason): void {
  const k = `${source}:${outcome}`;
  writeTotals.set(k, (writeTotals.get(k) ?? 0) + 1);
}

function noteSuccess(source: WallWriteSource, ticker: string, horizon: VectorDteHorizon, bucket: number): void {
  const k = obsKey(source, ticker, horizon);
  lastSuccessAt.set(k, bucket);
  consecutiveFailures.delete(ticker);
}

function noteFailure(source: WallWriteSource, ticker: string, reason: WallWriteSkipReason): void {
  bumpTotal(source, reason);
  const streak = (consecutiveFailures.get(ticker) ?? 0) + 1;
  consecutiveFailures.set(ticker, streak);
  if (streak === DARK_THRESHOLD) {
    console.warn(
      `[vector-wall-write] DARK ${ticker} — ${streak} consecutive failed writes (source=${source}, reason=${reason})`
    );
  }
}

/** Test-only reset — suites must not leak counters across cases. */
export function _resetWallWriteObservabilityForTest(): void {
  writeTotals.clear();
  lastSuccessAt.clear();
  consecutiveFailures.clear();
}

/** In-process write attribution — surfaced on admin health (no Redis round-trip). */
export function getWallWriteObservabilitySnapshot(): WallWriteObservabilitySnapshot {
  const totals: Record<string, number> = {};
  for (const [k, v] of writeTotals) totals[k] = v;

  const last: Record<string, number> = {};
  for (const [k, v] of lastSuccessAt) last[k] = v;

  const streaks: Record<string, number> = {};
  const darkTickers: string[] = [];
  for (const [ticker, streak] of consecutiveFailures) {
    streaks[ticker] = streak;
    if (streak >= DARK_THRESHOLD) darkTickers.push(ticker);
  }

  return {
    totals,
    lastSuccessAt: last,
    consecutiveFailures: streaks,
    darkTickers: darkTickers.sort(),
  };
}

/**
 * Canonical durable wall-history write — every Redis/Postgres sample lands here.
 * Observability-first: source tag, structured skip reasons, per-ticker dark detection.
 */
export async function writeWallHistorySample(opts: {
  source: WallWriteSource;
  sessionYmd: string;
  ticker: string;
  sample: WallHistorySample;
  horizon?: VectorDteHorizon;
  /** Default true — cash RTH only. Callers that already gated may pass false. */
  rthRequired?: boolean;
}): Promise<WallWriteResult> {
  const { source, sessionYmd, ticker, sample, horizon = "all", rthRequired = true } = opts;

  if (!sessionYmd) {
    noteFailure(source, ticker, "empty_session");
    return { written: false, skipped: "empty_session" };
  }

  if (rthRequired && !isEtCashRth()) {
    bumpTotal(source, "outside_rth");
    return { written: false, skipped: "outside_rth" };
  }

  const ok = await appendSessionWallSample(sessionYmd, sample, ticker, horizon);
  if (!ok) {
    noteFailure(source, ticker, "append_noop");
    return { written: false, skipped: "append_noop" };
  }

  bumpTotal(source, "written");
  noteSuccess(source, ticker, horizon, sample.time);
  return { written: true };
}

/**
 * Debounced Redis persist — one write per bucket per (ticker, horizon) per replica.
 * SSE hub calls this after the in-process RTH gate; observability source = sse-hub.
 */
const lastPersistByTicker = new Map<string, { bucket: number; at: number }>();

export function persistWallSampleDebounced(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): void {
  if (!sessionYmd) return;
  const now = Date.now();
  const bucket = sample.time;
  const key = horizon === "all" ? ticker : `${ticker}::${horizon}`;
  const last = lastPersistByTicker.get(key);
  if (last && last.bucket === bucket && now - last.at < 2_000) return;
  lastPersistByTicker.set(key, { bucket, at: now });
  void writeWallHistorySample({
    source: "sse-hub",
    sessionYmd,
    ticker,
    sample,
    horizon,
    rthRequired: false,
  });
}

/** Test-only reset. */
export function _resetWallPersistDebounceForTest(): void {
  lastPersistByTicker.clear();
}
