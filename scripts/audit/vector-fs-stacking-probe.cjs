/**
 * Why is the Vector toolbar still under the site nav in FULLSCREEN?
 *
 * #2330 raised `.vector-page-inner-focus` from z-60 to z-110, above the `.nav-bar` at z-100. The
 * post-deploy capture shows the nav still painting over the toolbar. A z-index only competes inside
 * its own STACKING CONTEXT, so the number being right proves nothing on its own — this walks the
 * ancestor chain of the focused container and of the nav, printing every ancestor that CREATES a
 * stacking context (transform, filter, opacity<1, will-change, isolation, contain, backdrop-filter,
 * position+z-index). Whichever chain roots at a lower context is the one that loses, regardless of
 * the leaf z-index.
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`.
 * Run from the REPO ROOT: NODE_USE_ENV_PROXY=1 node scripts/audit/vector-fs-stacking-probe.cjs
 */
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");

(async () => {
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`SKIP: ${session.reason}`); process.exit(2); }

  const { browser, ctx } = await createTunneledContext({
    url: `${BASE}/vector`, cookie: session.cookieHeader, viewport: "1920x1080",
    desktop: true, requestTimeoutMs: 60_000,
  });

  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/vector?ticker=SPX`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(16_000);

    const ft = page.locator("[data-testid=vector-focus-toggle]").filter({ visible: true }).last();
    await ft.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const report = await page.evaluate(() => {
      const creates = (cs, el) => {
        const r = [];
        if (cs.position !== "static" && cs.zIndex !== "auto") r.push(`pos:${cs.position} z:${cs.zIndex}`);
        if (cs.position === "fixed" || cs.position === "sticky") r.push(`pos:${cs.position}`);
        if (cs.transform !== "none") r.push("transform");
        if (cs.filter !== "none") r.push("filter");
        if (cs.backdropFilter && cs.backdropFilter !== "none") r.push("backdrop-filter");
        if (cs.opacity !== "1") r.push(`opacity:${cs.opacity}`);
        if (cs.willChange && !/^auto$/.test(cs.willChange)) r.push(`will-change:${cs.willChange}`);
        if (cs.isolation === "isolate") r.push("isolation");
        if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) r.push(`contain:${cs.contain}`);
        if (cs.mixBlendMode !== "normal") r.push("mix-blend-mode");
        void el;
        return r;
      };
      const chain = (el) => {
        const out = [];
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          const why = creates(cs, n);
          if (why.length) {
            out.push({
              tag: n.tagName.toLowerCase(),
              cls: (n.className && String(n.className).slice(0, 90)) || "",
              z: cs.zIndex, why: why.join(","),
            });
          }
        }
        return out;
      };
      const focus = document.querySelector(".vector-page-inner-focus");
      const nav = document.querySelector(".nav-bar") || document.querySelector("nav");
      const toolbar = document.querySelector("[data-testid=vector-page-toolbar]");
      const tb = toolbar?.getBoundingClientRect();
      const hitAtToolbar = tb
        ? (() => { const h = document.elementFromPoint(tb.left + 40, tb.top + tb.height / 2);
            return h ? `${h.tagName.toLowerCase()}.${String(h.className).slice(0, 60)}` : "none"; })()
        : "no toolbar";
      return {
        focusPresent: !!focus,
        focusZ: focus ? getComputedStyle(focus).zIndex : null,
        focusChain: focus ? chain(focus) : [],
        navZ: nav ? getComputedStyle(nav).zIndex : null,
        navChain: nav ? chain(nav) : [],
        toolbarRect: tb ? { top: Math.round(tb.top), h: Math.round(tb.height) } : null,
        hitAtToolbar,
      };
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }
})().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
