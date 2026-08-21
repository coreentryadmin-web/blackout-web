/**
 * Every member-facing page, opened for real, judged on what a member would actually see.
 *
 * WHY THIS AND NOT THE HTTP SWEEP. `exhaustive-platform-audit.mjs` proves each route returns 200 and
 * that its JSON carries no NaN. Neither fact means the page WORKS: a desk that 200s and then throws
 * during hydration renders a blank panel, and a number that is finite in JSON still reads as
 * "undefined" once a formatter has been handed the wrong field. Both of those are invisible to a
 * status code and obvious to anyone looking at the screen. So this opens the page in a real browser,
 * lets it settle, and then asks the DOM three questions the HTTP sweep cannot:
 *
 *   1. Did the page throw? Console errors, uncaught page errors, and failed sub-requests are
 *      collected per page. React hydration failures (#418/#419/#423) are called out separately,
 *      because they do not break the page loudly — they silently discard the server HTML and
 *      re-render, which is how a panel ends up empty on one load and fine on the next. Production's
 *      error sink shows #418 firing on /dashboard and /vector every few hours right now.
 *   2. Does the rendered TEXT contain a malformed value? `NaN`, `undefined`, `$NaN`, `null%`,
 *      `Invalid Date`, `[object Object]` — scanned against innerText, i.e. the pixels, not the
 *      payload. This is the only check in the repo that sees a formatter bug on the way OUT.
 *   3. Did the panels this page exists to show actually paint? Each page declares markers; a page
 *      that loads its shell and none of its content is a product failure that a 200 hides.
 *
 * Plus a horizontal-overflow check at phone width, because a desk that scrolls sideways on a phone
 * is broken for the largest slice of the audience and nothing else in the suite looks for it.
 *
 * WHY THE MARKERS ARE CHECKED AFTER A SETTLE AND NOT IMMEDIATELY. These desks stream. Asserting on
 * first paint would report every live panel as missing — a harness fault that reads exactly like a
 * product outage, which has cost this investigation time before. Markers are polled until present or
 * the budget expires, and the elapsed time is reported so a slow panel is visible as slow rather
 * than absent.
 *
 * Chromium in this sandbox cannot reach the network directly (see docs/audit/LIVE-UI-CONNECTION.md),
 * so every request is fulfilled through the CONNECT tunnel in lib/proxy-tunnel-context.cjs.
 *
 * Read-only. ONE temp Clerk user, refreshed between pages, deleted in a `finally`. Never prints
 * secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/desk-page-panel-crawl.cjs \
 *     [--pages=dashboard,vector] [--viewport=1440x900] [--phone] [--out=DIR] [--json]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext, applyCookieToContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const OUT = arg("out", "audit-output/desk-crawl");
const JSON_OUT = argv.includes("--json");
const PHONE = argv.includes("--phone");
const VIEWPORT = arg("viewport", PHONE ? "430x932" : "1440x900");
const SETTLE_MS = Number(arg("settle", "14000"));
// 35s, not 20s. A compare deep-link (/vector?compare=SPY,QQQ) cold-paints its canvas at ~26s
// against production — two panes, two chains, two bead rails, none of it warm. A 20s budget
// reported that as "canvas never painted", which reads as a broken deep link and is not one.
// The budget exists to bound a hang, not to assert a latency target; slow is reported as the
// elapsed time in the PASS line, where it belongs.
const MARKER_BUDGET_MS = Number(arg("marker-budget", "35000"));

/**
 * The pages a paying member can reach, and the panels each one exists to show.
 *
 * Markers are CSS selectors OR `text:<substring>`. They are deliberately coarse — this asks "did the
 * product paint", not "is every pixel right"; a marker tight enough to break on a copy change would
 * turn this crawl into a source of false alarms and it would stop being run.
 */
const PAGES = [
  {
    key: "dashboard",
    path: "/dashboard",
    what: "SPX Slayer desk (the default member landing)",
    markers: ["canvas", "text:SPX"],
  },
  { key: "vector", path: "/vector", what: "Vector chart desk", markers: ["canvas"] },
  {
    key: "vector-compare",
    path: "/vector?compare=SPY,QQQ",
    what: "Vector compare mode",
    markers: ["canvas"],
  },
  { key: "nighthawk", path: "/nighthawk", what: "Night Hawk 0DTE board", markers: ["text:0DTE"] },
  // /terminal is the LARGO AI desk, not a chart — it has no canvas by design. Asserting one here
  // reported a working page as broken on the first run of this harness, which is exactly the
  // false alarm that gets a check deleted. Markers must describe what the page actually renders.
  { key: "terminal", path: "/terminal", what: "Largo AI terminal", markers: ["text:LARGO"] },
  { key: "flows", path: "/flows", what: "Helix options flow", markers: ["text:HELIX"] },
  { key: "heatmap", path: "/heatmap", what: "Thermal / GEX heatmap", markers: ["canvas, table, svg"] },
  { key: "track-record", path: "/track-record", what: "Public track record", markers: ["text:track"] },
  { key: "account", path: "/account", what: "Account / billing", markers: ["text:account"] },
  { key: "admin", path: "/admin", what: "Admin console", markers: ["text:admin"] },
  { key: "admin-track-record", path: "/admin/track-record", what: "Admin track record", markers: [] },
  { key: "admin-users", path: "/admin/users", what: "Admin users", markers: [] },
];

