import { CRON_JOBS, type CronJobDefinition } from "@/lib/cron-registry";
import {
  dbConfigured,
  fetchCronJobLastRuns,
  fetchCronJobRunCount,
  fetchCronJobRunsLast24h,
  fetchLatestNighthawkJob,
  type CronJobRunRow,
} from "@/lib/db";
import { loadPlayEngineHeartbeat, loadZeroDteScanHeartbeat } from "@/lib/play-engine-heartbeat";
import {
  formatEtDate,
  isTradingDayEt,
  nextTradingDayEt,
} from "@/features/nighthawk/lib/session";
import { isInEditionWindow } from "@/features/nighthawk/lib/edition-stale";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { isEtCashRth } from "@/lib/et-market-hours";
import {
  isFlowIngestAlternateWriterSkip,
} from "@/lib/cron-writer-target-fresh";
import { isInOffScheduleIdleGap, isAwaitingSecondaryUtcBandFire } from "@/lib/cron-schedule-window";
import { swingDiscoveryHandshakeStaleMin } from "@/lib/swing/discovery-cron-health";
import { xMarketingCronPaused } from "@/lib/x-marketing-env";
import { isoAgeSec } from "@/components/admin/admin-time-ago";
import { ageMinFromIso } from "@/lib/ws/timestamp-freshness";
import { sharedCacheGet, sharedCacheGetWithTtl } from "@/lib/shared-cache";
import {
  SWING_DISCOVERY_SCAN_MAX_MS,
  SWING_FORCE_CLEAR_RUNNING_BUFFER_MS,
  type SwingDiscoveryPhaseClaim,
} from "@/lib/swing/discovery-claim";
import { phaseRunKey } from "@/lib/swing/scan-cadence";
import type { SwingDiscoveryPhase } from "@/lib/swing/discovery";
import { todayEt } from "@/lib/et-date";

const SWING_DISCOVERY_PHASES: readonly SwingDiscoveryPhase[] = [
  "POST_CLOSE",
  "PRE_OPEN",
  "MIDDAY",
  "POWER_HOUR",
  "OVERNIGHT",
];

async function isSwingDiscoveryScanInFlight(now = new Date()): Promise<boolean> {
  const sessionDay = todayEt(now);
  const nowMs = now.getTime();
  for (const phase of SWING_DISCOVERY_PHASES) {
    const key = phaseRunKey(sessionDay, phase);
    const entry = await sharedCacheGetWithTtl<SwingDiscoveryPhaseClaim>(key).catch(() => null);
    if (!entry?.value || entry.value.status !== "running" || entry.remainingTtlSec <= 0) continue;
    const ageMs = nowMs - (Number.isFinite(entry.value.at) ? entry.value.at : 0);
    if (ageMs < SWING_DISCOVERY_SCAN_MAX_MS + SWING_FORCE_CLEAR_RUNNING_BUFFER_MS) return true;
  }
  return false;
}

/** Crons gated by `isSpxEngineCronWindow` (7:00–16:15 ET weekdays) vs `isEtCashRth` (9:30–close). */
function isSpxEngineGatedCronKey(key: string): boolean {
  return (
    key === "spx-evaluate" ||
    key === "spx-issues-sync" ||
    key === "data-correctness" ||
    key === "data-integrity" ||
    key === "market-regime-detector" ||
    key === "provider-health-reconcile" ||
    key === "spx-signal-observe"
  );
}

/**
 * "In session" for `market_hours_only` staleness — must match each route's own skip gate.
 * SPX engine crons use isSpxEngineCronWindow (premarket + post-close tail); everything else
 * uses cash RTH only. Without this, 7:00–9:30 AM and 4:00–4:15 PM ET look "in RTH" to
 * isEtCashRth=false while the cron is still firing real work — then a 25m cron handshake gap
 * false-trips stale (measured: query CI 2026-11-06 on early-close Friday vs fresh engine HB).
 */
export function marketHoursCronInSession(job: CronJobDefinition, now = new Date()): boolean {
  if (!job.market_hours_only) return true;
  return isSpxEngineGatedCronKey(job.key) ? isSpxEngineCronWindow(now) : isEtCashRth(now);
}

/** True when a `market_hours_only` job is outside the session gate its route uses (RTH vs SPX engine window). */
function marketHoursCronOffWindow(job: CronJobDefinition, now: Date): boolean {
  return Boolean(job.market_hours_only) && !marketHoursCronInSession(job, now);
}

