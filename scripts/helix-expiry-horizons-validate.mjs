#!/usr/bin/env node
/**
 * Live validation of the deployed expiry_horizons payload (coordinator request).
 * Forces Largo to enumerate EVERY horizon bucket + the truncation flag, so the four-untruncatable-
 * buckets-with-call/put-split property is checked against production, not asserted.
 */
import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const Q =
  "Break down the HELIX SPX flow tape by expiry HORIZON. List EVERY horizon bucket (0DTE, this week, monthly, LEAPS) with its premium, alert count, and call/put split — and explicitly tell me whether any expiry buckets were dropped or truncated, and how you know.";

const session = await mintAppSession({ appUrl: BASE });
if (session.skip) { console.error("auth skip:", session.reason); process.exit(2); }

const res = await fetchRetry(
  `${BASE}/api/market/largo/query`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: session.cookieHeader },
    body: JSON.stringify({ question: Q, session_id: `helix-horizons-${process.pid}` }),
  },
  { retries: 1, timeoutMs: 120_000 }
);
const body = await res.json().catch(() => ({}));
console.log(`[${res.status} src=${body?.source ?? "?"}]\n${"-".repeat(80)}\n${body?.answer || "(empty)"}`);
await session.cleanup?.();
