/**
 * Navigation soak — logs in once as a real member, then walks the desk repeatedly for N minutes,
 * recording every non-200 and every response whose HTML carries the error-boundary copy.
 *
 * Built to chase an operator report of "We couldn't load this page" appearing intermittently while
 * navigating the desk (2026-08-08). Because the failure is intermittent, this measures a RATE over
 * many requests rather than trying to catch it once.
 *
 * ⚠️  READ THIS BEFORE TRUSTING A GREEN RUN.
 *
 * This probe operates at the HTTP layer. The error page in question is a CLIENT-SIDE React error
 * boundary that fires AFTER hydration — a component throwing, a failed SWR/SSE fetch, a chunk
 * import rejecting mid-navigation. All of those return a perfectly good 200 with correct HTML, so
 * this harness cannot see them. A clean run rules out server-render and routing failures. It does
 * NOT mean the reported bug is absent.
 *
 * First run 2026-08-08: 1013 requests over 6 minutes across 10 desk pages, 0 failures; a companion
 * RSC-payload probe returned 120/120 200s. Both clean, and the operator's bug was still real —
 * which is precisely the limitation above, recorded so the next person doesn't misread a green run
 * as an all-clear.
 *
 * To catch the actual client-side error, use the app's own /api/telemetry/client-error reporting,
 * or drive a real browser via proxy-browser.cjs (see docs/audit/LIVE-UI-CONNECTION.md) and capture
 * console errors + failed requests during client-side navigation.
 *
 * Usage (from the repo root):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     npx tsx scripts/audit/nav-soak.mjs --minutes=6
 *
 * Read-only. One temp Clerk user, always released in a finally. Never prints secrets.
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = "https://blackouttrades.com";
const MINUTES = Number(process.argv.find((a) => a.startsWith("--minutes="))?.slice(10) ?? 6);
const PATHS = [
  "/dashboard", "/nighthawk", "/terminal", "/vector", "/flows", "/heatmap",
  "/account", "/pricing", "/learn", "/track-record",
];
// The error boundary's own copy — present in the served HTML when the failure is server-side.
const BOUNDARY = /We couldn't load this page|SOMETHING WENT WRONG/i;

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.log("SKIP:", session.reason);
  process.exit(0);
}

const stats = new Map();
const failures = [];
const deadline = Date.now() + MINUTES * 60_000;
let n = 0;

try {
  while (Date.now() < deadline) {
    for (const path of PATHS) {
      if (Date.now() >= deadline) break;
      const t0 = Date.now();
      let status = 0, boundary = false, err = null, rev = "";
      try {
        const r = await fetch(BASE + path, {
          headers: { Cookie: session.cookieHeader, "User-Agent": "BlackOutNavSoak/1.0" },
          redirect: "manual",
        });
        status = r.status;
        rev = r.headers.get("x-nextjs-prerender") ?? r.headers.get("cf-ray") ?? "";
        if (status === 200) {
          const html = await r.text();
          boundary = BOUNDARY.test(html);
        }
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const ms = Date.now() - t0;
      n++;
      const s = stats.get(path) ?? { n: 0, bad: 0, maxMs: 0 };
      s.n++;
      s.maxMs = Math.max(s.maxMs, ms);
      const bad = err != null || (status !== 200 && status !== 307 && status !== 308) || boundary;
      if (bad) {
        s.bad++;
        failures.push({ path, status, boundary, err, ms, rev, at: new Date().toISOString() });
        console.log(`  FAIL ${path} status=${status} boundary=${boundary} ms=${ms} ${err ?? ""} ray=${rev}`);
      }
      stats.set(path, s);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
} finally {
  await session.cleanup?.().catch(() => {});
}

console.log(`\n=== ${n} requests over ~${MINUTES}m ===`);
for (const [path, s] of [...stats].sort((a, b) => b[1].bad - a[1].bad)) {
  console.log(`  ${String(s.bad).padStart(3)}/${String(s.n).padStart(3)} bad  maxMs=${String(s.maxMs).padStart(6)}  ${path}`);
}
console.log(`\ntotal failures: ${failures.length}/${n} (${((failures.length / n) * 100).toFixed(1)}%)`);
if (failures.length) {
  const byStatus = {};
  for (const f of failures) {
    const k = f.err ? `err:${f.err.slice(0, 60)}` : f.boundary ? `200+boundary` : `http ${f.status}`;
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  console.log("failure modes:", JSON.stringify(byStatus, null, 1));
}