/** Night Hawk playbook job age — clock-skewed future timestamps exceed stuck threshold. */
export function nighthawkJobAgeMin(
  updatedAt: string | null | undefined,
  stuckThresholdMin: number,
  now = Date.now()
): number | null {
  if (!updatedAt) return null;
  const age = isoAgeSec(updatedAt, now);
  if (age.kind === "ok") return Math.round(age.sec / 60);
  if (age.kind === "clock-skew") return stuckThresholdMin + 1;
  return null;
}

function positiveEnvInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function etMinuteOfDay(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * `nighthawk-backfill-repair` fires on dual UTC bands (13:00 + 14:00 UTC) for 9:00 AM ET in both
 * DST regimes. In EST the 13:00 band lands at 8:00 AM ET — before the route's own 9:00 AM ET
 * window — and logs an expected skip. Scheduled CI (`query` / cron-audit) often runs in that
 * gap (~8:59 AM ET) and the watchdog used to read yesterday's `failed` or a never-run `stale`
 * as a live P0. Suppress until the repair window actually opens on a trading day.
 */
export function nighthawkBackfillRepairPreWindow(now = new Date()): boolean {
  const today = formatEtDate(now);
  if (!isTradingDayEt(today)) return false;
  const targetHour = positiveEnvInt("NIGHTHAWK_BACKFILL_REPAIR_HOUR_ET", 9);
  const targetMinute = positiveEnvInt("NIGHTHAWK_BACKFILL_REPAIR_MINUTE_ET", 0);
  const catchupMin = positiveEnvInt("NIGHTHAWK_BACKFILL_REPAIR_CATCHUP_MIN", 90);
  if (
    inEtWindow(
      { targetHour, targetMinute, catchupMin: catchupMin, weekdaysOnly: true },
      now
    )
  ) {
    return false;
  }
  return etMinuteOfDay(now) < targetHour * 60 + targetMinute;
}

export type NighthawkEditionExpectation = {
  et_date: string;
  expected_edition_for: string;
  after_deadline: boolean;
  deadline_label: string;
};

/**
 * Night Hawk publishes a dossier for the next trading session during the prior evening window.
 * A published edition for today's session is therefore healthy all day; only after the evening
 * catch-up deadline should health require the next session's edition.
 */
export function expectedNighthawkEdition(now = new Date()): NighthawkEditionExpectation {
  const etDate = formatEtDate(now);
  const targetHour = positiveEnvInt("NIGHTHAWK_EDITION_HOUR_ET", 17);
  const targetMinute = positiveEnvInt("NIGHTHAWK_EDITION_MINUTE_ET", 30);
  const catchupMin = positiveEnvInt("NIGHTHAWK_EDITION_CATCHUP_MIN", 120);
  const deadlineMin = targetHour * 60 + targetMinute + catchupMin;
  const afterDeadline = isTradingDayEt(etDate) && etMinuteOfDay(now) > deadlineMin;
  const expectedEditionFor = afterDeadline
    ? nextTradingDayEt(etDate)
    : isTradingDayEt(etDate)
      ? etDate
      : nextTradingDayEt(etDate);
  const deadlineHour = Math.floor(deadlineMin / 60);
  const deadlineMinute = deadlineMin % 60;

  return {
    et_date: etDate,
    expected_edition_for: expectedEditionFor,
    after_deadline: afterDeadline,
    deadline_label: `${String(deadlineHour).padStart(2, "0")}:${String(deadlineMinute).padStart(2, "0")} ET`,
  };
}

export function nighthawkEditionCoversExpected(
  editionFor: string,
  expectation = expectedNighthawkEdition()
): boolean {
  return editionFor >= expectation.expected_edition_for;
}

export type CronJobHealthStatus = "healthy" | "warning" | "stale" | "failed" | "unknown";

export type CronJobHealth = {
  key: string;
  name: string;
  kind: CronJobDefinition["kind"];
  path: string | null;
  schedule_label: string;
  description: string;
  status: CronJobHealthStatus;
  status_label: string;
  /**
   * True when this is a `market_hours_only` job that is STALE *right now during RTH* — i.e. the
   * silent-death #90 case (a live-data warmer that should be ticking but isn't). This is the
   * loud, never-invisible signal: the watchdog self-heals/alerts on it and the admin UI paints it
   * red. Off-window staleness is already suppressed upstream, so this is only ever set in-window.
   */
  market_hours_stale: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_message: string | null;
  age_min: number | null;
  stale_after_min: number;
  effective_stale_min: number;
  stale_multiplier: number;
  runs_24h: { ok: number; failed: number; skipped: number };
  meta?: Record<string, unknown>;
};

export type CronHealthPayload = {
  generated_at: string;
  cron_secret_configured: boolean;
  db_configured: boolean;
  /** Set when Postgres snapshot queries fail — route stays 200 so ops-collect does not false-P0 on a blip. */
  db_snapshot_error?: string | null;
  logged_runs_total: number;
  diagnostics_note: string | null;
  summary: {
    total: number;
    healthy: number;
    warning: number;
    stale: number;
    failed: number;
    unknown: number;
    /** Count of market-hours jobs that are stale RIGHT NOW during RTH (the #90 blind spot). */
    market_hours_stale: number;
  };
  jobs: CronJobHealth[];
  recent_events: Array<{
    job_key: string;
    job_name: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
    message: string | null;
  }>;
};

/** Stale ceiling multiplier when a job is off its schedule window.
 * Uses isTradingDayEt (not isWeekdayEt) so NYSE holidays get the same relaxed
 * thresholds as weekends — weekday-only crons gate/skipped on holidays (#4520). */
export function effectiveStaleMinutes(
  job: CronJobDefinition,
  now: Date = new Date()
): { effective: number; multiplier: number } {
  const etDate = formatEtDate(now);
  const tradingDay = isTradingDayEt(etDate);
  if (job.weekdays_only && !tradingDay) {
    return { effective: job.stale_after_min * 2.5, multiplier: 2.5 };
  }
  if (job.market_hours_only && !tradingDay) {
    return { effective: job.stale_after_min * 6, multiplier: 6 };
  }
  if (job.key === "swing-discovery") {
    return { effective: swingDiscoveryHandshakeStaleMin(), multiplier: 1 };
  }
  return { effective: job.stale_after_min, multiplier: 1 };
}

/** Phase-idempotent swing-discovery can log a trailing failed handshake after an ok POST_CLOSE in the same 24h. */
function swingDiscoveryRecentOkWithin(
  runs24h: CronJobRunRow[],
  staleThreshold: number,
  now: Date
): number | null {
  let bestAge: number | null = null;
  for (const r of runs24h) {
    if (r.status !== "ok") continue;
    const age = ageMinFromIso(r.started_at, now.getTime());
    if (age == null || age > staleThreshold) continue;
    if (bestAge == null || age < bestAge) bestAge = age;
  }
  return bestAge;
}

/**
 * Exported for the unit test, and taking an injectable `now` for the same reason: every branch here
 * turns on where the clock is relative to the market session, so a test that used the real clock
 * would assert one thing during RTH and the opposite overnight — a date bomb inside the very check
 * that exists to catch jobs going dark.
 */
export function evaluateJob(
  job: CronJobDefinition,
  last: CronJobRunRow | undefined,
  runs24h: CronJobRunRow[],
  now: Date = new Date()
): CronJobHealth {
  const counts = { ok: 0, failed: 0, skipped: 0 };
  for (const r of runs24h) {
    if (r.status === "ok") counts.ok += 1;
    else if (r.status === "failed") counts.failed += 1;
    else if (r.status === "skipped") counts.skipped += 1;
  }

  if (!last) {
    const { effective: effMin, multiplier: effMult } = effectiveStaleMinutes(job, now);

    // A JOB THAT HAS NEVER RUN IS THE DEADEST A JOB CAN BE — IT MUST NOT REPORT AS "unknown".
    //
    // This branch used to return `status: "unknown"` unconditionally and skip the staleness
    // evaluation below entirely, which meant the board's own worst case was the one case it could
    // not see. On 2026-08-19 that was live: `helix-signal-outcomes` and `largo-morning-brief` were
    // both missing from `cron-jobs.json` in blackout-infra and had therefore NEVER been invoked in
    // production — the brief endpoint was serving `available: false, staleDate: 2026-06-29`, 51 days
    // cold — while this board showed them as `unknown` and the summary reported
    // `stale: 0, failed: 0, market_hours_stale: 0`. Read at a glance, that is green.
    //
    // "No run has ever been logged" is strictly WORSE evidence than "the last run was a while ago",
    // so it gets at least the same severity: past its window it is `stale`, and a market-hours job
    // stale during RTH still trips `market_hours_stale` — the #90 silent-death flag — exactly as it
    // would with a stale-but-present run row.
    //
    // `unknown` survives for the one case where staleness genuinely cannot be judged yet: the job is
    // off-window or inside an off-schedule idle gap, so it is not DUE to have run. Suppressing there
    // matches the treatment a logged run gets below and keeps the board from crying wolf overnight,
    // which is the reason the off-window suppression exists at all.
    const offWindowNoRun = marketHoursCronOffWindow(job, now);
    const offScheduleNoRun =
      Boolean(job.schedule_cron_utc) && isInOffScheduleIdleGap(job.schedule_cron_utc!, now);
    const awaitingDualBand =
      Boolean(job.schedule_cron_utc) && isAwaitingSecondaryUtcBandFire(job.schedule_cron_utc!, now);
    const notDueYet = offWindowNoRun || offScheduleNoRun || awaitingDualBand;

    return {
      key: job.key,
      name: job.name,
      kind: job.kind,
      path: job.path ?? null,
      schedule_label: job.schedule_label,
      description: job.description,
      status: notDueYet ? "unknown" : "stale",
      status_label: notDueYet
        ? "No runs logged (not due — outside its window)"
        : "NEVER logged a run — job may not be scheduled at all",
      market_hours_stale: Boolean(job.market_hours_only) && !offWindowNoRun,
      last_run_at: null,
      last_status: null,
      last_duration_ms: null,
      last_message: null,
      age_min: null,
      stale_after_min: job.stale_after_min,
      effective_stale_min: Math.round(effMin),
      stale_multiplier: effMult,
      runs_24h: counts,
    };
  }

  const { effective: staleThreshold, multiplier: staleMultiplier } = effectiveStaleMinutes(job, now);
  // Cross-replica clock skew can stamp started_at slightly in the future — an unclamped
  // `Date.now() - started_at` reads negative and falsely reports the job as fresh.
  const trustedAgeMin = ageMinFromIso(last.started_at, now.getTime());
  const ageMin = trustedAgeMin ?? staleThreshold + 1;

  // Market-hours-only crons (flow-ingest, spx-evaluate, heatmap-warm, gex-alerts, …)
  // intentionally skip off-window. Once the market is closed they CANNOT log a fresh run,
  // so age inevitably exceeds the threshold — flagging them STALE is a false alarm. While
  // off-window, suppress the stale flag as long as the last logged run was a legitimate skip
  // or success (a "failed" last run is still surfaced below regardless of window).
  const offWindow = marketHoursCronOffWindow(job, now);
  const suppressStaleOffWindow =
    offWindow && (last.status === "skipped" || last.status === "ok");
  const offScheduleGap = Boolean(job.schedule_cron_utc) &&
    isInOffScheduleIdleGap(job.schedule_cron_utc!, now);
  const awaitingDualBand =
    Boolean(job.schedule_cron_utc) && isAwaitingSecondaryUtcBandFire(job.schedule_cron_utc!, now);
  const suppressStaleOffSchedule =
    (offScheduleGap || awaitingDualBand) && (last.status === "skipped" || last.status === "ok");

  let status: CronJobHealthStatus = "healthy";
  let statusLabel = "OK";

  if (last.status === "failed") {
    const swingOkAge =
      job.key === "swing-discovery"
        ? swingDiscoveryRecentOkWithin(runs24h, staleThreshold, now)
        : null;
    if (swingOkAge != null) {
      status = "warning";
      statusLabel = `Last handshake failed; latest ok run ${Math.round(swingOkAge)}m ago`;
    } else if (offScheduleGap || awaitingDualBand) {
      // Between scheduled fires (e.g. Monday morning before the post-close band), a Friday failed
      // handshake must not fail cron-audit-query all day — same ops #1983 shape as stale suppression.
      status = "healthy";
      statusLabel = awaitingDualBand
        ? "Idle (awaiting in-window UTC band; last run failed)"
        : "Idle (outside cron schedule window; last run failed)";
    } else {
      status = "failed";
      statusLabel = "Last run failed";
    }
  } else if (suppressStaleOffWindow) {
    status = "healthy";
    statusLabel = last.status === "skipped" ? "Idle (market closed)" : "OK (market closed)";
  } else if (suppressStaleOffSchedule) {
    status = "healthy";
    statusLabel = awaitingDualBand
      ? "Idle (awaiting in-window UTC band)"
      : "Idle (outside cron schedule window)";
  } else if (
    job.key === "flow-ingest" &&
    last.status === "skipped" &&
    isFlowIngestAlternateWriterSkip(last.message)
  ) {
    // REST cron intentionally idle while the UW WS (local or cluster) is the live writer.
    status = "healthy";
    statusLabel = `REST skipped (${last.message}) — alternate writer path active`;
  } else if (ageMin > staleThreshold) {
    status = "stale";
    statusLabel = `No run in ${Math.round(ageMin)}m (limit ${Math.round(staleThreshold)}m${staleMultiplier > 1 ? ` · ${staleMultiplier}× weekend` : ""})`;
  } else if (last.status === "skipped") {
    status = "warning";
    statusLabel = "Last run skipped";
  } else if (counts.failed > 0 && counts.ok === 0) {
    status = "warning";
    statusLabel = "Failures in last 24h";
  }

  // Flag a market-hours warmer that is stale WHILE its session gate says work is due — the #90 silent-death case.
  let marketHoursStale = Boolean(job.market_hours_only) && !offWindow && status === "stale";

  // Weekday-only EventBridge crons (nighthawk-outcomes, gex-eod-snapshot, banger-discovery, …): between
  // Friday's post-close fire and Monday's next tick, scheduled cron-audit-query must not P0 on stale
  // or Friday failed handshakes — same suppression shape as off-schedule idle gaps on trading days
  // (ops #1983). First meaningful run is Monday; banger-discovery registry note: "weekend does not alert."
  const nonTradingScheduledIdle =
    job.weekdays_only &&
    Boolean(job.schedule_cron_utc) &&
    !isTradingDayEt(formatEtDate(now)) &&
    isInOffScheduleIdleGap(job.schedule_cron_utc!, now);
  if (nonTradingScheduledIdle && (status === "stale" || status === "failed")) {
    status = "healthy";
    statusLabel = "Idle (non-trading day — outside weekday schedule)";
    marketHoursStale = false;
  }

  return {
    key: job.key,
    name: job.name,
    kind: job.kind,
    path: job.path ?? null,
    schedule_label: job.schedule_label,
    description: job.description,
    status,
    status_label: statusLabel,
    market_hours_stale: marketHoursStale,
    last_run_at: last.started_at,
    last_status: last.status,
    last_duration_ms: last.duration_ms,
    last_message: last.message,
    age_min: Math.round(ageMin),
    stale_after_min: job.stale_after_min,
    effective_stale_min: Math.round(staleThreshold),
    stale_multiplier: staleMultiplier,
    runs_24h: counts,
    meta: last.meta_json ?? undefined,
  };
}

export async function buildCronHealthSnapshot(): Promise<CronHealthPayload> {
  let lastRuns: Awaited<ReturnType<typeof fetchCronJobLastRuns>> = [];
  let recentRuns: Awaited<ReturnType<typeof fetchCronJobRunsLast24h>> = [];
  let latestNhJob: Awaited<ReturnType<typeof fetchLatestNighthawkJob>> = null;
  let dbSnapshotError: string | null = null;

  if (dbConfigured()) {
    try {
      [lastRuns, recentRuns, latestNhJob] = await Promise.all([
        fetchCronJobLastRuns(),
        fetchCronJobRunsLast24h(),
        fetchLatestNighthawkJob(),
      ]);
    } catch (error) {
      dbSnapshotError = error instanceof Error ? error.message : String(error);
      console.error("[cron-health] Postgres snapshot failed:", dbSnapshotError);
    }
  }

  const lastByKey = Object.fromEntries(lastRuns.map((r) => [r.job_key, r]));
  // `fetchCronJobRunsLast24h` already bounds by time, per job — no further filtering needed here.
  const runs24hByKey = new Map<string, CronJobRunRow[]>();
  for (const r of recentRuns) {
    const list = runs24hByKey.get(r.job_key) ?? [];
    list.push(r);
    runs24hByKey.set(r.job_key, list);
  }

  const playHb = await loadPlayEngineHeartbeat();
  const zeroDteScanHb = await loadZeroDteScanHeartbeat();
  // Must match OVERLAP_LOCK_KEY in src/app/api/cron/zerodte-warm/route.ts — held for the whole
  // background scan+snapshot chain. Heartbeat ticks only after scanZeroDteBoard() returns, so a
  // legitimately long in-flight scan can exceed the 10m critical_stale window without being a stall.
  const zerodteWarmInFlight = Boolean(
    await sharedCacheGet("zerodte-warm:running").catch(() => null)
  );
  const swingDiscoveryInFlight = await isSwingDiscoveryScanInFlight();
  const jobs = CRON_JOBS.map((job) => {
    const health = evaluateJob(job, lastByKey[job.key], runs24hByKey.get(job.key) ?? []);

    // zerodte-warm's cron_job_runs handshake (logCronRun) fires on the route's FAST
    // synchronous path — auth + cooldown/lock gate + the cheap earnings-cache warm — before
    // the heavy scanner+persist chain (warmZeroDteBoard -> scanZeroDteBoard ->
    // persistZeroDteScan -> discovery-events) is even dispatched in the background. So the
    // handshake reads "on schedule" even when that background chain silently stalls for
    // tens of minutes: measured live 2026-09-16, a ~35min gap in zerodte_discovery_events
    // writes (confirmed via CloudWatch: only 2 "[cron/zerodte-warm] background done"
    // completions logged across a 46-minute span against many fast "accepted" handshakes in
    // between) produced ZERO cron_job_runs staleness — the exact blind spot
    // recordZeroDteScanTick("cron") (scan.ts) was built to catch, but its heartbeat was never
    // read anywhere until now. Unlike spx-evaluate below, this does NOT gate on the
    // cron_job_runs handshake ALSO looking stale first (`cronStale`) — that signal is the
    // known-unreliable one here, so the scan heartbeat's own staleness is authoritative
    // in-window.
    if (job.key === "zerodte-warm" && zeroDteScanHb.last_tick_at) {
      const hbAgeMin = zeroDteScanHb.age_ms != null ? Math.round(zeroDteScanHb.age_ms / 60_000) : null;
      const offWindow = marketHoursCronOffWindow(job, new Date());
      if (!offWindow && hbAgeMin != null && (zeroDteScanHb.stale || zeroDteScanHb.critical_stale)) {
        const IN_FLIGHT_GRACE_MIN = 18;
        if (
          zerodteWarmInFlight &&
          zeroDteScanHb.critical_stale &&
          hbAgeMin < IN_FLIGHT_GRACE_MIN
        ) {
          return {
            ...health,
            status: "warning" as const,
            market_hours_stale: false,
            status_label: `Scanner in flight · last scan tick ${hbAgeMin}m ago (overlap lock held)`,
            meta: {
              ...(health.meta ?? {}),
              zerodte_scan_heartbeat: zeroDteScanHb,
              zerodte_warm_in_flight: true,
            },
          };
        }
        const overrideStatus = zeroDteScanHb.critical_stale ? ("stale" as const) : ("warning" as const);
        return {
          ...health,
          status: overrideStatus,
          market_hours_stale: overrideStatus === "stale",
          status_label: zeroDteScanHb.critical_stale
            ? `Scanner stale · last scan tick ${hbAgeMin}m ago (discovery/commit path stalled)`
            : `Scanner slow · last scan tick ${hbAgeMin}m ago (heartbeat warning)`,
          meta: {
            ...(health.meta ?? {}),
            zerodte_scan_heartbeat: zeroDteScanHb,
          },
        };
      }
    }

    // SPX engine path: `cron_job_runs` age can desync from `recordPlayEngineTick` (e.g. early-close
    // Fridays: last cron skip at 12:52 ET vs engine tick at 13:05 ET still within the engine
    // window — handshake reads stale while HB is fresh). Trust a non-stale heartbeat over stale
    // handshake for both `spx-evaluate` and `spx-issues-sync` (same engine window + HB semantics).
    if ((job.key === "spx-evaluate" || job.key === "spx-issues-sync") && playHb.last_tick_at) {
      const hbNow = new Date();
      const hbAgeMin = playHb.age_ms != null ? Math.round(playHb.age_ms / 60_000) : null;
      const { effective: staleThreshold } = effectiveStaleMinutes(job, hbNow);
      // Off-window the engine correctly idles, so a high cron age is expected — don't let
      // the heartbeat block re-flag a healthy off-hours skip (FIX-1) as stale/warning.
      const offWindow = marketHoursCronOffWindow(job, hbNow);
      const cronStale = !offWindow && health.age_min != null && health.age_min > staleThreshold;

      if (
        health.status === "failed" &&
        !offWindow &&
        hbAgeMin != null &&
        !playHb.stale &&
        !playHb.critical_stale
      ) {
        return {
          ...health,
          status: "healthy" as const,
          market_hours_stale: false,
          status_label: `Engine tick ${hbAgeMin}m ago (cron handshake failed; heartbeat authoritative)`,
          meta: {
            ...(health.meta ?? {}),
            play_engine_heartbeat: playHb,
          },
        };
      }

      if (cronStale && hbAgeMin != null) {
        if (!playHb.stale) {
          return {
            ...health,
            status: "healthy" as const,
            market_hours_stale: false,
            status_label: `Engine tick ${hbAgeMin}m ago (cron handshake age not authoritative)`,
            meta: {
              ...(health.meta ?? {}),
              play_engine_heartbeat: playHb,
            },
          };
        }
        const overrideStatus = playHb.critical_stale ? ("stale" as const) : ("warning" as const);
        return {
          ...health,
          status: overrideStatus,
          market_hours_stale: overrideStatus === "stale",
          status_label: playHb.critical_stale
            ? `Cron stale · engine tick ${hbAgeMin}m ago (critical)`
            : `Cron stale · engine tick ${hbAgeMin}m ago (heartbeat warning)`,
          meta: {
            ...(health.meta ?? {}),
            play_engine_heartbeat: playHb,
          },
        };
      }
    }

    if (
      job.key === "swing-discovery" &&
      swingDiscoveryInFlight &&
      (health.status === "failed" || health.status === "stale")
    ) {
      return {
        ...health,
        status: "warning" as const,
        market_hours_stale: false,
        status_label:
          "Phase scan in flight (running claim held) — prior cron handshake not authoritative",
        meta: { ...(health.meta ?? {}), swing_discovery_in_flight: true },
      };
    }

    if (
      job.key === "nighthawk-backfill-repair" &&
      nighthawkBackfillRepairPreWindow() &&
      (health.status === "stale" || health.status === "failed")
    ) {
      return {
        ...health,
        status: "healthy" as const,
        status_label: "Awaiting 9:00 AM ET repair window",
        market_hours_stale: false,
      };
    }

    if (job.key === "nighthawk-playbook" && latestNhJob) {
      const updatedAt = latestNhJob.updated_at;
      // A non-terminal job (anything not published/failed) whose updated_at is older than this is
      // STUCK — with the fire-and-forget builder a healthy build checkpoints every stage within
      // minutes, so >60m without progress and without publishing means the background build died
      // silently (host kill, OOM, hung Claude call). Escalate to `stale` so the watchdog alerts the
      // same night instead of waiting out the 4h registry ceiling. (#77 hardening D, item 10)
      const STUCK_JOB_MIN = isInEditionWindow() ? 15 : 60;
      const ageMin = nighthawkJobAgeMin(updatedAt, STUCK_JOB_MIN);
      let status = health.status;
      let statusLabel = health.status_label;

      const nonTerminal = latestNhJob.status !== "published" && latestNhJob.status !== "failed";
      const stuck = nonTerminal && ageMin != null && ageMin > STUCK_JOB_MIN;

      // Night Hawk is a scheduled evening writer, not a periodic 4h warmer. A published edition for
      // today's trading session remains valid all day; after the evening catch-up deadline, health
      // requires the next trading session's edition. This keeps overnight watchdog runs honest without
      // hiding a truly dark evening build.
      const expectedEdition = expectedNighthawkEdition();
      const publishedCoversExpected = nighthawkEditionCoversExpected(
        latestNhJob.edition_for,
        expectedEdition
      );

      if (latestNhJob.status === "failed") {
        status = "failed";
        statusLabel = `Job failed: ${latestNhJob.error ?? latestNhJob.current_stage ?? "unknown"}`;
      } else if (latestNhJob.status === "published") {
        // The edition PUBLISHED — if it covers the currently expected session, the writer's actual
        // target (nighthawk_editions) is current regardless of the cron_job_runs handshake age.
        status = publishedCoversExpected ? "healthy" : "stale";
        statusLabel = publishedCoversExpected
          ? `Published ${latestNhJob.edition_for} (expected ${expectedEdition.expected_edition_for})`
          : `Expected ${expectedEdition.expected_edition_for} after ${expectedEdition.deadline_label}; last published ${latestNhJob.edition_for}`;
      } else if (stuck) {
        status = "stale";
        statusLabel = `Stuck ${ageMin}m at ${latestNhJob.current_stage ?? latestNhJob.status} (no publish, no progress)`;
      } else if (health.status === "unknown") {
        status = "warning";
        statusLabel = `${latestNhJob.status}${latestNhJob.current_stage ? ` · ${latestNhJob.current_stage}` : ""}`;
      }

      return {
        ...health,
        status,
        status_label: statusLabel,
        last_run_at: updatedAt ?? health.last_run_at,
        age_min: ageMin ?? health.age_min,
        meta: {
          ...(health.meta ?? {}),
          nighthawk_job: {
            edition_for: latestNhJob.edition_for,
            status: latestNhJob.status,
            current_stage: latestNhJob.current_stage,
            error: latestNhJob.error,
            updated_at: latestNhJob.updated_at,
            published_at: latestNhJob.published_at,
          },
          expected_edition: expectedEdition,
          source: health.last_run_at ? "cron_log+nighthawk_job" : "nighthawk_job_only",
        },
      };
    }

    return health;
  });

  // X marketing crons may have EventBridge disabled while pause env flags are set — don't page
  // STALE for an intentionally idle stack (ops still sees "Paused" in admin cron health).
  for (let i = 0; i < jobs.length; i++) {
    const health = jobs[i];
    if (!xMarketingCronPaused(health.key)) continue;
    if (health.status !== "stale" && health.status !== "failed" && health.status !== "unknown") {
      continue;
    }
    jobs[i] = {
      ...health,
      status: "healthy",
      status_label: "Paused (X marketing env)",
      market_hours_stale: false,
    };
  }

  // Handshake lag during ECS redeploy gaps can mark warmers/flow-ingest stale even when
  // their PG/Redis targets are still fresh (organic traffic + TTL + WS paths keep data live).
  const TARGET_FRESH_OVERRIDE_KEYS = new Set([
    "flow-ingest",
    "heatmap-warm",
    "desk-warm",
    "zerodte-warm",
    "uw-cache-refresh",
    "vector-bead-record",
    "vector-walls-warm",
    "swing-discovery",
  ]);
  await Promise.all(
    jobs.map(async (health, index) => {
      const handshakeProblem =
        health.market_hours_stale ||
        health.status === "stale" ||
        (health.key === "swing-discovery" && health.status === "failed");
      if (!handshakeProblem) return;
      if (!TARGET_FRESH_OVERRIDE_KEYS.has(health.key)) return;
      const { probeWriterTargetFresh } = await import("@/lib/cron-writer-target-fresh");
      const probe = await probeWriterTargetFresh(health.key);
      if (!probe?.fresh) return;
      jobs[index] = {
        ...health,
        status: "healthy",
        status_label: `Target fresh (${probe.detail}) — cron handshake lag is benign`,
        market_hours_stale: false,
        meta: { ...(health.meta ?? {}), writer_target_probe: probe },
      };
    })
  );

  const summary = {
    total: jobs.length,
    healthy: jobs.filter((j) => j.status === "healthy").length,
    warning: jobs.filter((j) => j.status === "warning").length,
    stale: jobs.filter((j) => j.status === "stale").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    unknown: jobs.filter((j) => j.status === "unknown").length,
    market_hours_stale: jobs.filter((j) => j.market_hours_stale).length,
  };

  const jobNameByKey = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j.name]));
  const loggedRunsTotal = dbConfigured() ? await fetchCronJobRunCount() : 0;

  let diagnosticsNote: string | null = null;
  if (loggedRunsTotal === 0) {
    if (!dbConfigured()) {
      diagnosticsNote =
        "DATABASE_URL is not set on blackout-web — cron runs cannot be logged to Postgres.";
    } else if (!process.env.CRON_SECRET?.trim()) {
      diagnosticsNote =
        "CRON_SECRET is not set on blackout-web — HTTP cron routes return 401 and never log a run.";
    } else {
      diagnosticsNote =
        "No runs in cron_job_runs yet. HTTP crons must call blackout-web with the header 'Authorization: Bearer $CRON_SECRET' after this deploy. ECS task status is separate from this dashboard.";
    }
  }

  return {
    generated_at: new Date().toISOString(),
    cron_secret_configured: Boolean(process.env.CRON_SECRET?.trim()),
    db_configured: dbConfigured(),
    db_snapshot_error: dbSnapshotError,
    logged_runs_total: loggedRunsTotal,
    diagnostics_note: diagnosticsNote,
    summary,
    jobs,
    recent_events: recentRuns.slice(0, 24).map((r) => ({
      job_key: r.job_key,
      job_name: jobNameByKey[r.job_key] ?? r.job_key,
      status: r.status,
      started_at: r.started_at,
      duration_ms: r.duration_ms,
      message: r.message,
    })),
  };
}
