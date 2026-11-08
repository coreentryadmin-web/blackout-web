import { sanitizeTelemetrySnippet } from "@/lib/api-telemetry-sanitize";

// NOTE: @/lib/db (which pulls node-only `pg`) is imported LAZILY inside the
// functions below — never at module top. instrumentation.ts dynamically imports
// this module, and instrumentation is bundled for BOTH the node and edge runtimes;
// a static `pg` import here would drag `fs`/`path` into the edge graph and fail the
// build. The lazy import keeps this module edge-safe while staying inert (no DB work)
// unless DATABASE_URL is set. api-telemetry-sanitize is pure, so it is safe at top.

/**
 * P1 (audit: "No external error tracking / durable error sink").
 *
 * A single, INERT-BY-DEFAULT error sink. captureError() does three independent,
 * best-effort things, each isolated so a failure in one (or in the sink itself)
 * can NEVER throw into a request hot path or into the process crash handler:
 *
 *   1. Durable DB row in error_events  (only when DATABASE_URL is set)
 *   2. Forward to Sentry               (only when SENTRY_DSN is set AND
 *                                        @sentry/nextjs is actually installed)
 *   3. console.error                   (always — preserves prior behavior)
 *
 * When neither a database nor SENTRY_DSN is configured this is effectively a
 * no-op beyond the console.error the callers already did. No static dependency
 * on @sentry/nextjs is added: the package is loaded via a guarded dynamic import
 * and silently skipped if absent, so the build never requires it.
 */

export type ErrorSource =
  | "admin_route"
  | "unhandled_rejection"
  | "uncaught_exception"
  | "request_error"
  | "manual"
  | "frontend"
  | "db_query"
  | "auth_failure";

export type ErrorContext = {
  source: ErrorSource;
  /** Route key, job key, or other locator. */
  scope?: string;
  /** Small, NON-SECRET structured context. Values are redacted before storage. */
  meta?: Record<string, unknown>;
};

/** Keep the durable table bounded; prune opportunistically to newest N rows. */
export const ERROR_EVENTS_KEEP = 2000;
let pruneCounter = 0;

function toErr(reason: unknown): { message: string; stack: string | null; name: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack ?? null, name: reason.name };
  }
  if (typeof reason === "string") return { message: reason, stack: null, name: "Error" };
  try {
    return { message: JSON.stringify(reason), stack: null, name: "Error" };
  } catch {
    return { message: String(reason), stack: null, name: "Error" };
  }
}

// ---------------------------------------------------------------------------
// Sentry (optional, dormant unless SENTRY_DSN set AND @sentry/nextjs installed)
// ---------------------------------------------------------------------------

type MinimalSentry = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown, hint?: Record<string, unknown>) => void;
};

let sentryPromise: Promise<MinimalSentry | null> | null = null;

async function getSentry(): Promise<MinimalSentry | null> {
  if (!process.env.SENTRY_DSN?.trim()) return null;
  if (sentryPromise) return sentryPromise;
  sentryPromise = (async () => {
    try {
      // Guarded dynamic import: if @sentry/nextjs is not installed this throws
      // and we fall back to DB-only. Variable specifier keeps bundlers from
      // hard-requiring the module at build time.
      const spec = "@sentry/nextjs";
      const imported = (await import(/* webpackIgnore: true */ spec)) as
        Partial<MinimalSentry> & { default?: Partial<MinimalSentry> };
      // A native runtime import (webpackIgnore) can expose the SDK API either as
      // named exports (ESM/bundled) OR only under `.default` (CJS interop) — and
      // @sentry/nextjs's `captureException` lands on `.default` in the latter shape.
      // Normalize so capture is reliably callable either way (otherwise errors would
      // silently persist to DB only and never reach Sentry).
      const mod: Partial<MinimalSentry> =
        typeof imported?.captureException === "function"
          ? imported
          : (imported?.default ?? {});
      if (typeof mod.init === "function" && typeof mod.captureException === "function") {
        mod.init({
          dsn: process.env.SENTRY_DSN,
          tracesSampleRate: 0,
          environment: process.env.NODE_ENV,
        });
        return mod as MinimalSentry;
      }
      return null;
    } catch {
      return null; // package absent — DB sink still works
    }
  })();
  return sentryPromise;
}

