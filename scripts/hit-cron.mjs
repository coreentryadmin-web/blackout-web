// Cron trigger for Railway cron services.
// Calls a /api/cron/* endpoint on the deployed web app with the Bearer secret,
// then exits — exactly the run-to-completion behavior a cron service needs.
//
// Usage:  node scripts/hit-cron.mjs /api/cron/db-cleanup
// Env:    CRON_SECRET            (required) — same value as on blackout-web
//         CRON_TARGET_BASE_URL   (optional) — defaults to https://blackouttrades.com
//         CRON_HTTP_TIMEOUT_MS   (optional) — request timeout, defaults to 60000 (60s)
//
// Uses only Node stdlib + global fetch (Node 18+), so the cron service does NOT
// need the Next.js app build or node_modules.

const path = process.argv[2];
if (!path) {
  console.error("[hit-cron] usage: node scripts/hit-cron.mjs <endpoint-path>");
  process.exit(1);
}

const base = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("[hit-cron] CRON_SECRET is not set on this service");
  process.exit(1);
}

const url = `${base}${path}`;

// Abort a hung cron endpoint instead of hanging the trigger forever.
const timeoutMs = Number(process.env.CRON_HTTP_TIMEOUT_MS ?? 60_000) || 60_000;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    signal: controller.signal,
  });
  const body = await res.text();
  console.log(`[hit-cron] ${path} -> ${res.status}`);
  console.log(body.slice(0, 2000));
  if (!res.ok) process.exit(1);
} catch (err) {
  if (err?.name === "AbortError") {
    console.error(`[hit-cron] ${path} request timed out after ${timeoutMs}ms`);
  } else {
    console.error(`[hit-cron] ${path} request failed:`, err);
  }
  process.exit(1);
} finally {
  clearTimeout(timer);
}
