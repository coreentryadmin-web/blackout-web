/**
 * Pure id-generation for a single SPX admin health issue — split out of admin-spx-issues.ts
 * (which transitively imports `"server-only"`-guarded providers, e.g. gex-positioning.ts via
 * market-health.ts, through its `buildMarketHealthSnapshot` import) so this logic is
 * unit-testable under the plain node test runner without a Next.js server runtime. Same pattern
 * as admin-api-dashboard-match.ts, split out of admin-api-dashboard.ts for the identical reason.
 *
 * BUG (found 2026-11-01 admin sweep): the id this replaces was
 * `${category}:${issues.length}:${title.slice(0, 24)}`, computed inline inside
 * admin-spx-issues.ts's `push()` helper. It baked in the ARRAY INDEX the issue happened to land
 * at when `push()` ran — a function of which OTHER, UNRELATED issues fired earlier in that SAME
 * call to `buildSpxAdminIssues` (postgres down? provider missing? desk price zero? — every one of
 * those gates an earlier `push()`). So the SAME ongoing issue (e.g. "Flow data stale") got a
 * DIFFERENT id from one poll to the next whenever some earlier, unrelated issue merely flapped
 * on/off in between — the id was never actually an identity of the issue itself.
 *
 * This is exactly the identity `admin-critical-alerts.ts`'s `maybeAlertCriticalIssues` keys its
 * "have we already alerted on this" dedup set (`seenCritical`) by, and the one its DB-bootstrap
 * step tries to pre-seed from `admin_incidents.fingerprint` after a process restart — both read
 * `issue.id` assuming it is a STABLE identity for "this specific issue", matching every other
 * issue producer in this codebase (`admin-health.ts`'s synthetic issues use fixed ids like
 * `"rate_limit:redis_degraded"`; `admin-incidents.ts`'s own `fingerprintFor` is
 * `${category}:${title}`, with no index and no truncation). An unstable id broke both: a
 * persistent critical incident could re-alert to Discord on every poll that happened to land
 * after an unrelated issue's state changed, and the post-restart bootstrap could never match a
 * live issue back to its persisted fingerprint (the formats didn't even agree once the 24-char
 * truncation was added to the mix).
 *
 * Fix: `${category}:${title}` — no index, no truncation — which is already exactly what
 * `fingerprintFor` computes, so this now agrees with it, closing the bootstrap gap at the same
 * time. Issues sharing one category+title within a single build (today: only the
 * `info`-severity "Play gate block"/"Play gate warning" loops, one push per real-time string in
 * `detail`) collapse onto the same id — acceptable here because `maybeAlertCriticalIssues` only
 * acts on `severity === "critical"` rows, none of which share a category+title within one build
 * (every `push()` call site in admin-spx-issues.ts was checked against this).
 */
export function stableIssueId(category: string, title: string): string {
  return `${category}:${title}`;
}

/** The subset of a pushed issue row `pushWithStableId` needs to compute a default id. */
export type IssueIdentity = {
  id?: string;
  category: string;
  title: string;
};

/**
 * Push `row` onto `issues`, defaulting `id` to `stableIssueId(category, title)` when the caller
 * didn't supply one explicitly. This IS admin-spx-issues.ts's `push()` helper's actual
 * id-assignment behavior (that function delegates to this one) — pulled out here, not left
 * inline, so the exact mechanism the bug lived in is unit-testable without that file's
 * "server-only" transitive-import chain. See this file's header for the full root-cause writeup.
 */
export function pushWithStableId<T extends IssueIdentity>(
  issues: Array<T & { id: string }>,
  row: T
): void {
  issues.push({ ...row, id: row.id ?? stableIssueId(row.category, row.title) });
}
