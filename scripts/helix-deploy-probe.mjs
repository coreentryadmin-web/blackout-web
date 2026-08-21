import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
const BASE = "https://blackouttrades.com";
const s = await mintAppSession({ appUrl: BASE });
if (s.skip) { console.error("auth skip", s.reason); process.exit(2); }
// #2530 discriminator: summary.bySignalType present?
const r = await fetchRetry(`${BASE}/api/market/helix/signal-outcomes`, { headers: { Cookie: s.cookieHeader } }, { retries: 1, timeoutMs: 30000 });
const b = await r.json().catch(() => ({}));
const sum = b?.summary ?? null;
console.log("status", r.status);
console.log("summary keys:", sum ? Object.keys(sum).join(", ") : "(no summary)");
console.log("#2530 bySignalType present:", sum && "bySignalType" in sum ? "YES (deployed)" : "NO (old code live)");
if (sum?.bySignalType) console.log("  bySignalType entries:", sum.bySignalType.length);
await s.cleanup?.();
