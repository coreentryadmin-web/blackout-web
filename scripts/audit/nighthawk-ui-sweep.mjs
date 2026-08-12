/**
 * NIGHT HAWK UI SWEEP — every desk panel, on live prod, in ONE browser session.
 *
 * ── THE BUG THIS HARNESS EXISTS TO NOT HAVE ────────────────────────────────────────────────
 *
 * The obvious way to shoot an authenticated page is: mint a Clerk session in one process, write
 * the cookie to a file, run `proxy-browser.cjs` with `--cookie "$(cat …)"`. That is what I did,
 * and it fails in a way that looks like the SITE is broken rather than the harness:
 *
 *   → https://blackouttrades.com/nighthawk
 *   nav: page.goto: net::ERR_CONNECTION_RESET
 *   Routed: 2 ok, 0 fail        ← two requests, where a healthy load routes ~145
 *
 * The Clerk `__session` JWT lives ~72 SECONDS. Minting it costs a Backend-API call, a FAPI ticket
 * exchange and a token mint; launching Chromium and reaching first paint costs more. By the time
 * the browser navigates, the token is often already dead, the page 307s to /sign-in, and the shot
 * is of nothing. Worse, the failed run still WRITES a PNG, so the artifact looks like evidence.
 *
 * The fix is structural, not a longer timeout: the browser and the session live in the SAME
 * process, and `session.refresh()` runs immediately before EVERY navigation. Each page therefore
 * starts with a token that has its full lifetime ahead of it, however long the sweep runs.
 * `refresh()` reuses the existing Clerk client cookies, so it is not a new sign-in and does not
 * hit the FAPI rate limit that punishes repeated mints.
 *
 * ── WHAT IT CHECKS ────────────────────────────────────────────────────────────────────────
 *
 * Per page: routed-request counts (a load that routes <20 requests did not really load), HTTP-ish
 * health via the DOM, panel presence by heading text, and three defect classes that a screenshot
 * alone would not name — empty panels, error/skeleton text stuck on screen, and horizontal
 * overflow. Then a screenshot, but ONLY once the page is judged loaded, so a broken capture can
 * never be filed as a UI finding.
 *
 * READ-ONLY: navigation and reads only. One temp Clerk user, deleted in a finally.
 *
 *   node --import tsx scripts/audit/nighthawk-ui-sweep.mjs [--out=DIR] [--viewport=1440x1800] [--json]
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = args.get("base") ?? "https://blackouttrades.com";
const VIEWPORT = args.get("viewport") ?? "1440x1800";
const JSON_OUT = args.has("json");
const OUT = args.get("out") ?? mkdtempSync(join(tmpdir(), "nh-ui-"));

/** A load that routes only a handful of requests did not render the desk — it hit an auth
 *  redirect or a reset. Below this, the page is reported BROKEN and no finding is drawn from it. */
const MIN_ROUTED = 20;

const PAGES = [
  { id: "nighthawk", path: "/nighthawk", label: "0DTE / Night Hawk desk" },
  { id: "terminal", path: "/terminal", label: "Terminal" },
  { id: "vector", path: "/vector", label: "Vector" },
  { id: "flows", path: "/flows", label: "Helix / flows" },
  // `settleMs` overrides the default post-load wait. /heatmap's SPX GEX build is a documented
  // cold-cache spike (~12.5s cold vs 0.1-1.8s warm), so the 9s default judged a page that was
  // still legitimately fetching as BROKEN.
  { id: "heatmap", path: "/heatmap", label: "Thermal / heatmap", settleMs: 20000 },
  // NOT `/record` — that route does not exist and the sweep was auditing a 404, then reporting it
  // as a product finding. The track-record page is `(site)/track-record`.
  { id: "track-record", path: "/track-record", label: "Track record" },
];

/** The Night Hawk desk is four lanes behind one tab strip; a path-only sweep audits ONLY the first
 *  one. `IosNativeSegment` renders real `role="tab"` buttons with `aria-selected`, so each lane can
 *  be driven and audited like a page. */
const TAB_SWEEP = { pageId: "nighthawk", path: "/nighthawk" };

/** Text that should never be on a rendered desk. Skeletons are matched as WHOLE words so a panel
 *  legitimately headed "Loading zone" is not reported. */
const BAD_TEXT = [
  /\bapplication error\b/i,
  /\bsomething went wrong\b/i,
  /\bfailed to (load|fetch)\b/i,
  /\bunable to load\b/i,
  /\bconnection interrupted\b/i,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
];

