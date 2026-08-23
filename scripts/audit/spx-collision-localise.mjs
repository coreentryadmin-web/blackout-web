#!/usr/bin/env node
/**
 * SPX /dashboard COLLISION LOCALISER — turns "two labels overlap" into the layout facts a fix needs.
 *
 * `live-ui-interaction-audit.mjs` proves a collision exists and names the two TEXTS. That is enough
 * to know there is a defect and not enough to fix one: it does not say which boxes overlap, which
 * shared ancestor lays them out, or whether the cause is a row that cannot fit its children or one
 * element stacked on another. SLAYER-MAP §8 item 6 records the standing caution against guessing a
 * layout rule — "a layout modifier is only correct for the flex direction it was written for" — so
 * this exists to remove the guessing, not to shorten it.
 *
 * IT DOES NOT DO ITS OWN DETECTION, and that is the whole design.
 *
 * The first version of this script re-implemented the geometry: text leaves, rect intersection,
 * done. Run live against /dashboard it reported EIGHT collisions between the sticky desk header and
 * `td.spx-gex-matrix-expiry-col` rows — every one a row scrolled away inside
 * `.spx-gex-matrix-scroll`, whose rect still reports where it WOULD be. That is the exact
 * false-positive class `ui-geometry-probe.mjs`'s `hiddenByScroll` comment was written about, and it
 * MISSED all three real collisions the interaction audit had already found. Detection in that file
 * took several live iterations to get right (scroll-clipping, clip fraction, animation frames,
 * fixed/floating layering, a 25%-of-the-smaller-box floor); a second copy of it would be a second
 * thing to get wrong.
 *
 * So `probeGeometry` now tags its surviving pairs with `data-collide-id`, and this script only
 * LOCALISES what that pass already vetted. For each pair it reports both rects and computed
 * position/display/transform/z, then walks to the FIRST COMMON ANCESTOR and reports its
 * display/flexDirection/flexWrap/gap/overflow — plus `scrollWidth > clientWidth`, which is the
 * discriminator between a row that cannot fit its children (wrap/overflow fix) and one element
 * stacked on another (position/z fix). Those take opposite fixes and look identical from a text pair.
 *
 * A pair whose elements can no longer be found is reported as UNRESOLVED, never dropped — the DOM
 * moving under the probe must not read as "that collision is gone".
 *
 * READ-ONLY. One temp Clerk user, released in a finally. Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/spx-collision-localise.mjs [--path=/dashboard]
 *                                                                     [--viewport=1440x1000] [--json]
 */
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { probeGeometry } from "./lib/ui-geometry-probe.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const BASE = flag("base", "https://blackouttrades.com").replace(/\/$/, "");
const PATH = flag("path", "/dashboard");
// createTunneledContext takes the viewport as a "WxH" STRING, not a {width,height} object — it
// does String(viewport).split("x"), so an object silently becomes NaN and Playwright rejects it.
// Match live-ui-interaction-audit.mjs's desktop device exactly — a localiser measuring a
// different viewport than the detector is measuring a different page.
const VIEWPORT = flag("viewport", "1440x1000");
const JSON_OUT = args.includes("--json");
const SETTLE_MS = Number(flag("settle-ms", "9000"));
/**
 * Candidate CSS to inject BEFORE measuring — a before/after on the live page without a deploy.
 *
 * A layout fix that is only reasoned about is a guess with citations. Injecting the candidate rule
 * into the real production DOM and re-running the SAME detector is the cheapest honest test of it:
 * same page, same data, same predicates, one variable. It proves the rule removes the collision;
 * it does NOT prove the rule is the right long-term fix, and it cannot see what the extra wrapped
 * row does to everything below it. Both of those still need eyes on a deployed build.
 */
const INJECT_CSS = flag("inject-css", "");
/**
 * Playwright device class, NOT just a viewport size. `desktop:false` turns on touch emulation and
 * the mobile UA; `desktop:true` keeps the desktop UA at whatever width you ask for. They render
 * DIFFERENT pages here — this app keys its `ios-native-shell` rules off the `BlackOutiOSApp` UA,
 * and several breakpoint rules key off pointer/touch — so a narrow-viewport run has to say which
 * one it measured or the numbers describe a page no member sees. Defaults to desktop; pass
 * `--desktop=0` for the phone class, which is what live-ui-interaction-audit.mjs uses at 430x932.
 */
const DESKTOP = flag("desktop", "1") !== "0";
/**
 * Per-request tunnel deadline. Exposed rather than hardcoded because it is the variable that
 * decides whether this page loads at all from this sandbox — see the createTunneledContext call.
 */
