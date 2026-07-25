// 0DTE end-to-end latency telemetry + input-age manifest (Hardening WS-14/15).
//
// PURPOSE (observability ONLY — additive, never a decision input): the 0DTE scan is a
// multi-stage pipeline (tape → candidate derivation → chain quote → gates/Cortex →
// commit → board render). Nothing measured HOW LONG each stage took, or HOW STALE each
// input was AT THE INSTANT a play committed. When a live board is slow or a commit fires
// on aged data, there was no persisted evidence to root-cause it. This module records the
// span timestamps the scan already knows, the wall-clock scan duration, the per-session
// committed-row/ungradeable counters, and freezes a per-commit input-age manifest — so an
// admin can answer "how fresh was the data this play was decided on?" and "is the scan
// getting slower?" from data, not assertion.
//
// DESIGN — mirrors api-telemetry.ts: an in-process, per-replica ring buffer of samples
// with a shared `percentile()` helper (same nearest-rank convention), capped so it can
// never grow unbounded. Every recorder is best-effort and NEVER throws into the scan —
// a telemetry failure must not be able to affect what trades/grades. The pure functions
// (buildInputAgeManifest / spanStageDurations) take explicit timestamps so they unit-test
// with fixtures and carry no provider/singleton state.
//
// HONESTY CONTRACT: where an input's age or a span timestamp is genuinely unknown at the
// point of capture, it is stored as null — never fabricated. A null age is honest; a
// guessed one would poison the very observability this module exists to provide.

/** The named span timestamps along the 0DTE scan path, in epoch-ms. Each is nullable:
 *  a stage the caller could not timestamp (or a lane that did not run this cycle) is
 *  honestly null, never back-filled. `provider_event_at`/`ingested_at` come from the
 *  flow row when available (the tape print instant + when the scan ingested it). */
export type ZeroDteScanSpans = {
  scan_started_at: number | null;
  candidate_derived_at: number | null;
  chain_received_at: number | null;
  gates_completed_at: number | null;
  cortex_completed_at: number | null;
  committed_at: number | null;
  board_visible_at: number | null;
  provider_event_at?: number | null;
  ingested_at?: number | null;
};

/** Age (ms) at DECISION TIME of each input the commit decision used. Frozen onto
 *  entry_context.input_age_manifest at commit. Every key is always present; a genuinely
 *  unknown input's age is null (the timestamp was not available to the commit path),
 *  never a fabricated number. */
export type ZeroDteInputAgeManifest = {
  /** Freshest option-flow print behind the setup (its `last_seen`). */
  flow: number | null;
  /** Underlying price reference freshness (the name's own last minute bar). */
  underlying: number | null;
  /** Option-quote (mark) freshness — null unless a per-quote timestamp reached commit. */
  option_quote: number | null;
  /** Dealer-gamma / GEX read freshness (dossier asof) — null unless threaded to commit. */
  gex: number | null;
  /** VIX read freshness — null unless the VIX reading's reference instant reached commit. */
  vix: number | null;
  /** Macro-events read freshness — null unless threaded to commit. */
  macro: number | null;
  /** SPY session-bias read freshness — null unless the bias asof reached commit. */
  spy_bias: number | null;
};