// ---------------------------------------------------------------------------
// Durable DB sink
// ---------------------------------------------------------------------------

async function persistErrorEvent(
  e: { message: string; stack: string | null; name: string },
  ctx: ErrorContext
): Promise<void> {
  // Lazy import keeps node-only `pg` out of this module's static (edge-traced) graph.
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return;
  try {
    const safeMessage = (sanitizeTelemetrySnippet(e.message) ?? "").slice(0, 2000);
    const safeStack = sanitizeTelemetrySnippet(e.stack)?.slice(0, 8000) ?? null;
    let metaJson: string | null = null;
    try {
      metaJson = ctx.meta ? sanitizeTelemetrySnippet(JSON.stringify(ctx.meta)) : null;
    } catch {
      metaJson = null;
    }
    await dbQuery(
      `INSERT INTO error_events (source, scope, name, message, stack, meta_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [ctx.source, ctx.scope ?? null, e.name, safeMessage, safeStack, metaJson]
    );
    // Opportunistic prune (every ~50 inserts) keeps the table bounded.
    if (++pruneCounter % 50 === 0) {
      await dbQuery(
        `DELETE FROM error_events
         WHERE id < (
           SELECT COALESCE(MIN(id), 0) FROM (
             SELECT id FROM error_events ORDER BY id DESC LIMIT $1
           ) keep
         )`,
        [ERROR_EVENTS_KEEP]
      );
    }
  } catch (err) {
    console.warn("[error-sink] persist failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Cross-capture-site dedup for dbQuery() failures
// ---------------------------------------------------------------------------

// dbQuery() (db.ts) captures every one of its own final failures internally
// (source: "db_query"). Several admin routes ALSO wrap their whole handler in a
// catch-all that independently calls captureError (source: "admin_route") when
// a dbQuery failure propagates up uncaught -- without this, the exact same
// failure lands in error_events twice, inflating the count BIE's discovery
// report uses for "N errors in 24h - elevated". WeakSet keyed on the error
// object itself (never wrapped/re-thrown between dbQuery and these routes'
// catch blocks, confirmed 2026-07-03) -- entries are GC'd once the error is
// unreachable, no manual cleanup needed.
const dbQueryCapturedErrors = new WeakSet<object>();

export function markDbQueryCaptured(err: unknown): void {
  if (err !== null && typeof err === "object") dbQueryCapturedErrors.add(err);
}

export function wasDbQueryCaptured(err: unknown): boolean {
  return err !== null && typeof err === "object" && dbQueryCapturedErrors.has(err);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an error to all configured durable sinks. Never throws. Returns a
 * promise that resolves once best-effort delivery completes; callers in hot
 * paths should NOT await it (use `void captureError(...)`).
 */
/**
 * Eagerly initialize the optional Sentry client (no-op unless SENTRY_DSN is set
 * AND @sentry/nextjs is installed). Safe to call repeatedly — getSentry() memoizes.
 * Called once at server boot from instrumentation.register() so the first captured
 * error doesn't pay the init latency.
 */
export async function initErrorSinkSentry(): Promise<void> {
  try {
    await getSentry();
  } catch {
    /* never throw from boot path */
  }
}

export async function captureError(reason: unknown, ctx: ErrorContext): Promise<void> {
  const e = toErr(reason);
  try {
    await Promise.allSettled([
      persistErrorEvent(e, ctx),
      (async () => {
        const sentry = await getSentry();
        if (sentry) {
          sentry.captureException(reason, {
            tags: { source: ctx.source, scope: ctx.scope ?? "" },
          });
        }
      })(),
    ]);
  } catch (err) {
    // Absolute backstop — the sink must never propagate.
    console.warn("[error-sink] captureError failed:", err);
  }
}

export type ErrorEventRow = {
  id: number;
  source: string;
  scope: string | null;
  name: string;
  message: string;
  stack: string | null;
  meta_json: unknown;
  created_at: string;
};

/**
 * Pure severity classifier for a recent error count (exported for tests).
 * none < warn ≤ warning < crit ≤ critical.
 */
export function classifyErrorSpike(
  total: number,
  warnThreshold: number,
  critThreshold: number
): "none" | "warning" | "critical" {
  if (total >= critThreshold) return "critical";
  if (total >= warnThreshold) return "warning";
  return "none";
}

export type RecentErrorEventsSummary = {
  total: number;
  groups: Array<{ source: string; scope: string | null; count: number }>;
};

/**
 * Pure: shape a (true total count, bounded top-groups sample) pair into the summary object.
 *
 * Split out from `countRecentErrorEvents` so the one invariant that actually matters here --
 * `total` must be the REAL count of matching rows, not however many the top-groups breakdown
 * happened to carry -- is unit-testable without a live Postgres connection. `groupRows` is only
 * ever a bounded `LIMIT 8` sample used for the top-sources preview; `totalCount` must come from
 * a real `COUNT(*)`, never from summing that sample.
 */
export function shapeRecentErrorEventsSummary(
  totalCount: number,
  groupRows: Array<{ source: string; scope: string | null; count: string | number }>
): RecentErrorEventsSummary {
  const groups = groupRows.map((r) => ({ source: r.source, scope: r.scope, count: Number(r.count) }));
  return { total: totalCount, groups };
}

/**
 * Count error_events in the last `sinceMinutes`, with a small top-groups breakdown for alerts.
 * Cache-reader-safe: two bounded aggregate reads (a real COUNT(*) plus a top-8 breakdown), never
 * a row dump. Returns zeros on any miss.
 *
 * THE BUG THIS FIXES: `total` used to be `groups.reduce((sum, g) => sum + g.count, 0)` --
 * summing only the top 8 `(source, scope)` groups from a
 * `GROUP BY source, scope ORDER BY COUNT(*) DESC LIMIT 8` query. Any window with MORE than 8
 * distinct (source, scope) combinations silently dropped every group past the 8th from the
 * total -- e.g. 20 sources erroring 10 times each is 200 real errors, but only the top 8 groups'
 * counts (<=80) ever reached `total`. `total` feeds directly into `classifyErrorSpike` on the
 * cron-staleness-watchdog's error-rate alert (`cron-staleness-watchdog/route.ts`), so a
 * genuinely severe but WIDE error spike (many distinct failing sources, not one dominant one)
 * could silently under-report its severity, or miss the warn/crit threshold entirely -- exactly
 * the "diverse failure, not one hot source" shape a spike detector exists to catch. Same bug
 * class, same fix shape, as `countAuthFailures`'s `shapeAuthFailureSummary` split above: run a
 * real, unbounded `COUNT(*)` for the total alongside the existing bounded top-8 breakdown query,
 * which now only ever feeds `groups`.
 */
export async function countRecentErrorEvents(sinceMinutes = 15): Promise<RecentErrorEventsSummary> {
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return { total: 0, groups: [] };
  const mins = Math.min(Math.max(1, Math.round(sinceMinutes)), 1440);
  try {
    const [{ rows: countRows }, { rows: groupRows }] = await Promise.all([
      dbQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM error_events
          WHERE created_at > NOW() - ($1 || ' minutes')::interval`,
        [String(mins)]
      ),
      dbQuery<{ source: string; scope: string | null; count: string }>(
        `SELECT source, scope, COUNT(*)::text AS count
           FROM error_events
          WHERE created_at > NOW() - ($1 || ' minutes')::interval
          GROUP BY source, scope
          ORDER BY COUNT(*) DESC
          LIMIT 8`,
        [String(mins)]
      ),
    ]);
    return shapeRecentErrorEventsSummary(Number(countRows[0]?.count ?? 0), groupRows);
  } catch {
    return { total: 0, groups: [] };
  }
}

