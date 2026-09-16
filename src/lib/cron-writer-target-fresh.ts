import { signalWindowAgeMs } from "@/features/helix/lib/helix-signal-detection";

/** REST flow-ingest skip reasons that mean an alternate live writer path is active. */
export const FLOW_INGEST_ALT_SKIP_REASONS = new Set(["ws_active", "ws_active_cluster", "bot_primary"]);

export function isFlowIngestAlternateWriterSkip(message: string | null | undefined): boolean {
  return FLOW_INGEST_ALT_SKIP_REASONS.has(String(message ?? "").trim());
}

export type WriterTargetProbe = { fresh: boolean; detail: string };

/** PG downstream target for flow-ingest — true when flow_alerts landed within `maxAgeMin`. */
export async function probePgFlowAlertsFresh(
  maxAgeMin = 20
): Promise<{ fresh: boolean; ageMin: number | null }> {
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return { fresh: false, ageMin: null };
  try {
    const res = await dbQuery<{ latest_ms: string | null }>(
      `SELECT (EXTRACT(EPOCH FROM MAX(COALESCE(created_at, inserted_at))) * 1000)::bigint AS latest_ms
       FROM flow_alerts`
    );
    const ms = res.rows[0]?.latest_ms != null ? Number(res.rows[0].latest_ms) : NaN;
    if (!Number.isFinite(ms)) return { fresh: false, ageMin: null };
    // signalWindowAgeMs rejects a future-dated row (clock skew / bad write) instead of letting
    // a negative age trivially pass `<= maxAgeMin` — this probe's `fresh: true` result overrides a
    // genuinely stale cron job to "healthy" on the admin dashboard (admin-cron-health.ts), so a
    // corrupted future timestamp would mask a real dead-writer incident, not just misreport an age.
    const ageMs = signalWindowAgeMs(ms, Date.now());
    const ageMin = ageMs != null ? ageMs / 60_000 : null;
    return { fresh: ageMin != null && ageMin <= maxAgeMin, ageMin };
  } catch {
    return { fresh: false, ageMin: null };
  }
}

/** Same future-dated-timestamp guard as probePgFlowAlertsFresh, shared across every `fresh =
 *  ageMin != null && ageMin <= N` check below — exported for a direct unit test. */
export function ageMinFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const ageMs = signalWindowAgeMs(ms, now);
  return ageMs != null ? ageMs / 60_000 : null;
}

async function uwCacheRemainingTtlSec(logicalKey: string): Promise<number | null> {
  const { getUwCacheRedis } = await import("@/lib/providers/uw-shared-cache");
  const redis = await getUwCacheRedis();
  if (!redis) return null;
  try {
    const client = redis as { ttl?: (key: string) => Promise<number> };
    if (typeof client.ttl !== "function") return null;
    const ttl = await client.ttl(`uw_cache:${logicalKey}`);
    return Number.isFinite(ttl) ? ttl : null;
  } catch {
    return null;
  }
}

/**
 * True when the writer's authoritative target (PG/Redis) is fresh during RTH, even if the
 * cron handshake row is old. Returns null when the job has no probe (caller keeps verdict).
 */
