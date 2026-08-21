/**
 * Does ENTER COMPARE actually navigate on prod?
 *
 * The post-deploy capture clicked `vector-enter-compare` and the URL stayed on `?ticker=SPX`. That
 * is either (a) a real navigation bug of the same shape as the exit-compare one just fixed — both
 * call `router.push()` — or (b) the harness click never landed. Those look identical from a
 * screenshot, so this separates them explicitly:
 *   - hit-test the button's own centre first, so a click swallowed by an overlay is reported as a
 *     HARNESS failure and never as a product defect
 *   - then click and watch the URL for several seconds, since an App Router push is async and a
 *     single immediate read would call a slow-but-working navigation broken
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`.
 * Run from the REPO ROOT: NODE_USE_ENV_PROXY=1 node scripts/audit/vector-compare-nav-probe.cjs
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
    page.on("console", (m) => { if (m.type() === "error") console.log(`   console.error: ${m.text().slice(0, 160)}`); });
    page.on("pageerror", (e) => console.log(`   pageerror: ${String(e).slice(0, 160)}`));

    await page.goto(`${BASE}/vector?ticker=SPX`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(16_000);
    console.log(`start url: ${page.url()}`);

    const pre = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[data-testid=vector-enter-compare]"));
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = r.width > 0 && r.height > 0
          ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          : null;
        return {
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          top: Math.round(r.top),
          // A click only reaches the button if the topmost element at its centre IS the button
          // (or one of its own children) — anything else means an overlay ate the click.
          clickable: !!hit && (el.contains(hit) || hit === el),
          topmost: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 50)}` : "none",
        };
      });
    });
    console.log(`enter-compare copies: ${JSON.stringify(pre)}`);

    const target = page.locator("[data-testid=vector-enter-compare]").filter({ visible: true }).last();
    if (!(await target.count())) { console.log("VERDICT: HARNESS — no visible enter-compare"); return; }

    const before = page.url();
    await target.click({ timeout: 8000 });
    // Poll rather than sleep-then-read: an App Router push resolves asynchronously and a single
    // immediate read would report a working-but-slow navigation as broken.
    let after = before;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      after = page.url();
      if (after !== before) break;
    }
    const entered = /[?&]compare=/.test(after) || /\/compare/.test(after);
    console.log(`after click: ${after}`);
    console.log(`VERDICT: ${entered ? "OK — entered compare" : "BUG — click landed, URL never left the desk"}`);

    if (entered) {
      await page.waitForTimeout(9000);
      const st = await page.evaluate(() => {
        // Query by CLASS, not testid: the compare-pane branch renders NODES with
        // exposeTestIds={false} on purpose (four panes would emit the same id four times), so a
        // testid count reports 0 for a control that is right there on screen.
        const sel = Array.from(document.querySelectorAll("select.vector-desk-seg-select"))
          .filter((e) => e.getBoundingClientRect().width > 0);
        const tf = Array.from(document.querySelectorAll("[data-testid=vector-tf-custom]"))
          .filter((e) => e.getBoundingClientRect().width > 0);
        return {
          nodesSelects: sel.length,
          nodesValues: sel.map((e) => e.value),
          tfValue: tf[0] ? (tf[0].value ?? tf[0].textContent?.trim()) : null,
          exitPresent: !!document.querySelector("[data-testid=vector-compare-exit]"),
        };
      });
      console.log(`compare state: ${JSON.stringify(st)}`);
      await page.screenshot({ path: "/tmp/shots/v2330/03-compare-SPX.png" });

      const exit = page.locator("[data-testid=vector-compare-exit]").filter({ visible: true }).last();
      if (await exit.count()) {
        const b2 = page.url();
        await exit.click({ timeout: 8000 });
        let a2 = b2;
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(1000);
          a2 = page.url();
          if (a2 !== b2) break;
        }
        console.log(`EXIT COMPARE: ${b2} -> ${a2}  left=${a2 !== b2 && !/compare/.test(a2)}`);
        await page.screenshot({ path: "/tmp/shots/v2330/04-after-exit-compare-SPX.png" });
      }
    }
  } finally {
    await browser.close();
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }
})().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
