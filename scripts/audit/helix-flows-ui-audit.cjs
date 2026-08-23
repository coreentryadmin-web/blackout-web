/**
 * HELIX /flows LIVE UI AUDIT — the pixels half of the verification gap.
 *
 * WHY THIS EXISTS. `docs/audit/HELIX-MAP.md` §10 records that HELIX had NO UI harness at all:
 * `helix-tape-inventory.mjs` covers the DATA (what the API serves), and nothing covered what a
 * member actually sees. That gap is not theoretical — this lane just shipped a fix to the Route
 * Breakdown panel (§9.8) with no way to confirm on production that the panel renders the new
 * buckets. "Merged is not done, deployed is not done, only LIVE-VALIDATED is done" is unenforceable
 * without an instrument.
 *
 * THE PAGE-LOADED GATE, AND WHY IT COMES FIRST. A blank render, a 404 and an auth bounce all
 * produce "the Route Breakdown panel is missing" — which reads as a product defect when it is a
 * harness failure. So every run first proves the HELIX shell itself painted (brand mark + the tape
 * container, both long-shipped). If that gate fails the verdict is **HARNESS**, never RED, and no
 * panel assertion is even attempted. Same rule for a probe that returns `undefined`: "the probe
 * never ran" must never read as "clean" (the trap `meridian-interaction-audit.mjs` encodes).
 *
 * WHAT IT ASSERTS, per viewport — the things whose absence means a member sees something broken:
 *   - the tape painted rows;
 *   - the freshness badge is present and carries a readable age (an honest LIVE/STALE, not a
 *     permanently green light);
 *   - Route Breakdown, Net Premium and Expiry Concentration each painted with real content;
 *   - **no single Route Breakdown bucket holds ~all the tape** — the §9.8 signature, which is the
 *     one assertion that can confirm that fix on production rather than from the diff;
 *   - no console errors, no horizontal body overflow, no visible "unavailable/failed to load".
 *
 * WHAT IT CANNOT ASSERT — stated rather than implied:
 *   - SSE freshness. The tunnel is one-shot request/response and cannot stream (see
 *     proxy-tunnel-context.cjs), so the desk falls back to SWR polling. A "live push" claim is out
 *     of reach here.
 *   - Anything RTH-only. Off-hours the tape is frozen at the last close and a STALE badge is
 *     CORRECT, not a fault. Run it again with the market open before reading anything into age.
 *   - Visual correctness. It checks that things are THERE and not absurd, not that they are RIGHT.
 *
 * Chromium in this sandbox cannot reach the network at all — every request is fulfilled by Node
 * over a manual CONNECT tunnel. Read docs/audit/LIVE-UI-CONNECTION.md before changing anything
 * here, and look for `routed: N ok, 0 fail`: a non-zero fail count means assets never painted and
 * the run is not evidence.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a `finally`.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/helix-flows-ui-audit.cjs [--viewport=desktop|mobile|both] [--out=DIR] [--json]
 * Exits non-zero on any product failure; exit 3 on a HARNESS verdict (never confused with a pass).
 */
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
const {
  routeBucketVerdict,
  panelVerdict,
  freshnessVerdict,
  overallVerdict,
} = require("./lib/helix-ui-audit-eval.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const AS_JSON = argv.includes("--json");
const OUT = arg("out", process.env.SHOT_OUT || ".");
const WHICH = arg("viewport", "both");

const VIEWPORTS = [
  { id: "desktop", size: "1440x900", desktop: true },
  { id: "mobile", size: "430x932", desktop: false },
].filter((v) => WHICH === "both" || WHICH === v.id);

/** Every bucket `executionRouteKey` can now emit. Kept here so the harness can tell a REAL bucket
 *  from arbitrary panel text without importing TS into a CJS harness. */
const ROUTE_BUCKETS = [
  "SWEEP", "BLOCK", "SPLIT", "CROSS", "FLOOR", "MULTI", "GRENADE", "REPEAT", "OTHER", "UNREPORTED",
];

/**
 * One in-page probe. Returns a plain object, or `undefined` if it threw — the caller treats
 * `undefined` as HARNESS, never as a clean result.
 */
async function probe(page) {
  return page
    .evaluate((BUCKETS) => {
      const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const body = document.body;

      // ---- PAGE-LOADED GATE: long-shipped HELIX furniture, nothing this lane recently touched.
      const bodyText = text(body);
      const brand = /HELIX/i.test(bodyText);
      // The tape is a virtualized grid; its rows carry a ticker + a premium. Count anything that
      // looks like a print row rather than binding to one class name.
      const rowNodes = Array.from(document.querySelectorAll('[class*="flow-row"], [class*="helix-tape"] [role="row"], table tbody tr'));
      const tapeContainer = Boolean(
        document.querySelector('[class*="helix-tape"], [class*="flow-table"], [class*="flow-feed"]')
      );

      // ---- Panels, located by their visible heading rather than by class (markup churns; the
      // words a member reads do not).
      //
      // MUST NOT anchor on startsWith. Some panels render a KICKER before the title — Route
      // Breakdown's is "◇ execution" — so its container text begins with the kicker, not the
      // title. A startsWith locator found Net Premium (no kicker) and missed Route Breakdown and
      // Expiry Concentration (both kickered), then reported three PRODUCT failures on a page that
      // had rendered all three correctly. Search anywhere, then take the SMALLEST matching
      // container so the panel is returned rather than its ancestor (every ancestor up to <body>
      // also "contains" the title).
      const panelByTitle = (title) => {
        const all = Array.from(document.querySelectorAll("div,section,article"));
        const hits = all.filter((el) => text(el).includes(title));
        if (!hits.length) return null;
        return hits.reduce((best, el) => (text(el).length < text(best).length ? el : best), hits[0]);
      };

      /**
       * LOCATOR SELF-TEST, per panel. Two independent questions that a single "is it there?" check
       * conflates — and conflating them is how a broken locator reports a broken product:
       *   inBodyText — does the page contain this panel's title at all? (did it RENDER)
       *   located    — can the locator return a container for it?      (does the HARNESS work)
       * Rendered-but-unlocatable is a HARNESS fault, never a product verdict. This is the same
       * control discipline the truncation probe uses: an instrument that cannot be shown to work
       * does not get to return a clean result.
       */
      const panelState = (title) => {
        const inBodyText = bodyText.includes(title);
        const el = panelByTitle(title);
        return { title, inBodyText, located: Boolean(el), el };
      };

      const routePanel = panelByTitle("Route Breakdown");
      const routeText = text(routePanel);
      // Bucket label followed by its count and pct, e.g. "UNREPORTED 3500 70% $9.9B".
      const buckets = {};
      for (const b of BUCKETS) {
        const m = routeText.match(new RegExp(`\\b${b}\\b[^0-9]*([0-9,]+)\\s+([0-9]+)%`));
        if (m) buckets[b] = { count: Number(m[1].replace(/,/g, "")), pct: Number(m[2]) };
      }

      const routeState = panelState("Route Breakdown");
      const netState = panelState("Net Premium");
      const expiryState = panelState("Expiry Concentration");

      // ---- Freshness badge: the age string the desk renders ("42s ago" / "7m ago" / "3h ago").
      // `\s*`, not `\s+`, before "ago": the badge renders the number and the word in ADJACENT
      // elements, so textContent concatenates them with no separator ("28hago"). Requiring
      // whitespace reported "no freshness age rendered" against a badge that plainly reads
      // "500 · 28h ago" on screen — visible in the run's own screenshot.
      const ageMatch = bodyText.match(/\b(\d+)\s*(s|m|h)\s*ago\b/);

      // ---- Layout health.
      const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const badWords = /(something went wrong|failed to load|unavailable right now|application error)/i;
      const visibleError = badWords.test(bodyText) ? bodyText.match(badWords)[0] : null;

      return {
        gate: { brand, tapeContainer, rowCount: rowNodes.length },
        route: {
          present: routeState.located,
          inBodyText: routeState.inBodyText,
          buckets,
          bucketCount: Object.keys(buckets).length,
          raw: routeText.slice(0, 400),
        },
        netPremium: {
          present: netState.located, inBodyText: netState.inBodyText,
          hasContent: text(netState.el).length > 40,
        },
        expiry: {
          present: expiryState.located, inBodyText: expiryState.inBodyText,
          hasContent: text(expiryState.el).length > 40,
        },
        freshness: { ageText: ageMatch ? ageMatch[0] : null },
        layout: { horizontalOverflow, visibleError, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
      };
    }, ROUTE_BUCKETS)
    .catch(() => undefined);
}

/**
 * Click the control that reveals the secondary analytics panels. Returns what happened, so the
 * caller can tell "the panels are absent" from "the harness never managed to open them" — the
 * second is a HARNESS fault and must not be reported as the first.
 */
async function openSecondaryPanels(page) {
  const btn = page.getByRole("button", { name: /more panels/i }).first();
  try {
    if ((await btn.count()) === 0) return { opened: false, reason: "no MORE PANELS control found" };
    await btn.click({ timeout: 5_000 });
    await page.waitForTimeout(2_500);
    return { opened: true };
  } catch (e) {
    return { opened: false, reason: `MORE PANELS click failed: ${e.message}` };
  }
}

async function runViewport(session, vp) {
  const url = `${BASE}/flows`;
  const { browser, ctx, counts } = await createTunneledContext({
    url,
    cookie: session.cookieHeader,
    viewport: vp.size,
    desktop: vp.desktop,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // The tape is lazy (FlowFeed is dynamic, ssr:false) and the panels fetch after first paint;
    // deferNonCriticalWork() pushes several to requestIdleCallback. Give it real time — a probe
    // that runs before the panels mount reports them missing, which reads as a product defect.
    await page.waitForTimeout(9_000);

    /**
     * OPEN THE SECONDARY PANELS FIRST.
     *
     * The analytics rail does NOT show Route Breakdown / Net Premium / Expiry Concentration by
     * default — it opens on CONVICTION · TOP PRINTS, and the rest sit behind a "MORE PANELS"
     * control. An earlier version of this harness asserted them on the default view and reported
     * three product failures against a page that was rendering correctly; the run's own screenshot
     * is what showed the toggle. Recorded here because "the panel is missing" and "the panel is one
     * click away" are indistinguishable to a selector and opposite as findings.
     */
    const morePanels = await openSecondaryPanels(page);

    const snap = await probe(page);
    const shot = path.join(OUT, `helix-flows-${vp.id}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

    if (!snap) {
      return { viewport: vp.id, verdict: "HARNESS", reason: "probe threw — page state unreadable", counts, shot };
    }
    if (!snap.gate.brand || !snap.gate.tapeContainer) {
      // A blank render / 404 / auth bounce lands here. NOT a product verdict.
      return {
        viewport: vp.id,
        verdict: "HARNESS",
        reason: `PAGE-LOADED gate failed (brand=${snap.gate.brand}, tape=${snap.gate.tapeContainer}) — blank render, 404 or auth bounce`,
        counts, shot, snap,
      };
    }

    const fails = [];
    const notes = [];
    // Anything the harness could not READ. Kept separate from `fails` so an instrument problem is
    // never reported as a product problem — the distinction this harness got wrong on its first run.
    const harnessFaults = [];

    if (snap.gate.rowCount === 0) fails.push("tape painted zero rows");

    // §9.8 live validation — the whole reason this harness exists right now.
    const routeVerdict = morePanels.opened
      ? routeBucketVerdict(snap.route)
      : { status: "HARNESS", detail: "Route Breakdown not reachable — secondary panels never opened" };
    if (routeVerdict.status === "FAIL") fails.push(routeVerdict.detail);
    else if (routeVerdict.status === "HARNESS") harnessFaults.push(routeVerdict.detail);
    else notes.push(routeVerdict.detail);

    // ExpiryConcentration returns null by design when every horizon bucket is under its $50k
    // render floor, so its absence is not automatically a defect. Net Premium has no such floor.
    if (!morePanels.opened) {
      // Never a product verdict: we could not reach the panels, so we did not see them.
      harnessFaults.push(`secondary panels not opened — ${morePanels.reason}`);
    }
    const panelChecks = morePanels.opened
      ? [
          panelVerdict(snap.netPremium, "Net Premium"),
          panelVerdict(snap.expiry, "Expiry Concentration", { mayBeEmpty: true }),
        ]
      : [];
    for (const c of panelChecks) {
      if (c.status === "FAIL") fails.push(c.detail);
      else if (c.status === "HARNESS") harnessFaults.push(c.detail);
      else notes.push(c.detail);
    }

    const fresh = freshnessVerdict(snap.freshness.ageText);
    if (fresh.status === "FAIL") fails.push(fresh.detail);
    else if (fresh.status === "HARNESS") harnessFaults.push(fresh.detail);
    else notes.push(fresh.detail);

    if (snap.layout.horizontalOverflow) {
      fails.push(`horizontal body overflow (${snap.layout.scrollWidth}px in a ${snap.layout.innerWidth}px viewport)`);
    }
    if (snap.layout.visibleError) fails.push(`visible error text: "${snap.layout.visibleError}"`);
    if (consoleErrors.length) fails.push(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);
    if (counts.fail > 0) {
      // Assets that never painted cannot be judged — say so instead of reporting a clean run.
      return { viewport: vp.id, verdict: "HARNESS", reason: `${counts.fail} routed request(s) failed — page did not fully paint`, counts, shot, snap };
    }

    // A real product failure still leads. But with nothing failing and something unreadable, the
    // run is UNPROVEN — reporting PASS there is the half-blind certification this file exists to
    // refuse.
    const verdict = fails.length ? "FAIL" : harnessFaults.length ? "HARNESS" : "PASS";
    return { viewport: vp.id, verdict, fails, notes, harnessFaults, morePanels, counts, shot, snap };
  } finally {
    await browser.close();
  }
}

(async () => {
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(0);
  }

  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      // Each viewport is isolated: one failed pass must not discard the others (the trap
      // meridian-earnings-ui-audit.mjs records after a draining ECS replica killed a whole run).
      try {
        results.push(await runViewport(session, vp));
      } catch (e) {
        results.push({ viewport: vp.id, verdict: "HARNESS", reason: `navigation/setup threw: ${e.message}` });
      }
    }
  } finally {
    await session.cleanup?.();
    console.error("temp Clerk user deleted");
  }

  const overall = overallVerdict(results);
  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, overall, results }, null, 2));
  } else {
    console.log(`\n=== HELIX /flows UI AUDIT — ${BASE}`);
    for (const r of results) {
      console.log(`\n[${r.viewport}] ${r.verdict}${r.counts ? `  (routed ${r.counts.ok} ok, ${r.counts.fail} fail)` : ""}`);
      if (r.reason) console.log(`   reason: ${r.reason}`);
      for (const f of r.fails ?? []) console.log(`   FAIL  ${f}`);
      for (const h of r.harnessFaults ?? []) console.log(`   HARN  ${h}`);
      for (const n of r.notes ?? []) console.log(`   ok    ${n}`);
      if (r.snap?.route?.bucketCount) {
        const b = Object.entries(r.snap.route.buckets).map(([k, v]) => `${k} ${v.pct}%`).join(" · ");
        console.log(`   route buckets: ${b}`);
      }
      if (r.shot) console.log(`   shot: ${r.shot}`);
    }
    console.log(`\nOVERALL: ${overall}`);
  }
  process.exit(overall === "PASS" ? 0 : overall === "HARNESS" ? 3 : 1);
})();