export async function probeWriterTargetFresh(jobKey: string): Promise<WriterTargetProbe | null> {
  switch (jobKey) {
    case "flow-ingest": {
      const pg = await probePgFlowAlertsFresh(20);
      if (pg.fresh) {
        return {
          fresh: true,
          detail: `flow_alerts latest row ${pg.ageMin != null ? `${pg.ageMin.toFixed(1)}m` : "?"} ago`,
        };
      }
      const { isFlowFrameFreshAnywhere } = await import("@/lib/flow-liveness");
      const fresh = await isFlowFrameFreshAnywhere(120_000);
      return {
        fresh,
        detail: fresh
          ? "cluster UW flow WS heartbeat fresh (REST cron intentionally idle)"
          : `no recent PG flow_alerts row${pg.ageMin != null ? ` (${pg.ageMin.toFixed(0)}m old)` : ""} or cluster WS heartbeat`,
      };
    }
    case "heatmap-warm": {
      const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
      let pos: Awaited<ReturnType<typeof getGexPositioning>> = null;
      try {
        pos = await getGexPositioning("SPX");
      } catch {
        pos = null;
      }
      if (!pos) return { fresh: false, detail: "gex-heatmap:SPX cache cold" };
      const ageMin = ageMinFromIso(pos.asof);
      const fresh = ageMin != null && ageMin <= 15;
      return {
        fresh,
        detail: `gex-heatmap:SPX asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
      };
    }
    case "desk-warm": {
      const { loadSpxDesk } = await import("@/features/spx/lib/spx-desk-loader");
      try {
        const desk = await loadSpxDesk();
        const ageMin = ageMinFromIso(desk.polled_at ?? desk.as_of);
        const fresh = ageMin != null && ageMin <= 2;
        return {
          fresh,
          detail: `spx-desk asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
        };
      } catch {
        return { fresh: false, detail: "spx-desk cache cold" };
      }
    }
    case "zerodte-warm": {
      // Was: probe the Analyst Actions panel cache key (pre-2026-07-07 classic Grid), then the
      // 0DTE earnings-match cache key after the rename. BOTH are wrong proxies
      // for the same reason: they reflect the route's FAST synchronous sub-task (warmGridEarnings,
      // awaited before the 202 response), which keeps succeeding even when the route's HEAVY
      // background chain (warmZeroDteBoard -> scanZeroDteBoard -> persistZeroDteScan ->
      // discovery-events, dispatched fire-and-forget) silently stalls for tens of minutes —
      // exactly the failure this override exists to catch. Measured live 2026-09-16: the earnings
      // cache stayed fresh throughout a real ~35min scanner stall, so this probe would have
      // reported "target fresh" and suppressed the stale flag the whole time. Probe the scanner's
      // OWN heartbeat instead (recordZeroDteScanTick, ticked only after scanZeroDteBoard()
      // actually returns inside warmZeroDteBoard) — the same signal admin-cron-health.ts's
      // zerodte-warm cross-check now reads directly, so this override can no longer contradict it.
      const { loadZeroDteScanHeartbeat } = await import("@/lib/play-engine-heartbeat");
      const hb = await loadZeroDteScanHeartbeat();
      if (!hb.last_tick_at) return { fresh: false, detail: "zerodte-scan heartbeat never ticked" };
      const ageMin = hb.age_ms != null ? hb.age_ms / 60_000 : null;
      const fresh = !hb.stale && !hb.critical_stale;
      return {
        fresh,
        detail: `zerodte-scan tick ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
      };
    }
    case "uw-cache-refresh": {
      const { UW_KEYS } = await import("@/lib/providers/uw-shared-cache");
      const key = UW_KEYS.marketTide();
      const ttl = await uwCacheRemainingTtlSec(key);
      if (ttl == null) return null;
      const fresh = ttl > 0;
      return {
        fresh,
        detail: fresh ? `uw_cache:${key} ttl ${ttl}s remaining` : `uw_cache:${key} expired/missing`,
      };
    }
    case "vector-walls-warm": {
      const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
      let pos: Awaited<ReturnType<typeof getGexPositioning>> = null;
      try {
        pos = await getGexPositioning("SPY");
      } catch {
        pos = null;
      }
      if (!pos) return { fresh: false, detail: "gex-positioning:SPY cache cold" };
      const ageMin = ageMinFromIso(pos.asof);
      const fresh = ageMin != null && ageMin <= 2;
      return {
        fresh,
        detail: `gex-positioning:SPY asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
      };
    }
    case "vector-bead-record": {
      const { formatEtDate } = await import("@/features/nighthawk/lib/session");
      const { loadSessionWallHistory } = await import("@/features/vector/lib/vector-wall-persist");
      const sessionYmd = formatEtDate(new Date());
      const history = await loadSessionWallHistory(sessionYmd, "SPY", "all");
      if (!history.length) {
        return { fresh: false, detail: "SPY wall-history rail empty today" };
      }
      const tail = history[history.length - 1];
      const tailAgeMs =
        tail?.time != null && Number.isFinite(tail.time)
          ? signalWindowAgeMs(tail.time * 1000, Date.now())
          : null;
      const ageSec = tailAgeMs != null ? tailAgeMs / 1000 : null;
      const fresh = ageSec != null && ageSec <= 30;
      return {
        fresh,
        detail: `SPY wall-history tail ${ageSec != null ? `${Math.round(ageSec)}s` : "?"} ago (${history.length} samples)`,
      };
    }
  }
  return null;
}
