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
/**
 * THE ONE PARSING RULE THIS FILE RUNS ON — it cost three separate false failures to learn.
 *
 * `textContent` has NO SEPARATORS. Adjacent elements concatenate with nothing between them, so a
 * badge that reads "500 · 28h ago" on screen arrives as `…Filters500 · 28h agoFloor$200K…`, and a
 * panel row reading "OTHER 496 100% $964.9M" arrives as `OTHER496100%$964.9M`.
 *
 * Two consequences, and every pattern below obeys both:
 *   - separators are `\s*` / `\D*`, never `\s+`;
 *   - **never assert `\b` at a token's TRAILING edge.** "ago" glued to "Floor" is word→word, so
 *     `ago\b` does not match; "OTHER" glued to "496" is word→word, so `\bOTHER\b` does not match.
 *     A leading `\b` is safe and is kept.
 *
 * Each of those produced a confident "the panel did not render" / "no age rendered" against a page
 * whose own screenshot showed the value plainly. If a probe here ever reports something missing,
 * suspect this rule before suspecting the product.
 */
async function probe(page, { panelsOnly = false } = {}) {
  return page
    .evaluate(({ BUCKETS, panelsOnly }) => {
      const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const body = document.body;

      // ---- PAGE-LOADED GATE: long-shipped HELIX furniture, nothing this lane recently touched.
      const bodyText = text(body);
      const brand = /HELIX/i.test(bodyText);
      // The tape is a virtualized grid; its rows carry a ticker + a premium. Count anything that
      // looks like a print row rather than binding to one class name.
      /**
       * The tape's row classes, READ OUT OF THE COMPONENTS rather than guessed.
       *
       * Desktop `HelixFlowTable` renders `helix-tape-row`; mobile `HelixMobileFlowTape` builds its
       * cards from `cardCls = clsx("flow-card", …)`. Both values are RESOLVED FROM THE SOURCE, not
       * inferred from the rendered markup — four separate guesses failed first, including
       * `helix-tape-alert`, which appears in the mobile component but is its ARIA alert region,
       * not a card. Every one of those guesses made the harness report "tape painted zero rows"
       * against a mobile view whose own screenshot shows a full tape of SPX cards.
       *
       * The rule this cost six false results to learn: when an assertion depends on markup, READ
       * THE COMPONENT. A selector that is merely plausible does not fail loudly — it accuses the
       * product.
       *
       * `helix-tape-col-row` and `helix-tape-group-row` are HEADER rows and do not contain the
       * substring `helix-tape-row`, so they are excluded by construction rather than by filtering.
       */
      const rowNodes = Array.from(
        document.querySelectorAll('[class*="helix-tape-row"], [class*="flow-card"]')
      );
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
      const PANEL_MIN_TEXT = 60;
      const panelByTitle = (title) => {
        const all = Array.from(document.querySelectorAll("div,section,article"));
        const hits = all.filter((el) => text(el).includes(title));
        if (!hits.length) return null;
        // Smallest container that carries CONTENT beyond the title. Taking the smallest match
        // outright returns the title node itself — which then fails every content check and
        // reports "rendered but is empty" against panels that had rendered fine. Falls back to the
        // smallest match so a genuinely tiny panel is still returned rather than dropped.
        const withContent = hits.filter((el) => text(el).length >= PANEL_MIN_TEXT);
        const pool = withContent.length ? withContent : hits;
        return pool.reduce((best, el) => (text(el).length < text(best).length ? el : best), pool[0]);
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
      /**
       * PARSE ELEMENTS, NOT FLATTENED TEXT.
       *
       * Regexing the panel's concatenated textContent cannot work here and the failure is SILENT.
       * A row reading "OTHER 496 100% $964.9M" arrives glued as `OTHER496100%$964.9M`, and
       * `OTHER\D*(\d[\d,]*)\D*?(\d+)%` backtracks to the SHORTEST legal split — count `49610`,
       * pct `0`. Every bucket then reported 0%, no bucket exceeded the dominance threshold, and the
       * harness returned **PASS** on a panel the screenshot showed at OTHER 100%. A false pass is
       * worse than a false failure: nobody investigates it.
       *
       * The DOM already carries the boundaries the flattened string threw away, so read the LEAF
       * elements of each row and take the tokens whole.
       */
      const leafTokens = (el) =>
        Array.from(el.querySelectorAll("*"))
          .filter((n) => n.children.length === 0)
          .map((n) => (n.textContent ?? "").trim())
          .filter(Boolean);

      if (routePanel) {
        // Each bucket's label is its own leaf ("OTHER"); its row is the nearest ancestor that also
        // holds the count and the pct.
        for (const leaf of Array.from(routePanel.querySelectorAll("*")).filter((n) => n.children.length === 0)) {
          const label = (leaf.textContent ?? "").trim().toUpperCase();
          if (!BUCKETS.includes(label)) continue;
          let row = leaf.parentElement;
          for (let up = 0; up < 4 && row; up++) {
            const toks = leafTokens(row);
            const pctTok = toks.find((t) => /^\d+%$/.test(t));
            const countTok = toks.find((t) => /^[\d,]+$/.test(t));
            if (pctTok && countTok) {
              buckets[label] = { count: Number(countTok.replace(/,/g, "")), pct: Number(pctTok.slice(0, -1)) };
              break;
            }
            row = row.parentElement;
          }
        }
      }

      const routeState = panelState("Route Breakdown");
      const netState = panelState("Net Premium");
      const expiryState = panelState("Expiry Concentration");

      // ---- Freshness badge: the age string the desk renders ("42s ago" / "7m ago" / "3h ago").
      const ageMatch = bodyText.match(/\b(\d+)\s*(s|m|h)\s*ago/);

      // ---- Layout health.
      const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const badWords = /(something went wrong|failed to load|unavailable right now|application error)/i;
      const visibleError = badWords.test(bodyText) ? bodyText.match(badWords)[0] : null;

      return {
        gate: {
          brand,
          tapeContainer,
          rowCount: rowNodes.length,
          // What the tape area actually looks like when rowCount is 0. Guessing at markup across
          // two different tape components (desktop HelixFlowTable / mobile HelixMobileFlowTape)
          // cost two runs; capturing the candidate class names costs nothing and ends it.
          tapeClasses: Array.from(
            new Set(
              Array.from(document.querySelectorAll('[class*="flow"], [class*="tape"]'))
                .slice(0, 40)
                .map((n) => String(n.className || "").slice(0, 80))
                .filter(Boolean)
            )
          ).slice(0, 12),
        },
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
        freshness: {
          ageText: ageMatch ? ageMatch[0] : null,
          // A 90-char window around the word "ago", captured so a parse miss can be diagnosed
          // from the run output instead of requiring another live round-trip.
          agoContext: (() => {
            const i = bodyText.indexOf("ago");
            return i === -1 ? null : bodyText.slice(Math.max(0, i - 60), i + 30);
          })(),
        },
        layout: { horizontalOverflow, visibleError, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
      };
    }, { BUCKETS: ROUTE_BUCKETS, panelsOnly })
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
    /**
     * TWO-PHASE PROBE, in the order a member experiences the page.
     *
     * The tape must be measured on the DEFAULT view, BEFORE the modal opens. On mobile the
     * "MORE PANELS" modal is full-screen and the tape is not in the DOM behind it, so probing
     * everything after opening it reported "tape painted zero rows" — a viewport-specific false
     * failure that desktop hid, because there the modal is an overlay and the tape survives
     * underneath. Sequencing, not selectors: the same probe was right on one viewport and wrong
     * on the other purely because of WHEN it ran.
     */
    const base = await probe(page);
    // The DEFAULT view, captured before anything is clicked. Every screenshot this harness took
    // until now was of the MODAL, so a tape assertion could fail with no picture of the thing it
    // was asserting about — which is how "tape painted zero rows" stayed unexplained for two runs.
    const shotDefault = path.join(OUT, `helix-flows-${vp.id}-default.png`);
    await page.screenshot({ path: shotDefault, fullPage: false }).catch(() => {});

    const morePanels = await openSecondaryPanels(page);
    const panels = morePanels.opened ? await probe(page, { panelsOnly: true }) : undefined;
    // Panel readings come from the modal pass; everything else from the default view.
    const snap = base && {
      ...base,
      route: panels?.route ?? base.route,
      netPremium: panels?.netPremium ?? base.netPremium,
      expiry: panels?.expiry ?? base.expiry,
    };
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
    return { viewport: vp.id, verdict, fails, notes, harnessFaults, morePanels, counts, shot, shotDefault, snap };
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
      if (r.snap?.freshness?.ageText == null && r.snap?.freshness?.agoContext) {
        console.log(`   freshness context: …${r.snap.freshness.agoContext}…`);
      }
      if (r.snap?.gate?.rowCount === 0 && r.snap?.gate?.tapeClasses?.length) {
        console.log(`   tape classes seen: ${r.snap.gate.tapeClasses.join(" | ")}`);
      }
      if (r.shotDefault) console.log(`   shot (default view): ${r.shotDefault}`);
      if (r.shot) console.log(`   shot (panels modal): ${r.shot}`);
    }
    console.log(`\nOVERALL: ${overall}`);
  }
  process.exit(overall === "PASS" ? 0 : overall === "HARNESS" ? 3 : 1);
})();
