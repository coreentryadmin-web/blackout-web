/**
 * PUBLISH GUARD for the manual X showcase path.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ────────────────────────────────────────────────────────────
 *
 * `scripts/x-showcase-post.mjs --post` carried its own inline `uploadMedia` + `postTweet` and
 * called NONE of the gates the cron path goes through. Measured on the file before this change:
 *
 *   postTweet 2 · uploadMedia 2 · checkPostGuard 0 · isTweetContentValid 0
 *   recordBudgetUse 0 · xMarketingPostsPaused 0
 *
 * So a second publisher existed beside `x-autopost`, subject to no daily cap, no spacing rule, no
 * content validation and — the part that matters most — **no pause flag**. Setting
 * `X_MARKETING_POSTS_PAUSED=1` stopped the cron and did nothing to this script. A kill switch that
 * only kills one of two publishers is not a kill switch, and the one thing that actually gets an
 * account rate-limited is exactly this: two paths spending the same budget without either knowing
 * about the other.
 *
 * ── WHY A SHARED MODULE AND NOT AN INLINE CHECK ────────────────────────────────────────────────
 *
 * Every gate below is IMPORTED from the module production already uses. Nothing is reimplemented.
 * A second copy of "is it paused" or "how many posts today" is the same fork in a different shape:
 * it would pass its own tests and drift from the real rule the first time either changed.
 *
 * ── WHY THE PAUSE FLAG IS HYDRATED FROM THE SECRETS BLOB ───────────────────────────────────────
 *
 * `xMarketingPostsPaused()` reads `process.env`, which on ECS is populated from
 * `blackout-production/app/env`. This script runs on an operator's machine, where that env does not
 * exist — so reading `process.env` alone would report "not paused" no matter what production says,
 * which is precisely the failure it is meant to prevent. The blob the script already loads for its
 * X credentials IS the production environment, so the flag is taken from there and pushed into
 * `process.env` before the real helper reads it.
 */

import { xMarketingPostsPaused } from "@/lib/x-marketing-env";
import { checkPostGuard, isTweetContentValid } from "@/lib/x-post-guard";
import { recordBudgetUse } from "@/lib/x-rate-budget";

/**
 * Keys lifted from the secrets blob into `process.env` so the imported production helpers see the
 * same values ECS would give them.
 *
 * Deliberately a short, explicit list rather than `Object.assign(process.env, secrets)`: the blob
 * is a ~98-key production environment including database URLs and provider keys, and splatting all
 * of it into a local process is a much larger action than this script needs.
 */
export const HYDRATED_ENV_KEYS = Object.freeze([
  "X_API_KEY",
  "X_API_KEY_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_MARKETING_POSTS_PAUSED",
  "X_API_ACCESS_TIER",
]);

/**
 * Copy the publish-relevant keys out of the secrets blob into `process.env`, without overwriting a
 * value the operator set explicitly on the command line — a local `X_MARKETING_POSTS_PAUSED=1`
 * must be able to stop a run even if production is unpaused.
 */
export function hydratePublishEnv(secrets, env = process.env) {
  const applied = [];
  for (const key of HYDRATED_ENV_KEYS) {
    if (env[key] != null && env[key] !== "") continue;
    const value = secrets?.[key];
    if (value == null || value === "") continue;
    env[key] = String(value);
    applied.push(key);
  }
  return applied;
}

/**
 * PURE. Given the facts, why publishing must not proceed — or null if it may.
 *
 * Separated from the I/O above so the precedence is testable. The order is deliberate: the pause
 * flag is checked FIRST, because a paused account must not have its timeline read to evaluate a
 * rate cap. Refusing after the API call would still spend a request against a budget the operator
 * has explicitly asked us to stop spending.
 */
export function publishRefusalReason({
  paused,
  guard,
  contentValid,
  hasCredentials,
}) {
  if (paused) {
    return "X_MARKETING_POSTS_PAUSED is set — posting is paused for the whole account, not just the cron";
  }
  if (!hasCredentials) {
    return "X API credentials missing from secrets — cannot post";
  }
  if (!contentValid) {
    return "tweet text failed isTweetContentValid() — the same content gate the cron path applies";
  }
  if (guard && guard.allowed === false) {
    return `post guard refused: ${guard.reason ?? "no reason given"}`;
  }
  return null;
}

/**
 * Run every real gate for a manual showcase publish. Returns `{ refusal, guard }`;
 * `refusal` is null when the post may proceed.
 *
 * `checkPostGuard()` derives the daily count and spacing from the LIVE TIMELINE rather than a local
 * counter, which is what makes this correct across publishers: a post this script makes is visible
 * to the cron's guard and vice versa. That property is why the cap is read from X rather than from
 * the database, and why it must not be replaced with a local tally.
 */
export async function resolvePublishRefusal({ secrets, text, hasCredentials }) {
  hydratePublishEnv(secrets);

  const paused = xMarketingPostsPaused();
  if (paused) {
    return {
      refusal: publishRefusalReason({ paused, hasCredentials, contentValid: true, guard: null }),
      guard: null,
    };
  }

  const contentValid = isTweetContentValid(text);
  // Only reach for the timeline once the cheap, local gates have passed — see the ordering note on
  // publishRefusalReason.
  const guard = hasCredentials && contentValid ? await checkPostGuard() : null;

  return {
    refusal: publishRefusalReason({ paused, guard, contentValid, hasCredentials }),
    guard,
  };
}

/**
 * Record a successful manual post against the ET-day budget.
 *
 * NOTE ON WHAT THIS COUNTER IS. `X_DAILY_CAPS.posts` is NOT the enforced cap — nothing reads it;
 * `resolveRunBudget()` does not include `posts`, and the authoritative limit is `checkPostGuard()`'s
 * timeline-derived count. The counter is telemetry, surfaced by the admin X marketing panel. Before
 * this change only `x-autopost` incremented it, so the panel under-reported every manual showcase
 * post and an operator reading it saw a smaller day than actually happened. Writing it here makes
 * the number honest without pretending it is a gate.
 */
export async function recordManualPost() {
  await recordBudgetUse("posts");
}
