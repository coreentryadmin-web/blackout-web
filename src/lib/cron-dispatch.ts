import { NextRequest } from "next/server";

// Reuse the EXACT cron handlers — do NOT reimplement any warming/ingest logic here.
// Each cron route exports a `GET(req: NextRequest)` that gates on `isCronAuthorized(req)`
// (Bearer CRON_SECRET) and then runs its job. We invoke those handlers directly with a
// synthetic, server-side-authorized request so a trusted server caller (admin "Run now",
// or the staleness watchdog's self-heal) can warm a cron WITHOUT the CRON_SECRET ever
// leaving process.env.
import { GET as flowIngestGet } from "@/app/api/cron/flow-ingest/route";
import { GET as uwCacheRefreshGet } from "@/app/api/cron/uw-cache-refresh/route";
import { GET as heatmapWarmGet } from "@/app/api/cron/heatmap-warm/route";
import { GET as meridianWarmGet } from "@/app/api/cron/meridian-warm/route";
import { GET as deskWarmGet } from "@/app/api/cron/desk-warm/route";
import { GET as zerodteWarmGet } from "@/app/api/cron/zerodte-warm/route";
import { GET as spxEvaluateGet } from "@/app/api/cron/spx-evaluate/route";
import { GET as marketRegimeGet } from "@/app/api/cron/market-regime-detector/route";
import { GET as spxSignalGet } from "@/app/api/cron/spx-signal-observe/route";
import { GET as vectorUniverseSnapshotGet } from "@/app/api/cron/vector-universe-snapshot/route";
import { GET as vectorFullStateSnapshotGet } from "@/app/api/cron/vector-full-state-snapshot/route";
import { GET as vectorWallsWarmGet } from "@/app/api/cron/vector-walls-warm/route";
import { GET as vectorBeadRecordGet } from "@/app/api/cron/vector-bead-record/route";
import { GET as vectorDarkPoolWarmGet } from "@/app/api/cron/vector-dark-pool-warm/route";
import { GET as vectorPickSweepGet } from "@/app/api/cron/vector-pick-sweep/route";
import { GET as coachingAlertsGet } from "@/app/api/cron/coaching-alerts/route";
import { GET as bieFullStateSnapshotGet } from "@/app/api/cron/bie-full-state-snapshot/route";
import { GET as swingActiveRefreshGet } from "@/app/api/cron/swing-active-refresh/route";
import { GET as nighthawkEditionGet } from "@/app/api/cron/nighthawk-edition/route";

export type CronHandler = (req: NextRequest) => Promise<Response>;

/**
 * Dispatch table: cron id → { handler, force }. `force` adds `?force=1` so the
 * market-hours-gated warmers actually run when triggered off-window (the whole point of the
 * manual/self-heal stopgap). Keys mirror cron-registry.ts.
 *
 * SAFETY: only SAFE + IDEMPOTENT crons live here. Every handler is a cache pre-warm or an
 * append-only ingest tick — running it twice (or off its normal cadence) is harmless. We
 * deliberately exclude one-shot/destructive jobs (db-cleanup, outcome resolution, etc.) so the
 * watchdog's self-heal can never double-fire something with irreversible side effects. Night Hawk
 * edition is checkpoint-resume + fire-and-forget (safe to re-nudge when stuck).
 */
