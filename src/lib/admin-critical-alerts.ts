import type { SpxAdminIssue } from "@/lib/admin-spx-issues";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { dbConfigured, dbQuery } from "@/lib/db";

// BUG-06 fix (a): Use an insertion-order Map capped at MAX_SEEN entries so the
// set never grows unboundedly. Oldest entries are evicted when the cap is hit.
const MAX_SEEN = 100;
const seenCritical = new Map<string, true>();

function addSeen(id: string): void {
  if (seenCritical.has(id)) return;
  if (seenCritical.size >= MAX_SEEN) {
    // Evict the oldest insertion (first key in Map iteration order).
    const oldest = seenCritical.keys().next().value;
    if (oldest !== undefined) seenCritical.delete(oldest);
  }
  seenCritical.set(id, true);
}

// BUG-06 fix (b): Pre-populate seenCritical from the DB on first use so that a
// process restart does not re-alert for issues that were already notified in the
// last 24 hours.
//
// ROUND 331 FIX: the previous guard was a plain boolean flipped to `true` BEFORE the
// `await dbQuery(...)` below resolved (comment literally said "mark eagerly so concurrent
// callers don't double-query"). That flag stops a second caller from starting a SECOND read,
// but it does not make that second caller wait for the FIRST read — any call that reaches the
// `if (seenBootstrapped) return` check while the first call's `dbQuery` is still in flight sees
// `true` on its synchronous check and returns immediately, skipping hydration entirely rather
// than merely skipping a redundant query. Concrete trigger: `GET /api/admin/health` calls
// `maybeAlertCriticalIssues` on every load, and two near-simultaneous requests landing right
// after an ECS deploy/restart (two admin tabs open, or one admin's auto-refresh racing a
// slow-starting DB pool) both pass the gate — whichever one's `fresh` filter runs against the
// still-empty `seenCritical` Map re-fires a Discord "SPX CRITICAL" alert for an issue that was
// already alerted within the last 24 hours, pre-restart — exactly the duplicate-alert fix (b)
// exists to prevent. Same shape, same fix as `play-engine-heartbeat.ts`'s `ensureInitialized()`
// race: a single shared in-flight promise so every concurrent caller awaits the SAME completion
// before touching `seenCritical`, with the boolean kept only as the fast path once hydration has
// actually finished (set in a `finally` so a thrown/rejected bootstrap still unblocks future
// calls instead of wedging every caller behind a dead promise forever).
let seenBootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

async function bootstrapSeenFromDb(): Promise<void> {
  if (seenBootstrapped) return;
  if (bootstrapPromise) {
    await bootstrapPromise;
    return;
  }
  bootstrapPromise = (async () => {
    if (!dbConfigured()) return;
    try {
      const res = await dbQuery<{ fingerprint: string }>(
        `SELECT fingerprint FROM admin_incidents
         WHERE severity = 'critical'
           AND opened_at >= NOW() - INTERVAL '24 hours'`
      );
      for (const row of res.rows) {
        addSeen(row.fingerprint);
      }
    } catch (err) {
      console.warn("[admin-critical-alerts] bootstrap from DB failed:", err);
    }
  })();
  try {
    await bootstrapPromise;
  } finally {
    seenBootstrapped = true;
  }
}

export async function maybeAlertCriticalIssues(issues: SpxAdminIssue[]): Promise<number> {
  await bootstrapSeenFromDb();

  const critical = issues.filter((i) => i.severity === "critical");
  const fresh = critical.filter((i) => !seenCritical.has(i.id));
  for (const issue of critical) addSeen(issue.id);

  if (fresh.length === 0) return 0;

  const lines = fresh.slice(0, 5).map((i) => `**${i.title}** — ${i.detail}`);
  await notifyOpsDiscord({
    title: `SPX CRITICAL · ${fresh.length} new`,
    body: lines.join("\n"),
    severity: "critical",
  });
  return fresh.length;
}