/**
 * Malformed values as a MEMBER sees them.
 *
 * Word-boundary anchored so a legitimate word containing the token ("undefinedBehaviour" in prose,
 * a ticker with "NaN" inside it) does not trip the scan. `$NaN` and `null%` are listed separately
 * from bare NaN/null because those two shapes are unambiguous formatter bugs — a currency or percent
 * formatter handed a non-number — and deserve to be named as such in the report rather than folded
 * into a generic count.
 */
const MALFORMED = [
  { re: /\bNaN\b/g, label: "NaN" },
  { re: /\bundefined\b/g, label: "undefined" },
  { re: /\[object Object\]/g, label: "[object Object]" },
  { re: /\$NaN/g, label: "$NaN" },
  { re: /\bnull%/g, label: "null%" },
  { re: /Invalid Date/g, label: "Invalid Date" },
  { re: /\bNaN%/g, label: "NaN%" },
];

/** Text a member should never see on a working page. */
const FATAL_TEXT = [
  "Application error: a client-side exception",
  "Something went wrong",
  "We couldn't load this page",
  "This page could not be found",
  "Internal Server Error",
];

const results = [];
function rec(page, status, check, detail, extra = {}) {
  results.push({ page, status, check, detail, ...extra });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  console.log(`  ${icon} [${status}] ${page} · ${check}${detail ? ` — ${detail}` : ""}`);
}