export type AuthFailureSummary = {
  total_24h: number;
  by_mode: Record<string, number>;
  recent_messages: string[];
};

/**
 * Pure: shape a (true total count, sampled-rows) pair into the summary object.
 *
 * Split out from `countAuthFailures` so the one invariant that actually matters here —
 * `total_24h` must be the REAL count, not however many rows the recent-messages sample
 * happened to carry — is unit-testable without a live Postgres connection. `rows` is only
 * ever a bounded sample (see `countAuthFailures`'s own `LIMIT 200`) used for the `by_mode`
 * breakdown and `recent_messages` preview; `totalCount` must come from a real `COUNT(*)`,
 * never from `rows.length`.
 */
export function shapeAuthFailureSummary(
  totalCount: number,
  rows: Array<{ scope: string | null; message: string }>
): AuthFailureSummary {
  const by_mode: Record<string, number> = {};
  for (const r of rows) {
    const mode = r.scope ?? "unknown";
    by_mode[mode] = (by_mode[mode] ?? 0) + 1;
  }
  return {
    total_24h: totalCount,
    by_mode,
    recent_messages: [...new Set(rows.map((r) => r.message))].slice(0, 5),
  };
}

/**
 * BIE Stage 3: "security warnings / auth failure monitoring." Dedicated (not the
 * generic top-8 `countRecentErrorEvents` grouping, which could drop a real but
 * low-volume auth-failure signal if other error sources dominate the window).
 * Reads only what AuthFailureObserver.tsx's beacon has already written under
 * source: "auth_failure" — zero new access, same fail-open-to-zero pattern as
 * every other probe on this report.
 *
 * THE BUG THIS FIXES: `total_24h` used to be `rows.length` off the SAME `LIMIT 200` query
 * used for the `recent_messages`/`by_mode` sample — so any window with MORE than 200 real
 * auth failures silently plateaued at exactly 200 forever, no matter how much larger the
 * real count actually was. That is precisely the window this number exists to catch: a
 * credential-stuffing/brute-force spike is exactly the scenario that pushes a 24h count
 * past 200, and reporting a flat "200" instead of the real magnitude understates severity
 * on the admin BIE report's "security warnings" panel exactly when it matters most. Fixed
 * by running a real `COUNT(*)` for the total alongside the existing bounded sample query —
 * the sample still only feeds `by_mode`/`recent_messages`, which are explicitly a preview,
 * never the headline number.
 */
