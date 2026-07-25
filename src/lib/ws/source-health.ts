/**
 * WS-21 — data-source recovery health state machine + the (default-OFF) commit gate.
 *
 * A streaming data source (the UW multiplex WebSocket) can drop and reconnect. During the window
 * between "socket re-opened" and "we have provably re-caught-up to the provider", the in-memory
 * live view has a GAP: frames that arrived while we were disconnected were never seen. Committing a
 * new source-dependent trade off a source that is still mid-recovery risks trading on a stale/partial
 * picture. This module models the recovery lifecycle explicitly and exposes a pure gate that — ONLY
 * when explicitly enabled — withholds fresh commits until the source is HEALTHY again.
 *
 * Pure + alias-free (no @/ imports beyond the env read) so it is unit-testable under `tsx --test`.
 *
 * Lifecycle:
 *   OFFLINE      — no live socket (boot, or after a disconnect).
 *   RECOVERING   — a reconnect has been scheduled/attempted, socket not yet delivering.
 *   CATCHING_UP  — socket re-opened; reconciling the disconnect gap (REST backfill + dedupe).
 *   WARM         — gap reconciled; observing a short warm-up window of live frames before trusting.
 *   HEALTHY      — warmed with live delivery; the source authorizes new source-dependent commits.
 *
 * The gate is the ONLY behavior-changing consumer, and it is DEFAULT-OFF: `requireHealthy=false`
 * (the default, driven by ZERODTE_REQUIRE_HEALTHY_SOURCE≠"1") always authorizes, so live commit
 * behavior is byte-for-byte unchanged and the existing freshness thresholds still govern.
 * Graduation = set ZERODTE_REQUIRE_HEALTHY_SOURCE=1 (see docs/audit/FINDINGS.md).
 */

export type SourceHealthState = "OFFLINE" | "RECOVERING" | "CATCHING_UP" | "WARM" | "HEALTHY";

/** Ordered, low→high, so callers can compare "at least as healthy as". */
export const SOURCE_HEALTH_ORDER: readonly SourceHealthState[] = [
  "OFFLINE",
  "RECOVERING",
  "CATCHING_UP",
  "WARM",
  "HEALTHY",
] as const;

/**
 * Is the "only HEALTHY authorizes new source-dependent commits" gate turned ON?
 * DEFAULT-OFF: returns true ONLY for the exact literal "1". Any other value (unset, "0", "true",
 * "yes") is off, so a mis-set flag fails safe toward "unchanged behavior", never toward blocking.
 */
export function requireHealthySourceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZERODTE_REQUIRE_HEALTHY_SOURCE === "1";
}

/** A reconciliation outcome recorded when CATCHING_UP completes (null when the gate is OFF). */
export type SourceReconcileRecord = {
  at: number;
  /** Rows the reconnect gap backfill actually inserted (were not already seen). */
  backfilled: number;
  /** Rows the backfill skipped as already-seen duplicates. */
  duplicates: number;
  /** Start of the backfill window (last_confirmed_provider_ts − overlap_buffer). */
  window_start_ms: number;
};

export type SourceHealthSnapshot = {
  state: SourceHealthState;
  /** ms when the current state was entered. */
  since: number;
  /** Freshest provider event timestamp we have provably ingested (drives the backfill window). */
  last_confirmed_provider_ts: number | null;
  /** How many times the source has re-entered RECOVERING since process start. */
  reconnect_count: number;
  /** The most recent gap reconciliation (null until one runs, or when the gate is OFF). */
  last_reconcile: SourceReconcileRecord | null;
  /** Convenience: state === "HEALTHY". */
  healthy: boolean;
};

export interface SourceHealth {
  /** Socket dropped — reset to OFFLINE and clear the warm/catch-up progress. */
  onDisconnect(now?: number): void;
  /** A reconnect is being attempted — advance OFFLINE → RECOVERING (bumps reconnect_count). */
  onReconnecting(now?: number): void;
  /** Socket re-opened — begin the catch-up (reconciliation) phase. */
  onConnected(now?: number): void;
  /** Gap reconciliation finished — record it and advance CATCHING_UP → WARM. */
  completeCatchUp(now?: number, reconcile?: SourceReconcileRecord | null): void;
  /** A genuine live data frame arrived — drives WARM → HEALTHY once the warm window elapses. */
  recordLiveFrame(now?: number): void;
  /** Track the freshest provider event timestamp we've ingested (monotonic max). */
  recordConfirmedProviderTs(ts: number | null): void;
  snapshot(): SourceHealthSnapshot;
}

