/**
 * DEEP LIVE-UI AUDIT — every page, rendered, desktop AND phone.
 *
 * `site-sweep.mjs` proves the SERVER returns a page. This proves the BROWSER can render it: a 200
 * whose JS throws, whose panels never leave their loading state, or which scrolls sideways on a
 * phone is a broken page that every HTTP-level check calls healthy.
 *
 * WHAT IT ASSERTS, per page per viewport:
 *   - zero FIRST-PARTY console errors and pageerrors (third-party analytics noise is collected and
 *     printed but never scored — the tunnel cannot replay a sendBeacon Blob, so counting it would
 *     make every run fail regardless of product health, and an audit that always fails trains its
 *     reader to skip the result);
 *   - no first-party request failing with 4xx/5xx;
 *   - the page reached real content rather than parking on a spinner — checked by POLLING for a
 *     terminal state, never by sampling at a fixed time (a fixed 18s sample caught the GEX ladder
 *     mid-"Loading…" earlier today and would have been filed as a broken feature);
 *   - no horizontal body overflow on a 430px phone, which is the single most common way a desk
 *     page breaks for the half of members on mobile.
 *
 * WHY THE TUNNEL. Chromium in this sandbox has no network at all — direct, `proxy:{server}` and
 * `--proxy-server` all fail identically with ERR_CONNECTION_RESET while curl through the same proxy
 * returns 200. A plain-Playwright failure here proves nothing but the egress block. See
 * docs/audit/LIVE-UI-CONNECTION.md.
 *
 * Read-only. ONE Clerk session for the whole run, released in a finally — never a standing
 * credential on prod.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/live-ui-deep-audit.mjs \
 *     [--pages=/vector,/heatmap] [--desktop-only] [--json]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { probeGeometry } from "./lib/ui-geometry-probe.mjs";
import { keepSessionAlive, isAuthExpiry } from "./lib/ui-session-keepalive.mjs";

const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const desktopOnly = args.includes("--desktop-only");
const BASE = flag("base", "https://blackouttrades.com");
const OUT = flag("out", "/tmp/live-ui-audit");
const PAGES = flag(
  "pages",
  "/nighthawk,/terminal,/vector,/flows,/heatmap,/dashboard,/track-record,/account,/pricing,/learn"
).split(",").map((p) => p.trim()).filter(Boolean);

/** How long a panel may sit in a loading state before that IS the finding. */
const SETTLE_TIMEOUT_MS = 45_000;

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

/** Third-party noise the tunnel cannot faithfully replay. Collected, never scored. */
const THIRD_PARTY =
  /google-analytics|googletagmanager|doubleclick|analytics\.twitter|\bt\.co\b|clarity\.ms|cdn-cgi\/rum|facebook|hotjar|segment\.(io|com)|sentry|posthog|intercom|stripe/i;

/** Copy that means "still working", i.e. NOT a terminal state. */
const LOADING = /Loading|Fetching|Please wait|Connecting|Warming/i;
/** Copy that means the page gave up. A rendered error is worse than a slow one. */
const BROKEN = /Application error|client-side exception|Something went wrong|Failed to load|Unable to load/i;

