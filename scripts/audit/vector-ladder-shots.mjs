/**
 * Capture /vector on a STOCK at several wall-count settings, to see the GEX ladder's spot anchor
 * and the new wall-rows toggle in the real UI.
 *
 * Deliberately a stock, not SPX: the reported "spot sits too low, I have to scroll" problem is a
 * stock problem. SPX's SSR-seeded spot and its live spot are close enough that the ladder's
 * centre-once-per-ticker guard lands in roughly the right place anyway.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (Clerk FAPI is
 * rate-limited — authenticate once).
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { execFileSync } from "node:child_process";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = process.env.SHOT_OUT || ".";
const TICKER = process.env.SHOT_TICKER || "NVDA";

const SHOTS = [
  ["auto", { "blackout.vector.wallCount.v1": "auto" }],
  ["cap4", { "blackout.vector.wallCount.v1": "4" }],
];

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.error(`SKIP: ${session.reason}`);
  process.exit(2);
}

try {
  for (const [label, seed] of SHOTS) {
    const out = `${OUT}/vector-${TICKER}-${label}.png`;
    try {
      const log = execFileSync(
        "node",
        [
          "proxy-browser.cjs",
          `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`,
          out,
          "--cookie", session.cookieHeader,
          "--viewport", "1680x1050",
          "--desktop",
          "--seed-storage", JSON.stringify(seed),
          "--wait", "16000",
        ],
        { encoding: "utf8", timeout: 300000 }
      );
      // A non-zero fail count means assets did not load and the page rendered half-empty — the
      // screenshot would be worthless and a comparison between shots meaningless.
      const routed = log.match(/Routed:\s*(\d+)\s*ok,\s*(\d+)\s*fail/);
      console.log(`${label}: ${out} — ${routed ? routed[0] : "NO ROUTING LINE"}`);
    } catch (e) {
      console.error(`${label}: FAILED — ${String(e.message).slice(0, 400)}`);
    }
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}