/** Percentile summary of a sample set. Mirrors ApiEndpointStats's p95/p99 shape. */
export type ZeroDteLatencyStats = {
  count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

/** Nearest-rank percentile — byte-identical convention to api-telemetry.ts's helper so
 *  the two dashboards agree on what "p95" means. Empty sample set → 0. */
export function percentile(samples: number[], p: number): number {
  const finite = samples.filter((s) => Number.isFinite(s));
  if (!finite.length) return 0;
  const sorted = [...finite].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

/** p50/p95/p99 of a sample set (rounded to whole ms — data-layer rounding, per the
 *  repo's malformed-float rule). */
export function computeLatencyStats(samples: number[]): ZeroDteLatencyStats {
  const finite = samples.filter((s) => Number.isFinite(s));
  return {
    count: finite.length,
    p50_ms: Math.round(percentile(finite, 50)),
    p95_ms: Math.round(percentile(finite, 95)),
    p99_ms: Math.round(percentile(finite, 99)),
  };
}

/** PURE age-of-input computation. age = nowMs − inputMs, clamped to ≥0 (a slightly-future
 *  timestamp from clock skew reads as 0, never a negative age), rounded to whole ms. A
 *  null / non-finite input timestamp (or non-finite nowMs) yields null for that key — the
 *  "never fabricate an unknown" rule. Every manifest key is always present. */
export function buildInputAgeManifest(
  inputs: {
    flow_at?: number | null;
    underlying_at?: number | null;
    option_quote_at?: number | null;
    gex_at?: number | null;
    vix_at?: number | null;
    macro_at?: number | null;
    spy_bias_at?: number | null;
  },
  nowMs: number
): ZeroDteInputAgeManifest {
  const age = (at: number | null | undefined): number | null => {
    if (at == null || !Number.isFinite(at) || !Number.isFinite(nowMs)) return null;
    return Math.max(0, Math.round(nowMs - at));
  };
  return {
    flow: age(inputs.flow_at),
    underlying: age(inputs.underlying_at),
    option_quote: age(inputs.option_quote_at),
    gex: age(inputs.gex_at),
    vix: age(inputs.vix_at),
    macro: age(inputs.macro_at),
    spy_bias: age(inputs.spy_bias_at),
  };
}

/** PURE adjacent-stage durations (ms) from a spans record: how long each hop took. A hop
 *  whose either endpoint is null is null (unknowable), never negative. Also returns the
 *  end-to-end `total` (scan_started → board_visible, else → committed) when derivable. */
export function spanStageDurations(spans: ZeroDteScanSpans): {
  derive_ms: number | null;
  chain_ms: number | null;
  gates_ms: number | null;
  cortex_ms: number | null;
  commit_ms: number | null;
  visible_ms: number | null;
  total_ms: number | null;
} {
  const delta = (a: number | null | undefined, b: number | null | undefined): number | null => {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    const d = b - a;
    return d >= 0 ? Math.round(d) : null;
  };
  const end = spans.board_visible_at ?? spans.committed_at ?? null;
  return {
    derive_ms: delta(spans.scan_started_at, spans.candidate_derived_at),
    chain_ms: delta(spans.candidate_derived_at, spans.chain_received_at),
    gates_ms: delta(spans.chain_received_at, spans.gates_completed_at),
    cortex_ms: delta(spans.gates_completed_at, spans.cortex_completed_at),
    commit_ms: delta(spans.cortex_completed_at, spans.committed_at),
    visible_ms: delta(spans.committed_at, spans.board_visible_at),
    total_ms: delta(spans.scan_started_at, end),
  };
}

// ── In-process accumulators (per replica) ─────────────────────────────────────────────
// Same posture as api-telemetry.ts: bounded ring buffers, module singletons, reset only
// by the test hook. Never persisted (an observability layer, not a system of record).

/** Keep the last N samples per buffer — plenty for a session's percentiles, bounded so a
 *  long-lived replica can't leak memory (matches api-telemetry's MAX_SAMPLES posture). */
const MAX_SAMPLES = 500;

/** Wall-clock scan durations (ms) — one sample per completed scanZeroDteBoard pass. */
const scanDurationSamples: number[] = [];
/** End-to-end committed latency (ms), bucketed BY discovery origin (e.g. "FLOW",
 *  "BREAKOUT+FLOW"): provider event → commit, per committed row. */
const commitLatencyByOrigin = new Map<string, number[]>();
/** Per-hop scan-stage durations across passes (from spanStageDurations). */
const stageSamples: { derive: number[]; chain: number[]; gates: number[]; total: number[] } = {
  derive: [],
  chain: [],
  gates: [],
  total: [],
};
/** Per-session committed-row write counter + ungradeable count (WS-15). Keyed by session
 *  date; naturally bounded (a handful of dates per replica lifetime). */
const committedRowsByDate = new Map<string, number>();
const ungradeableByDate = new Map<string, number>();
/** WS-10 execution-tax distribution (bps): mid P&L − executable P&L per GRADED row. The
 *  cost the mid lane hid — a histogram beside the other calibration/grade metrics so the
 *  operator can see how big the executable-lane haircut actually is. Bounded like the rest. */
const executionTaxBpsSamples: number[] = [];

function pushCapped(buf: number[], v: number): void {
  if (!Number.isFinite(v) || v < 0) return;
  buf.push(v);
  if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
}

/** Canonical origin bucket key from a discovery-origin SET (["FLOW","BREAKOUT"] →
 *  "BREAKOUT+FLOW", sorted so ["A","B"] and ["B","A"] land in one bucket). Empty/unknown
 *  → "UNKNOWN" so a bucket is never silently dropped. */
export function originBucketKey(origins: readonly string[] | null | undefined): string {
  if (!origins || origins.length === 0) return "UNKNOWN";
  return [...origins].map((o) => String(o).toUpperCase()).sort().join("+");
}

/** Record one completed scan's stage spans (best-effort). */
export function recordScanSpans(spans: ZeroDteScanSpans): void {
  try {
    const d = spanStageDurations(spans);
    if (d.derive_ms != null) pushCapped(stageSamples.derive, d.derive_ms);
    if (d.chain_ms != null) pushCapped(stageSamples.chain, d.chain_ms);
    if (d.gates_ms != null) pushCapped(stageSamples.gates, d.gates_ms);
    if (d.total_ms != null) pushCapped(stageSamples.total, d.total_ms);
  } catch {
    /* observability must never throw into the scan */
  }
}

/** Record a scan's overall wall-clock (ms). Best-effort. */
export function recordScanDuration(ms: number): void {
  try {
    pushCapped(scanDurationSamples, ms);
  } catch {
    /* ignore */
  }
}

/** Record one committed row's end-to-end latency (ms), bucketed by discovery origin. */
export function recordCommitLatency(origins: readonly string[] | null | undefined, ms: number): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    const key = originBucketKey(origins);
    const buf = commitLatencyByOrigin.get(key) ?? [];
    pushCapped(buf, ms);
    commitLatencyByOrigin.set(key, buf);
  } catch {
    /* ignore */
  }
}

