/** Standing operator policy: X marketing crons are OFF unless explicitly re-enabled. */
import { loadProdSecretsFromAws } from "./prod-secrets.mjs";

export const X_MARKETING_CRON_KEYS = new Set([
  "x-intel",
  "x-autopost",
  "x-growth",
  "x-replies",
  "x-analytics",
]);

function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function secretVal(key) {
  const fromAws = loadProdSecretsFromAws()[key]?.trim();
  if (fromAws) return fromAws;
  return process.env[key]?.trim() ?? "";
}

/**
 * Secret reader, injectable.
 *
 * The default reaches AWS Secrets Manager, which is right in production and wrong in a test: a
 * unit test that calls the default is not testing this module's logic, it is asking prod what it
 * is currently configured to do. `x-marketing-paused.test.mjs` deleted the env vars and asserted
 * "not suppressed" — and failed on any machine that can read the prod blob, because prod really
 * does have X_MARKETING_POSTS_PAUSED set. The test was passing only where AWS was unreachable.
 */
const defaultRead = secretVal;

/** True when prod Secrets Manager has X marketing intentionally paused. */
export function xMarketingPausedInProdSecrets(read = defaultRead) {
  return truthy(read("X_MARKETING_POSTS_PAUSED"));
}

/** Skip ops-collect / watchdog paging for this cron key when X marketing is paused. */
export function isXMarketingCronSuppressed(jobKey, read = defaultRead) {
  if (!X_MARKETING_CRON_KEYS.has(jobKey)) return false;
  if (truthy(read("X_MARKETING_POSTS_PAUSED"))) return true;
  if (jobKey === "x-replies" && truthy(read("X_MENTION_REPLIES_PAUSED"))) return true;
  return false;
}