async function auditPage(session, path, device) {
  const url = `${BASE}${path}`;
  const { browser, ctx, counts } = await createTunneledContext({
    url,
    viewport: device.viewport,
    desktop: device.desktop,
    cookie: session.cookieHeader,
  });
  const tag = `${path} [${device.name}]`;
  // The minted __session JWT is dead ~72s after issue (measured — see lib/ui-session-keepalive.mjs).
  // Without this the run goes unauthenticated part-way through and every later page reports its
  // signed-out empty state as a product defect.
  const stopKeepAlive = keepSessionAlive(ctx, session, new URL(BASE).hostname, (e) =>
    note("WARN", `${tag}: session keep-alive failed — ${e}`)
  );
  try {
    const page = await ctx.newPage();
    // The desk holds a per-second SSE stream open; the tunnel never sees it end, so a navigation
    // that waits on network-idle would hang forever. Block the stream and rely on polling below.
    await page.route("**/api/market/vector/stream**", (r) => r.abort());

    const consoleErrors = [];
    const thirdPartyNoise = [];
    const failedRequests = [];
    /** 401/403 on a first-party URL: the run's credential expired, not a product defect. */
    const authExpired = [];
    // "Failed to load resource: net::ERR_FAILED" carries NO url, so it cannot be attributed — and
    // the harness itself manufactures one of these by aborting the SSE route above. Dropping the
    // line loses nothing: a resource that fails to load is already measured, with its URL, by the
    // `response`/`requestfailed` handlers below. Scoring the URL-less duplicate only produced a
    // FAIL on every page that opens a stream, which is a harness artifact wearing a bug's clothes.
    const URL_LESS_RESOURCE_ERROR = /^Failed to load resource/;
    const push = (t) => {
      if (URL_LESS_RESOURCE_ERROR.test(t)) return;
      (THIRD_PARTY.test(t) ? thirdPartyNoise : consoleErrors).push(t.slice(0, 180));
    };
    page.on("console", (m) => m.type() === "error" && push(m.text()));
    page.on("pageerror", (e) => push(`pageerror: ${String(e)}`));
    page.on("response", (r) => {
      if (r.status() < 400) return;
      const u = r.url();
      if (THIRD_PARTY.test(u)) return;
      // A 401/403 is the run's own credential dying, not the product failing. Routed separately so
      // an expired token cannot masquerade as a page full of broken panels — the exact confusion
      // that produced a false "GEX ladder unavailable" bug report in #1961.
      if (isAuthExpiry(r.status())) authExpired.push(u.replace(BASE, "").slice(0, 60));
      else failedRequests.push(`${r.status()} ${u.replace(BASE, "").slice(0, 90)}`);
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    } catch {
      // One retry — an in-flight ECS rollout is exactly the moment one connection dies and the
      // next succeeds. A nav failure is THIS page's problem, not the run's.
      await page.waitForTimeout(6_000);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      } catch (e) {
        note("WARN", `${tag}: navigation failed twice — ${String(e).slice(0, 90)}`, {
          routed: `${counts.ok} ok / ${counts.fail} fail`,
        });
        return;
      }
    }

    // POLL for a terminal state. Sampling at a fixed time measures the clock, not the page.
    let state = "loading";
    let text = "";
    const t0 = Date.now();
    while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
      text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      if (BROKEN.test(text)) { state = "broken"; break; }
      if (text.length > 400 && !LOADING.test(text)) { state = "ready"; break; }
      await page.waitForTimeout(1_500);
    }

    if (state === "broken") {
      note("FAIL", `${tag}: page rendered an ERROR state`, { sample: (text.match(BROKEN) ?? [""])[0] });
    } else if (state === "loading") {
      // Distinguish "still spinning" from "genuinely empty" — they need different fixes and
      // reporting them as one sends the reader to the wrong layer.
      note(
        "FAIL",
        `${tag}: never left a loading state in ${SETTLE_TIMEOUT_MS / 1000}s (${text.length} chars of body text)`,
        { spinner: (text.match(LOADING) ?? [""])[0] || "(none — body just stayed thin)" }
      );
    } else {
      note("PASS", `${tag}: rendered (${text.length} chars)`);
    }

    if (consoleErrors.length > 0) {
      note("FAIL", `${tag}: ${consoleErrors.length} first-party console error(s)`, {
        errors: [...new Set(consoleErrors)].slice(0, 3),
      });
    }
    if (failedRequests.length > 0) {
      note("FAIL", `${tag}: ${failedRequests.length} failed first-party request(s)`, {
        requests: [...new Set(failedRequests)].slice(0, 4),
      });
    }
    if (authExpired.length > 0) {
      // WARN, not FAIL: it invalidates THIS page's evidence rather than indicting the product. Said
      // out loud because a silent auth expiry turns the rest of the run into confident nonsense.
      note("WARN", `${tag}: ${authExpired.length} request(s) 401/403 — audit session expired, findings here are unreliable`, {
        sample: [...new Set(authExpired)].slice(0, 3),
      });
    }
    if (thirdPartyNoise.length > 0 && !asJson) {
      console.log(`        (${thirdPartyNoise.length} third-party console lines — collected, not scored)`);
    }

    // ── GEOMETRY ────────────────────────────────────────────────────────────────────────────
    // Two defects found by staring at screenshots on 2026-08-12 — the GEX ladder's reset button
    // rendering 17.5px outside an `overflow: hidden` rail, and the iOS tool label printing under
    // the hamburger. Both were plainly visible and both had been shipping for weeks, because
    // "someone looks at a screenshot" is not a process. These predicates are that process; they
    // live in lib/ui-geometry-probe.mjs so the interaction audit runs the SAME ones.
    const geometry = await probeGeometry(page);
    if (geometry.clipped.length) {
      note("FAIL", `${tag}: ${geometry.clipped.length} element(s) CLIPPED by an overflow:hidden box`, {
        clipped: geometry.clipped.slice(0, 4),
      });
    }
    if (geometry.collide.length) {
      note("FAIL", `${tag}: ${geometry.collide.length} text/control COLLISION(s)`, {
        collisions: geometry.collide.slice(0, 4),
      });
    }

    // Horizontal overflow: the most common way a desk page breaks on a phone, and invisible to
    // every server-side check.
    if (!device.desktop) {
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return { scrollW: d.scrollWidth, clientW: d.clientWidth };
      }).catch(() => null);
      if (overflow && overflow.scrollW > overflow.clientW + 2) {
        note("FAIL", `${tag}: body scrolls HORIZONTALLY (${overflow.scrollW}px in ${overflow.clientW}px)`);
      }
    }

    await page.screenshot({ path: join(OUT, `${path.replace(/\W+/g, "_") || "root"}-${device.name}.png`) });
  } finally {
    stopKeepAlive();
    await browser.close().catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP — ${session.reason}`);
    process.exit(0);
  }
  const devices = desktopOnly
    ? [{ name: "desktop", viewport: "1440x1000", desktop: true }]
    : [
        { name: "desktop", viewport: "1440x1000", desktop: true },
        { name: "phone", viewport: "430x932", desktop: false },
      ];
  try {
    for (const p of PAGES) {
      if (!asJson) console.log(`\n═══ ${p}`);
      for (const d of devices) await auditPage(session, p, d);
    }
  } finally {
    await session.cleanup?.();
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  const rendered = findings.some((f) => /rendered \(/.test(f.msg));
  const verdict = !rendered
    ? "NO EVIDENCE GATHERED — no page rendered; this run proves nothing"
    : fails.length > 0
      ? `${fails.length} FAILURES across ${PAGES.length} pages`
      : `ALL ${PAGES.length} PAGES CLEAN`;
  if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, findings }, null, 2));
  else console.log(`\n${"═".repeat(70)}\n${verdict}\nScreenshots: ${OUT}`);
  process.exit(fails.length > 0 || !rendered ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL ${String(e)}`);
  process.exit(2);
});