/** Add `n` committed rows to a session's write counter (WS-15). Best-effort. */
export function recordCommittedRows(sessionDate: string, n: number): void {
  try {
    if (!sessionDate || !Number.isFinite(n) || n <= 0) return;
    committedRowsByDate.set(sessionDate, (committedRowsByDate.get(sessionDate) ?? 0) + n);
  } catch {
    /* ignore */
  }
}

/** Increment a session's committed-ungradeable counter (WS-15). Called when the grader
 *  stamps a committed row "ungradeable". Best-effort. */
export function recordUngradeable(sessionDate: string): void {
  try {
    if (!sessionDate) return;
    ungradeableByDate.set(sessionDate, (ungradeableByDate.get(sessionDate) ?? 0) + 1);
  } catch {
    /* ignore */
  }
}

/** WS-10 — record one graded row's execution tax (bps = mid P&L − executable P&L). Called
 *  from the grade path once both lanes priced. Best-effort; a null/non-finite tax is skipped. */
export function recordExecutionTaxBps(bps: number | null): void {
  try {
    if (bps == null || !Number.isFinite(bps)) return;
    pushCapped(executionTaxBpsSamples, bps);
  } catch {
    /* ignore */
  }
}

export type ZeroDteLatencySnapshot = {
  /** Wall-clock scan duration percentiles (ms). */
  scan_duration: ZeroDteLatencyStats;
  /** Per-hop stage-duration percentiles (ms). */
  stages: {
    derive: ZeroDteLatencyStats;
    chain: ZeroDteLatencyStats;
    gates: ZeroDteLatencyStats;
    total: ZeroDteLatencyStats;
  };
  /** End-to-end committed latency percentiles (ms), one entry per discovery-origin bucket. */
  commit_latency_by_origin: Array<{ origin: string } & ZeroDteLatencyStats>;
  /** Per-session committed-row writes, ungradeable count, and rate (ungradeable/committed;
   *  null when nothing committed yet for the date — an honest "no data", never a fake 0%). */
  committed_by_session: Array<{
    session_date: string;
    committed_rows: number;
    ungradeable: number;
    ungradeable_rate: number | null;
  }>;
  /** WS-10 execution-tax percentiles (BPS: mid P&L − executable P&L) over graded rows —
   *  reuses the same nearest-rank percentile helper (fields are _ms by the shared type, but
   *  the unit here is bps; see recordExecutionTaxBps). */
  execution_tax_bps: ZeroDteLatencyStats;
};

/** Full snapshot for the admin health dashboard. Pure read over the accumulators. */
export function snapshotZeroDteLatency(): ZeroDteLatencySnapshot {
  const dates = new Set<string>([...committedRowsByDate.keys(), ...ungradeableByDate.keys()]);
  const committed_by_session = Array.from(dates)
    .sort()
    .map((session_date) => {
      const committed_rows = committedRowsByDate.get(session_date) ?? 0;
      const ungradeable = ungradeableByDate.get(session_date) ?? 0;
      return {
        session_date,
        committed_rows,
        ungradeable,
        ungradeable_rate: committed_rows > 0 ? Math.round((ungradeable / committed_rows) * 1000) / 1000 : null,
      };
    });
  return {
    scan_duration: computeLatencyStats(scanDurationSamples),
    stages: {
      derive: computeLatencyStats(stageSamples.derive),
      chain: computeLatencyStats(stageSamples.chain),
      gates: computeLatencyStats(stageSamples.gates),
      total: computeLatencyStats(stageSamples.total),
    },
    commit_latency_by_origin: Array.from(commitLatencyByOrigin.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([origin, samples]) => ({ origin, ...computeLatencyStats(samples) })),
    committed_by_session,
    execution_tax_bps: computeLatencyStats(executionTaxBpsSamples),
  };
}

/** Test-only: clear every accumulator between cases (mirrors the reset hooks other
 *  in-process singletons in this directory expose). */
export function _resetZeroDteLatencyForTest(): void {
  scanDurationSamples.length = 0;
  commitLatencyByOrigin.clear();
  stageSamples.derive.length = 0;
  stageSamples.chain.length = 0;
  stageSamples.gates.length = 0;
  stageSamples.total.length = 0;
  committedRowsByDate.clear();
  ungradeableByDate.clear();
  executionTaxBpsSamples.length = 0;
}