export const CRON_DISPATCH: Record<string, { handler: CronHandler; force: boolean }> = {
  "flow-ingest": { handler: flowIngestGet, force: false },
  "uw-cache-refresh": { handler: uwCacheRefreshGet, force: false },
  "heatmap-warm": { handler: heatmapWarmGet, force: true },
  "meridian-warm": { handler: meridianWarmGet, force: true },
  "desk-warm": { handler: deskWarmGet, force: true },
  "zerodte-warm": { handler: zerodteWarmGet, force: true },
  // RTH-critical crons — safe to re-trigger during an incident (idempotent read+evaluate)
  "spx-evaluate": { handler: spxEvaluateGet, force: false },
  "market-regime-detector": { handler: marketRegimeGet, force: false },
  "spx-signal-observe": { handler: spxSignalGet, force: false },
  // Vector live-data warmers — idempotent Redis snapshot/cache writers; self-heal must cover
  // these or RTH staleness on vector-universe-snapshot breaks the Vector scanner rail (#1333).
  "vector-universe-snapshot": { handler: vectorUniverseSnapshotGet, force: false },
  "vector-full-state-snapshot": { handler: vectorFullStateSnapshotGet, force: false },
  "vector-walls-warm": { handler: vectorWallsWarmGet, force: false },
  "vector-bead-record": { handler: vectorBeadRecordGet, force: false },
  "vector-dark-pool-warm": { handler: vectorDarkPoolWarmGet, force: true },
  // Vector pick universe sweep — idempotent Redis/Postgres writers for leaders + closures (#3066).
  // Self-heal covers the gap until blackout-infra syncs railway.vector-pick-sweep.toml to EventBridge.
  "vector-pick-sweep": { handler: vectorPickSweepGet, force: false },
  // RTH alert/snapshot writers — append-only or idempotent Redis/PG writes (#1343).
  "coaching-alerts": { handler: coachingAlertsGet, force: true },
  "bie-full-state-snapshot": { handler: bieFullStateSnapshotGet, force: true },
  // Swing mark-and-review — idempotent append-only snapshots + manage-sync; self-heal must cover
  // RTH staleness on swing-active-refresh (#1364).
  "swing-active-refresh": { handler: swingActiveRefreshGet, force: true },
  // Night Hawk evening edition — checkpoint-resume fire-and-forget; safe to re-nudge when stuck
  // during the edition window (ops-auto-fix #1572: stage_synthesis checkpoint with no publish).
  "nighthawk-playbook": { handler: nighthawkEditionGet, force: true },
};

export const DISPATCHABLE_CRONS = Object.keys(CRON_DISPATCH);

/** True if `key` is a safe, idempotent cron the dispatcher can (re)run. */
export function isDispatchableCron(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CRON_DISPATCH, key);
}

export type CronDispatchResult = {
  ok: boolean;
  name: string;
  ranAt: string;
  durationMs: number;
  status: number;
  result?: unknown;
  error?: string;
  detail?: string;
};

/**
 * Invoke a safe/idempotent cron handler server-side with a synthetic Bearer-authorized request
 * (and `?force=1` for the market-hours-gated warmers, so it runs even off-window). Never throws —
 * on any failure it returns `ok:false` with a status + detail. The CRON_SECRET is attached here
 * and never returned to callers/clients.
 */
export async function dispatchCronWarm(key: string): Promise<CronDispatchResult> {
  const started = Date.now();
  const entry = CRON_DISPATCH[key];
  if (!entry) {
    return {
      ok: false,
      name: key,
      ranAt: new Date(started).toISOString(),
      durationMs: 0,
      status: 400,
      error: `Unknown or non-dispatchable cron '${key}'`,
    };
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      name: key,
      ranAt: new Date(started).toISOString(),
      durationMs: 0,
      status: 503,
      error: "CRON_SECRET not configured on this deployment",
    };
  }

  // Build a synthetic, authorized cron request: same Bearer auth + (for the warmers) ?force=1
  // so the handler runs identically to a real cron fire. The host is arbitrary; the
  // cron handlers only read the Authorization header and the `force` query param.
  const url = entry.force
    ? `https://internal.local/api/cron/${key}?force=1`
    : `https://internal.local/api/cron/${key}`;
  const cronReq = new NextRequest(url, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });

  try {
    const res = await entry.handler(cronReq);
    const durationMs = Date.now() - started;

    let result: unknown = null;
    try {
      result = await res.clone().json();
    } catch {
      result = await res.clone().text();
    }

    return {
      ok: res.ok,
      name: key,
      ranAt: new Date(started).toISOString(),
      durationMs,
      status: res.status,
      result,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: key,
      ranAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      status: 500,
      error: "Cron run failed",
      detail,
    };
  }
}