export function makeSourceHealth(opts?: { warmMs?: number }): SourceHealth {
  // Warm-up window: after the gap is reconciled we still watch a short window of live delivery
  // before declaring HEALTHY, so a socket that re-opens then immediately dies again never briefly
  // authorizes commits. 20s ≈ several RTH flow frames without being a long stall.
  const warmMs = opts?.warmMs ?? 20_000;

  let state: SourceHealthState = "OFFLINE";
  let since = Date.now();
  let lastConfirmedProviderTs: number | null = null;
  let reconnectCount = 0;
  let lastReconcile: SourceReconcileRecord | null = null;
  let catchUpDone = false;
  let warmSince: number | null = null;

  function enter(next: SourceHealthState, now: number): void {
    if (state === next) return;
    state = next;
    since = now;
  }

  return {
    onDisconnect(now = Date.now()): void {
      catchUpDone = false;
      warmSince = null;
      enter("OFFLINE", now);
    },
    onReconnecting(now = Date.now()): void {
      // Only count a genuine OFFLINE→RECOVERING edge; scheduleReconnect can fire repeatedly.
      if (state === "OFFLINE") {
        reconnectCount += 1;
        enter("RECOVERING", now);
      }
    },
    onConnected(now = Date.now()): void {
      catchUpDone = false;
      warmSince = null;
      enter("CATCHING_UP", now);
    },
    completeCatchUp(now = Date.now(), reconcile: SourceReconcileRecord | null = null): void {
      catchUpDone = true;
      if (reconcile) lastReconcile = reconcile;
      if (state === "CATCHING_UP") {
        warmSince = now;
        enter("WARM", now);
      }
    },
    recordLiveFrame(now = Date.now()): void {
      // A frame proves the socket is delivering. If we somehow observe a frame while still
      // OFFLINE/RECOVERING (delivery beat the lifecycle callback), treat it as connected.
      if (state === "OFFLINE" || state === "RECOVERING") {
        enter("CATCHING_UP", now);
      }
      if (state === "CATCHING_UP" && catchUpDone) {
        warmSince = now;
        enter("WARM", now);
      }
      if (state === "WARM" && warmSince != null && now - warmSince >= warmMs) {
        enter("HEALTHY", now);
      }
    },
    recordConfirmedProviderTs(ts: number | null): void {
      if (ts == null || !Number.isFinite(ts)) return;
      if (lastConfirmedProviderTs == null || ts > lastConfirmedProviderTs) {
        lastConfirmedProviderTs = ts;
      }
    },
    snapshot(): SourceHealthSnapshot {
      return {
        state,
        since,
        last_confirmed_provider_ts: lastConfirmedProviderTs,
        reconnect_count: reconnectCount,
        last_reconcile: lastReconcile,
        healthy: state === "HEALTHY",
      };
    },
  };
}

/**
 * The commit-authorization gate (WS-21). Pure. DEFAULT-OFF via `requireHealthy`.
 *
 * `requireHealthy === false` (the default, gate OFF): ALWAYS authorized — the existing freshness
 * thresholds still govern, so live behavior is byte-for-byte unchanged.
 *
 * `requireHealthy === true` (gate ON, graduated): authorized ONLY when the source is HEALTHY;
 * any recovery state (OFFLINE/RECOVERING/CATCHING_UP/WARM) withholds new source-dependent commits.
 */
export function commitAuthorizedBySourceHealth(input: {
  state: SourceHealthState;
  requireHealthy: boolean;
}): { authorized: boolean; reason: string | null } {
  if (!input.requireHealthy) return { authorized: true, reason: null };
  if (input.state === "HEALTHY") return { authorized: true, reason: null };
  return {
    authorized: false,
    reason:
      `Data source ${input.state} — new source-dependent commits are withheld until the ` +
      "reconnect gap is reconciled and the source warms back to HEALTHY.",
  };
}