const REQUEST_TIMEOUT_MS = Number(flag("request-timeout-ms", "60000"));

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error("[collision-localise] no Clerk session available — SKIPPED, not clean");
    return 2;
  }
  const url = `${BASE}${PATH}`;
  const { browser, ctx } = await createTunneledContext({
    url,
    viewport: VIEWPORT,
    desktop: DESKTOP,
    cookie: session.cookieHeader,
    // /dashboard pulls the SPX desk, which forces a GEX matrix rebuild measured at 5-7s p95 with a
    // 56s tail. The tunnel's default 20s deadline would drop that panel and this probe would then
    // report a page missing the very controls it is here to measure — a latency observation
    // masquerading as a rendering defect.
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  try {
    const page = await ctx.newPage();
    // Same reason as the interaction audit: an SSE stream never ends, Playwright serialises route
    // handling, and one open stream stalls every request behind it.
    await page.route((u) => /(^|\/|-)(stream|sse|events)(\?|$)/.test(u.pathname + u.search), (r) => r.abort());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (INJECT_CSS) {
      // addStyleTag AFTER navigation and BEFORE the settle wait, so the rule is in the cascade for
      // every layout pass the settle period covers — including the transient states that are the
      // whole reason this collision is intermittent.
      await page.addStyleTag({ content: INJECT_CSS });
      console.error(`[collision-localise] injected candidate CSS (${INJECT_CSS.length} chars)`);
    }
    await page.waitForTimeout(SETTLE_MS);

    // DETECTION happens in the shared, live-hardened probe. This call also tags each surviving
    // pair's two elements with `data-collide-id`, which is the only reason a second pass can
    // re-find them without re-deriving the geometry.
    const geo = await probeGeometry(page);
    const pairs = geo.collidePairs ?? [];

    const result = await page.evaluate((pairsIn) => {
      const byId = (id) => document.querySelector(`[data-collide-id="${id}"]`);

      const box = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className.slice(0, 140) : "",
          rect: {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          position: st.position,
          display: st.display,
          transform: st.transform === "none" ? "none" : st.transform,
          zIndex: st.zIndex,
          whiteSpace: st.whiteSpace,
          flex: st.flex,
          margin: st.margin,
        };
      };

      const pathTo = (el, stop) => {
        const out = [];
        for (let p = el; p && p !== stop && p !== document.body; p = p.parentElement) {
          const cls =
            typeof p.className === "string" && p.className.trim()
              ? "." + p.className.trim().split(/\s+/).slice(0, 2).join(".")
              : "";
          out.push(`${p.tagName.toLowerCase()}${cls}`);
          if (out.length > 10) break;
        }
        return out;
      };

      const commonAncestor = (a, b) => {
        const chain = new Set();
        for (let p = a; p; p = p.parentElement) chain.add(p);
        for (let p = b; p; p = p.parentElement) if (chain.has(p)) return p;
        return document.body;
      };

      const ancestorFacts = (el) => {
        const st = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className.slice(0, 180) : "",
          display: st.display,
          flexDirection: st.flexDirection,
          flexWrap: st.flexWrap,
          gap: st.gap,
          overflowX: st.overflowX,
          overflowY: st.overflowY,
          position: st.position,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          // THE DISCRIMINATOR. Content wider than the box means the row cannot fit its children
          // (wrap/overflow fix); content that fits means something is stacked on top of something
          // else (position/z fix). Opposite fixes, identical symptom from a text pair alone.
          contentOverflows: el.scrollWidth > el.clientWidth + 1,
        };
      };

      /**
       * The chain ABOVE the common ancestor, bounded. The ancestor answers "where does the fix go";
       * this answers "why does this host differ from the other one" — a component that collides in
       * one page and not another is being laid out by something further up, and without this the
       * two runs are two verdicts with no way to tell them apart. Each level carries the box width
       * (the constraint that actually propagates) and any wrapper class a stylesheet could hook.
       */
      const ancestorChain = (el, max = 8) => {
        const out = [];
        for (let p = el.parentElement; p && p !== document.body && out.length < max; p = p.parentElement) {
          const st = getComputedStyle(p);
          out.push({
            tag: p.tagName.toLowerCase(),
            className: typeof p.className === "string" ? p.className.slice(0, 120) : "",
            display: st.display,
            flexWrap: st.flexWrap,
            overflowX: st.overflowX,
            clientWidth: p.clientWidth,
          });
        }
        return out;
      };

      const overlapOf = (a, b) => {
        const l = Math.max(a.left, b.left);
        const t = Math.max(a.top, b.top);
        const r = Math.min(a.right, b.right);
        const bo = Math.min(a.bottom, b.bottom);
        return { width: Math.max(0, Math.round(r - l)), height: Math.max(0, Math.round(bo - t)) };
      };

      const localised = [];
      const unresolved = [];
      for (const p of pairsIn) {
        const a = byId(p.a);
        const b = byId(p.b);
        if (!a || !b) {
          // Reported, never dropped: the DOM moving under the probe must not read as "resolved".
          unresolved.push({ ...p, reason: !a && !b ? "both elements gone" : "one element gone" });
          continue;
        }
        const anc = commonAncestor(a, b);
        localised.push({
          text: p.text,
          control: p.control,
          overlap: overlapOf(a.getBoundingClientRect(), b.getBoundingClientRect()),
          a: box(a),
          b: box(b),
          common_ancestor: ancestorFacts(anc),
          ancestor_chain: ancestorChain(anc),
          a_path_to_ancestor: pathTo(a, anc),
          b_path_to_ancestor: pathTo(b, anc),
        });
      }
      return { viewport: { w: innerWidth, h: innerHeight }, localised, unresolved };
    }, pairs);

    if (JSON_OUT) {
      console.log(JSON.stringify({ url, viewport: VIEWPORT, device: DESKTOP ? "desktop" : "phone", detected: geo.collide, ...result }, null, 2));
    } else {
      console.log(`${url}  viewport ${result.viewport.w}x${result.viewport.h}  device=${DESKTOP ? "desktop" : "phone"}`);
      console.log(`  detected by probeGeometry: ${geo.collide.length} collision(s)`);
      if (!geo.collide.length) {
        // Say what ran, not just what was found — a probe that found nothing and a probe that never
        // ran read identically otherwise.
        console.log("  page loaded and the shared probe ran; no collisions survived its predicates");
      }
      for (const u of result.unresolved) {
        console.log(`\n  UNRESOLVED  "${u.text}" × "${u.control}" — ${u.reason} (the DOM moved; NOT evidence the collision is gone)`);
      }
      for (const c of result.localised) {
        console.log(`\n  "${c.text}"  ×  "${c.control}"   overlap ${c.overlap.width}x${c.overlap.height}px`);
        console.log(`    A  ${c.a.tag}${c.a.className ? "." + c.a.className : ""}`);
        console.log(`       rect ${JSON.stringify(c.a.rect)} position=${c.a.position} display=${c.a.display} transform=${c.a.transform} z=${c.a.zIndex} whiteSpace=${c.a.whiteSpace} flex=${c.a.flex}`);
        console.log(`    B  ${c.b.tag}${c.b.className ? "." + c.b.className : ""}`);
        console.log(`       rect ${JSON.stringify(c.b.rect)} position=${c.b.position} display=${c.b.display} transform=${c.b.transform} z=${c.b.zIndex} whiteSpace=${c.b.whiteSpace} flex=${c.b.flex}`);
        const anc = c.common_ancestor;
        console.log(`    COMMON ANCESTOR  ${anc.tag}${anc.className ? "." + anc.className : ""}`);
        console.log(`       display=${anc.display} flexDirection=${anc.flexDirection} flexWrap=${anc.flexWrap} gap=${anc.gap} overflowX=${anc.overflowX} position=${anc.position}`);
        console.log(`       clientWidth=${anc.clientWidth} scrollWidth=${anc.scrollWidth} contentOverflows=${anc.contentOverflows}`);
        console.log(`       => ${anc.contentOverflows ? "ROW CANNOT FIT ITS CHILDREN — wrap/overflow fix" : "content fits — something is STACKED — position/z fix"}`);
        console.log(`    A path: ${c.a_path_to_ancestor.join(" < ")}`);
        console.log(`    B path: ${c.b_path_to_ancestor.join(" < ")}`);
        console.log(`    ABOVE:`);
        for (const up of c.ancestor_chain) {
          console.log(`       ${up.tag}${up.className ? "." + up.className : ""}  [w=${up.clientWidth} display=${up.display} flexWrap=${up.flexWrap} overflowX=${up.overflowX}]`);
        }
      }
    }
    // Non-zero on a detected collision OR on an unresolved pair — "I could not localise it" must
    // not exit clean.
    return geo.collide.length || result.unresolved.length ? 1 : 0;
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[collision-localise] ${err?.message ?? err}`);
    process.exit(1);
  });
