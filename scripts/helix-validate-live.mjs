import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
const BASE = "https://blackouttrades.com";
const s = await mintAppSession({ appUrl: BASE });
if (s.skip) { console.error("auth skip", s.reason); process.exit(2); }
const r = await fetchRetry(`${BASE}/api/market/helix/signal-outcomes`, { headers: { Cookie: s.cookieHeader } }, { retries: 1, timeoutMs: 30000 });
const b = await r.json().catch(() => ({}));
const sum = b?.summary;
console.log("=== #2530 bySignalType (each type its own denominator) ===");
console.log("aggregate: graded", sum.gradedCount, "winRatePct", sum.winRatePct, "min", 10);
for (const t of sum.bySignalType) {
  console.log(`  ${t.signal_type}: graded=${t.gradedCount} continued=${t.continuedCount} flat=${t.flatCount} reversed=${t.reversedCount} rate=${t.winRatePct} (null below 10)`);
}
const perTypeSum = sum.bySignalType.reduce((n,t)=>n+t.gradedCount,0);
console.log("  per-type graded sum =", perTypeSum, "vs aggregate", sum.gradedCount, perTypeSum===sum.gradedCount?"✓ reconciles":"✗ MISMATCH");
console.log("=== #2509 discriminator: do rows carry fired_session? ===");
const row0 = (b.rows||[])[0];
console.log("  row keys:", row0 ? Object.keys(row0).join(", ") : "(no rows)");
console.log("  fired_session present:", row0 && "fired_session" in row0 ? "YES" : "NO (route may not expose it; Largo tool does)");
await s.cleanup?.();