export async function countAuthFailures(sinceHours = 24): Promise<AuthFailureSummary> {
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return { total_24h: 0, by_mode: {}, recent_messages: [] };
  const hours = Math.min(Math.max(1, Math.round(sinceHours)), 168);
  try {
    const [{ rows: countRows }, { rows }] = await Promise.all([
      dbQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM error_events
          WHERE source = 'auth_failure' AND created_at > NOW() - ($1 || ' hours')::interval`,
        [String(hours)]
      ),
      dbQuery<{ scope: string | null; message: string; created_at: Date }>(
        `SELECT scope, message, created_at
           FROM error_events
          WHERE source = 'auth_failure' AND created_at > NOW() - ($1 || ' hours')::interval
          ORDER BY id DESC
          LIMIT 200`,
        [String(hours)]
      ),
    ]);
    return shapeAuthFailureSummary(Number(countRows[0]?.count ?? 0), rows);
  } catch {
    return { total_24h: 0, by_mode: {}, recent_messages: [] };
  }
}

// `limit` here is whatever a caller passes through from a raw `?limit=` query param (see
// `/api/admin/errors`). A fractional value (`limit=2.5`) is finite, so a bare
// `Math.min(Math.max(1, limit), 500)` lets it survive untouched and reach `LIMIT $1` below as a
// non-integer bound param — Postgres' bigint input parser rejects any decimal point
// (`invalid input syntax for type bigint`), turning a malformed query param into an uncaught
// 500 instead of rounding to the nearest in-range limit. `Math.trunc` (applied before the
// non-finite fallback, so `Number.isFinite` still sees the ORIGINAL value) removes the fraction
// before the clamp ever runs.
export function clampErrorEventsLimit(limit: number): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : 100;
  return Math.min(Math.max(1, n), 500);
}

export async function fetchRecentErrorEvents(limit = 100): Promise<ErrorEventRow[]> {
  // Lazy import keeps node-only `pg` out of this module's static (edge-traced) graph.
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return [];
  try {
    const { rows } = await dbQuery<{
      id: string;
      source: string;
      scope: string | null;
      name: string;
      message: string;
      stack: string | null;
      meta_json: unknown;
      created_at: Date;
    }>(
      `SELECT id, source, scope, name, message, stack, meta_json, created_at
       FROM error_events
       ORDER BY id DESC
       LIMIT $1`,
      [clampErrorEventsLimit(limit)]
    );
    return rows.map((r) => ({
      id: Number(r.id),
      source: r.source,
      scope: r.scope,
      name: r.name,
      message: r.message,
      stack: r.stack,
      meta_json: r.meta_json,
      created_at: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}
