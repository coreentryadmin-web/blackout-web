/** Standing operator policy: X marketing crons are OFF unless explicitly re-enabled. */
import { loadProdSecretsFromAws } from "./prod-secrets.mjs";

export const X_MARKETING_CRON_KEYS = new Set([
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

/** True when prod Secrets Manager has X marketing intentionally paused. */
export function xMarketingPausedInProdSecrets() {
  return truthy(secretVal("X_MARKETING_POSTS_PAUSED"));
}

/** Skip ops-collect / watchdog paging for this cron key when X marketing is paused. */
export function isXMarketingCronSuppressed(jobKey) {
  if (!X_MARKETING_CRON_KEYS.has(jobKey)) return false;
  if (truthy(secretVal("X_MARKETING_POSTS_PAUSED"))) return true;
  if (jobKey === "x-replies" && truthy(secretVal("X_MENTION_REPLIES_PAUSED"))) return true;
  return false;
}