async function auditPage(ctx, counts, session, page, spec) {
  const before = counts.ok;
  // FRESH TOKEN PER NAVIGATION — see the header. This is the whole point of the harness.
  const { cookieHeader } = await session.refresh();
  const jwt = /__session=([^;]+)/.exec(cookieHeader)?.[1];
  if (jwt) {
    await ctx.clearCookies();
    await ctx.addCookies(
      cookieHeader.split(";").map((p) => {
        const [n, ...r] = p.trim().split("=");
        return {
          name: n.trim(),
          value: r.join("=").trim(),
          domain: new URL(BASE).hostname,
          path: "/",
          httpOnly: n.trim() === "__session",
          secure: true,
          sameSite: "Lax",
        };
      })
    );
  }

  let navError = null;
  try {
    await page.goto(`${BASE}${spec.path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    navError = e.message.split("\n")[0];
  }
  await page.waitForTimeout(spec.settleMs ?? 9000);

  const routed = counts.ok - before;
  const probe = await probeDom(page);
  return finishAudit({ spec, routed, navError, probe, page });
}

/** Read the rendered DOM. Shared by the page sweep and the tab sweep so a lane is judged by exactly
 *  the same rules as a page. */
async function probeDom(page) {
  return page
    .evaluate(() => {
      const txt = document.body.innerText || "";
      const headings = [...document.querySelectorAll("h1,h2,h3,[class*='panel'] [class*='title'],[class*='Panel'] header")]
        .map((e) => (e.textContent || "").trim())
        .filter((t) => t && t.length < 60);
      // An "empty panel" is a section container whose own text is essentially nothing — the
      // failure mode where a panel renders its chrome and no data.
      //
      // The class selector alone is far too broad: `[class*='card']` also matches decorative LEAVES
      // like `vp-intel-card-icon` and `vp-intel-card-title`, which are SUPPOSED to hold no text.
      // That reported 8 "empty sections" on a perfectly healthy /vector and cost a round of
      // investigation. A real panel is a container — it has element children and occupies real
      // space — so require both before calling emptiness a defect.
      const sections = [...document.querySelectorAll("section,[class*='panel'],[class*='Panel'],[class*='card']")];
      const empty = sections
        .filter((s) => {
          if ((s.textContent || "").replace(/\s+/g, "").length >= 12) return false;
          if (s.childElementCount === 0) return false; // a leaf (icon/title span), not a panel
          const r = s.getBoundingClientRect();
          return r.width >= 200 && r.height >= 80; // big enough that a member would see the hole
        })
        .map((s) => s.className?.toString?.().slice(0, 60) || s.tagName)
        .slice(0, 8);
      return {
        title: document.title,
        chars: txt.length,
        text: txt.slice(0, 20000),
        headings: [...new Set(headings)].slice(0, 40),
        emptySections: empty,
        sectionCount: sections.length,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        signedOut: /sign in|get access/i.test(txt.slice(0, 2000)),
      };
    })
    .catch((e) => ({ error: e.message }));
}

/** Turn a probe into a verdict row, screenshotting ONLY once the view is judged loaded. */
async function finishAudit({ spec, routed, navError, probe, page }) {
  const loaded = !navError && routed >= MIN_ROUTED && !probe.error && !probe.signedOut;
  let shot = null;
  if (loaded) {
    shot = `${OUT}/${spec.id}.png`;
    await page
      .screenshot({ path: shot, timeout: 45000, animations: "disabled" })
      .catch((e) => {
        shot = `SCREENSHOT FAILED: ${e.message.split("\n")[0]}`;
      });
  }

  const badText = loaded ? BAD_TEXT.filter((re) => re.test(probe.text)).map((re) => re.source) : [];
  const overflow = loaded && probe.scrollW > probe.clientW + 2 ? probe.scrollW - probe.clientW : 0;

  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    routed,
    navError,
    loaded,
    signedOut: !!probe.signedOut,
    title: probe.title,
    chars: probe.chars,
    headings: probe.headings ?? [],
    sectionCount: probe.sectionCount,
    emptySections: probe.emptySections ?? [],
    badText,
    overflowPx: overflow,
    shot,
  };
}

/**
 * Sweep the Night Hawk tab strip — 0DTE / Swings / Bangers / Legacy.
 *
 * A path-only sweep audits the DEFAULT lane and nothing else, so three of the four boards a member
 * pays for were never looked at. The strip is `IosNativeSegment`, which renders real
 * `role="tab"` buttons, so each lane is driven the way a member drives it: click, let the lane's
 * own fetches settle, then run the SAME probe a page gets.
 *
 * Routed-request counts are not a useful health signal here — switching lanes issues a handful of
 * XHRs, not a full page load — so a tab is judged on what it RENDERS (text, panels, error/skeleton
 * text) with `routed` reported for information only. MIN_ROUTED is bypassed via `routed: Infinity`
 * rather than special-cased inside `finishAudit`, keeping one verdict path for pages and tabs.
 */
async function auditTabs(counts, page, rows) {
  const tabs = await page.$$('[role="tab"]');
  if (tabs.length === 0) {
    console.log("TABS  none found — the desk segment did not render");
    return;
  }
  const labels = await Promise.all(tabs.map((t) => t.innerText().catch(() => "")));
  console.log(`\nTABS  ${tabs.length} lanes: ${labels.map((l) => l.trim()).join(" · ")}`);

  for (let i = 0; i < tabs.length; i += 1) {
    const label = (labels[i] || `tab${i}`).trim().replace(/\s+/g, " ");
    const before = counts.ok;
    // Re-query each pass: switching lanes remounts the strip, so handles from before the click are
    // detached and clicking one throws.
    const fresh = await page.$$('[role="tab"]');
    if (!fresh[i]) continue;
    await fresh[i].click().catch(() => {});
    await page.waitForTimeout(9000);

    const probe = await probeDom(page);
    const spec = {
      id: `nighthawk-tab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: `Night Hawk · ${label}`,
      path: `/nighthawk#${label}`,
    };
    const r = await finishAudit({ spec, routed: Infinity, navError: null, probe, page });
    r.routed = counts.ok - before; // report the real count; it just does not gate the verdict
    rows.push(r);
    console.log(
      `${r.loaded ? "OK  " : "BROKEN"} ${spec.label.padEnd(24)} xhr=${String(r.routed).padStart(3)} ` +
        `chars=${String(r.chars ?? 0).padStart(6)} panels=${String(r.sectionCount ?? 0).padStart(3)} ` +
        `empty=${r.emptySections.length} overflow=${r.overflowPx}px badText=${r.badText.length}`
    );
    if (r.loaded && r.badText.length) console.log(`      badText: ${r.badText.join(" · ")}`);
    if (r.loaded && r.headings.length) console.log(`      panels:  ${r.headings.slice(0, 10).join(" · ")}`);
  }
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP — ${session.reason}`);
    process.exitCode = 1;
    return;
  }
  const { cookieHeader } = await session.refresh();
  const { browser, ctx, counts } = await createTunneledContext({
    url: BASE,
    cookie: cookieHeader,
    viewport: VIEWPORT,
    desktop: true,
  });

  const rows = [];
  try {
    const page = await ctx.newPage();
    for (const spec of PAGES) {
      const r = await auditPage(ctx, counts, session, page, spec);
      rows.push(r);
      const verdict = r.loaded ? "OK  " : "BROKEN";
      console.log(
        `${verdict} ${r.path.padEnd(12)} routed=${String(r.routed).padStart(4)} chars=${String(r.chars ?? 0).padStart(6)} ` +
          `panels=${String(r.sectionCount ?? 0).padStart(3)} empty=${r.emptySections.length} ` +
          `overflow=${r.overflowPx}px badText=${r.badText.length}${r.navError ? ` nav=${r.navError}` : ""}` +
          `${r.signedOut ? " SIGNED-OUT" : ""}`
      );
      if (r.loaded && r.badText.length) console.log(`      badText: ${r.badText.join(" · ")}`);
      if (r.loaded && r.emptySections.length) console.log(`      empty:   ${r.emptySections.slice(0, 4).join(" · ")}`);
      if (r.loaded && r.headings.length) console.log(`      panels:  ${r.headings.slice(0, 12).join(" · ")}`);

      // The four Night Hawk lanes live behind a tab strip on this one page — sweep them while the
      // page is loaded and authenticated, rather than as separate navigations.
      if (spec.id === TAB_SWEEP.pageId && r.loaded) await auditTabs(counts, page, rows);
    }
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    await session.cleanup?.();
    console.log("temp user deleted");
  }

  writeFileSync(`${OUT}/sweep.json`, JSON.stringify(rows, null, 2));
  console.log(`\nartifacts: ${OUT}`);
  if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
}

await main();