/** Wait until every marker is present, or the budget expires. Returns which ones never showed. */
async function awaitMarkers(page, markers, budgetMs) {
  const missing = new Set(markers);
  const t0 = Date.now();
  while (missing.size && Date.now() - t0 < budgetMs) {
    for (const m of [...missing]) {
      let found = false;
      if (m.startsWith("text:")) {
        // Case-INSENSITIVE. These desks style headings with `text-transform: uppercase`, and
        // innerText returns the transformed case — so a marker of "Flow" missed a page whose
        // heading rendered "FLOW ANOMALIES DETECTED". The page was fine; the harness was wrong.
        const needle = m.slice(5).toLowerCase();
        found = await page
          .evaluate((n) => (document.body?.innerText ?? "").toLowerCase().includes(n), needle)
          .catch(() => false);
      } else {
        found = await page.$(m).then((el) => Boolean(el)).catch(() => false);
      }
      if (found) missing.delete(m);
    }
    if (missing.size) await page.waitForTimeout(700);
  }
  return { missing: [...missing], ms: Date.now() - t0 };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = arg("pages", "");
  const selected = only
    ? PAGES.filter((p) => only.split(",").map((s) => s.trim()).includes(p.key))
    : PAGES;

  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  const { browser, ctx } = await createTunneledContext({
    url: `${BASE}/dashboard`,
    cookie: session.cookieHeader,
    viewport: VIEWPORT,
    desktop: !PHONE,
    requestTimeoutMs: 60_000,
  });

  console.log(`DESK PAGE + PANEL CRAWL — ${BASE} @ ${VIEWPORT}${PHONE ? " (phone)" : ""}`);
  console.log("");

  try {
    for (const spec of selected) {
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      let page;
      try {
        // Re-mint per page: a Clerk session JWT is short-lived and this crawl runs for minutes. A
        // lapsed cookie bounces the navigation into sign-in, which the tunnel cannot complete — the
        // page then dies as ERR_TOO_MANY_REDIRECTS and reads as "that desk is broken".
        const fresh = await session.refresh?.();
        if (fresh?.cookieHeader) await applyCookieToContext(ctx, fresh.cookieHeader, `${BASE}${spec.path}`);

        page = await ctx.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
        });
        page.on("pageerror", (err) => pageErrors.push(String(err?.message || err).slice(0, 300)));
        page.on("requestfailed", (req) => {
          const f = req.failure()?.errorText ?? "";
          // Aborted streams are how SSE/long-poll connections end when a page closes — not failures.
          if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) return;
          failedRequests.push(`${req.method()} ${req.url().slice(0, 120)} — ${f}`);
        });

        const resp = await page.goto(`${BASE}${spec.path}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const status = resp?.status() ?? 0;
        if (status >= 400) {
          rec(spec.key, "FAIL", "navigation", `HTTP ${status} on ${spec.path}`);
          await page.close().catch(() => undefined);
          continue;
        }

        await page.waitForTimeout(SETTLE_MS);
        const marker = await awaitMarkers(page, spec.markers, MARKER_BUDGET_MS);

        const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        const shot = path.join(OUT, `${spec.key}${PHONE ? "-phone" : ""}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);

        // 1. Fatal text
        // Case-insensitive: the desk error boundary uppercases its eyebrow via CSS, so a literal
        // match on "Something went wrong" silently missed a page that was rendering exactly that.
        const lower = text.toLowerCase();
        const fatal = FATAL_TEXT.filter((f) => lower.includes(f.toLowerCase()));
        if (fatal.length) rec(spec.key, "FAIL", "rendered-error", fatal.join("; "), { shot });

        // 2. Malformed VALUES in the rendered text
        const bad = [];
        for (const { re, label } of MALFORMED) {
          re.lastIndex = 0;
          const m = text.match(re);
          if (m?.length) bad.push(`${label}×${m.length}`);
        }
        if (bad.length) rec(spec.key, "FAIL", "malformed-values", bad.join(", "), { shot });
        else rec(spec.key, "PASS", "malformed-values", "clean");

        // 3. Panels painted
        if (spec.markers.length) {
          if (marker.missing.length) {
            rec(spec.key, "FAIL", "panels", `never painted: ${marker.missing.join(", ")} (${Math.round(marker.ms / 1000)}s)`, { shot });
          } else {
            rec(spec.key, "PASS", "panels", `all painted in ${Math.round(marker.ms / 1000)}s`);
          }
        }

        // 4. Hydration — the silent one. React ships these minified, so match the error NUMBER.
        const hydration = [...consoleErrors, ...pageErrors].filter((e) =>
          /Minified React error #(418|419|423|425)|Hydration failed|did not match/i.test(e)
        );
        if (hydration.length) {
          rec(spec.key, "FAIL", "hydration", `${hydration.length} — ${hydration[0].slice(0, 150)}`, { shot });
        }

        // 5. Everything else the console said.
        //
        // 401s are excluded: this harness holds ONE Clerk session and a slow page can outlive the
        // ~72s JWT, after which every in-flight fetch 401s. That is our credential expiring, not the
        // product failing — a 26s compare page produced eighteen of them and they would read as a
        // desk-wide auth outage. Genuine auth defects surface as a failed NAVIGATION (handled above
        // as a 4xx or a sign-in redirect), not as a burst of XHR 401s late in a long page.
        const authNoise = /status of 401|Unauthorized/i;
        const otherErrors = [...consoleErrors, ...pageErrors]
          .filter((e) => !hydration.includes(e))
          .filter((e) => !authNoise.test(e));
        const suppressed = [...consoleErrors, ...pageErrors].filter((e) => authNoise.test(e)).length;
        if (otherErrors.length) {
          rec(spec.key, "WARN", "console", `${otherErrors.length} error(s) — ${otherErrors[0].slice(0, 150)}`);
        } else if (!hydration.length) {
          rec(spec.key, "PASS", "console", suppressed ? `no errors (${suppressed} session-expiry 401s ignored)` : "no errors");
        }

        if (failedRequests.length) {
          rec(spec.key, "WARN", "requests", `${failedRequests.length} failed — ${failedRequests[0]}`);
        }

        // 6. Horizontal overflow — a desk that scrolls sideways is broken on a phone.
        const overflow = await page
          .evaluate(() => {
            const d = document.documentElement;
            return { scroll: d.scrollWidth, client: d.clientWidth };
          })
          .catch(() => null);
        if (overflow && overflow.scroll > overflow.client + 2) {
          rec(spec.key, "FAIL", "overflow-x", `body scrolls ${overflow.scroll}px in a ${overflow.client}px viewport`, { shot });
        } else if (overflow) {
          rec(spec.key, "PASS", "overflow-x", "no horizontal scroll");
        }
      } catch (e) {
        rec(spec.key, "FAIL", "crawl", String(e?.message || e).slice(0, 200));
      } finally {
        await page?.close().catch(() => undefined);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  console.log("");
  console.log(`SUMMARY ${JSON.stringify(tally)}  |  shots in ${OUT}`);
  if (JSON_OUT) {
    const f = path.join(OUT, `crawl${PHONE ? "-phone" : ""}.json`);
    fs.writeFileSync(f, JSON.stringify({ base: BASE, viewport: VIEWPORT, phone: PHONE, results }, null, 2));
    console.log(`report: ${f}`);
  }
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
})().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
