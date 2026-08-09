/** Mints ONE temp Clerk member, hands the cookie to _deep-render.cjs, deletes the user. */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { spawnSync } from "node:child_process";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) { console.error(`SKIP: ${session.reason}`); process.exit(2); }
try {
  const r = spawnSync("node", ["scripts/audit/lib/deep-render.cjs"], {
    stdio: "inherit",
    env: { ...process.env, AUDIT_COOKIE: session.cookieHeader },
    timeout: 1_500_000,
  });
  process.exitCode = r.status ?? 1;
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}
