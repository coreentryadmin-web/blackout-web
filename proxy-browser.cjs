/**
 * Proxy-browser: Playwright screenshots through the agent proxy.
 *
 * Chromium never touches the network — every request is intercepted and fulfilled by Node over a
 * manual CONNECT + tls.connect() tunnel. That tunnel now lives in
 * scripts/audit/lib/proxy-tunnel-context.cjs so this tool and the interaction harnesses
 * (vector-ui-walkthrough.cjs) share ONE implementation; read that file's header for WHY the
 * network has to be taken away from Chromium, and docs/audit/LIVE-UI-CONNECTION.md for the
 * standing rule.
 *
 * Usage: node proxy-browser.cjs <url> [output.png] [--cookie "k=v"] [--viewport WxH] [--wait ms] [--full]
 *        [--desktop] [--seed-storage '{"key":"value"}']
 *
 * Look for `Routed: N ok, 0 fail` — a non-zero fail count means assets did not load and the
 * screenshot is a half-empty page, not evidence.
 */
const { createTunneledContext } = require('./scripts/audit/lib/proxy-tunnel-context.cjs');

function parseArgs() {
  const a = process.argv.slice(2), opts = { vp: '430x932', wait: 5000, ck: '', full: false, seed: '', desktop: false }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]==='--cookie') opts.ck=a[++i]; else if (a[i]==='--viewport') opts.vp=a[++i];
    else if (a[i]==='--wait') opts.wait=+a[++i]; else if (a[i]==='--full') opts.full=true;
    else if (a[i]==='--seed-storage') opts.seed=a[++i]; else if (a[i]==='--desktop') opts.desktop=true;
    else pos.push(a[i]);
  }
  return { ...opts, url: pos[0], out: pos[1]||'screenshot.png' };
}

// Desktop-width viewport without --desktop silently renders with the mobile UA
// (BlackOutiOSApp/1.0) and isMobile:true — components that gate on that UA (useIosNativeShell(),
// isIosAppShell()) then render their compact/native-app variant stretched into a wide frame, which
// reads as a genuine desktop layout bug to anyone screenshotting it. Cost a whole Phase-0 UI/UX
// audit pass a false P0 and several miscategorized findings before being caught (see
// docs/audit/UI-UX-MAP.md's top-of-file correction, 2026-08-23). Exported so it's independently
// testable without spinning up a browser.
function mobileUaWarning(viewport, desktop) {
  const width = parseInt(String(viewport).split('x')[0], 10);
  if (desktop || !Number.isFinite(width) || width < 1024) return null;
  return (
    `⚠️  --viewport ${viewport} looks like a desktop width but --desktop was not passed — ` +
    `this will render with the MOBILE UA (BlackOutiOSApp/1.0, isMobile:true), not a real ` +
    `desktop browser. UA-gated components (useIosNativeShell, isIosAppShell) will show their ` +
    `compact/native-app variant, not the real desktop layout. Add --desktop if you want the real ` +
    `desktop UI. See docs/audit/LIVE-UI-CONNECTION.md.`
  );
}

/**
 * Scroll a page top-to-bottom in steps before a full-page screenshot, then return to the top.
 *
 * Playwright's `fullPage: true` screenshot renders the WHOLE document in one CDP capture without
 * ever dispatching real `scroll` events — so a scroll-triggered reveal (an IntersectionObserver-
 * gated opacity/transform animation, a "mount when scrolled into view" carousel) that depends on a
 * genuine scroll event never fires, and the capture shows those sections in their pre-reveal
 * state. Measured live on blackouttrades.com's homepage, 2026-08-24: the "SIX ENGINES" product-
 * screenshot carousel and the "HOW BLACKOUT THINKS" 4-stage timeline both rendered as large blank
 * voids under `fullPage: true` with no scrolling — real product screenshots and a fully-populated
 * timeline once actually scrolled through incrementally, exactly like a member scrolling the page
 * would see. `maxSteps` bounds worst-case wait time on an unexpectedly tall page rather than
 * looping indefinitely; a page taller than that just gets partial reveal coverage, which is still
 * strictly better than none.
 */
async function scrollThrough(page, { stepPx = 900, waitMs = 700, maxSteps = 40 } = {}) {
  const total = await page.evaluate(() => document.body.scrollHeight);
  let y = 0;
  let steps = 0;
  while (y < total && steps < maxSteps) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(waitMs);
    y += stepPx;
    steps += 1;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function main() {
  const o = parseArgs();
  if (!o.url) { console.error('Usage: node proxy-browser.cjs <url> [out.png]'); process.exit(1); }

  // A caller intentionally wanting the mobile UA at a wide viewport (e.g. proving a UA-gated
  // component's fallback) is rare but legitimate, so this stays a warning, not a refusal.
  const warning = mobileUaWarning(o.vp, o.desktop);
  if (warning) console.warn(warning);

  const { browser, ctx, counts } = await createTunneledContext({
    url: o.url,
    cookie: o.ck,
    viewport: o.vp,
    desktop: o.desktop,
    seedStorage: o.seed ? JSON.parse(o.seed) : null,
    requestTimeoutMs: 45000,
  });

  const page = await ctx.newPage();
  // Every framer-motion animation site-wide respects OS prefers-reduced-motion (MotionProvider.tsx
  // wraps the app in `<MotionConfig reducedMotion="user">`) — so a scroll-triggered reveal that
  // would otherwise be mid-transition when scrollThrough() moves past it instead applies instantly.
  // Gated on --full: a plain single-viewport shot isn't racing any scroll-triggered animation, and
  // this changes what's actually rendered, so it should only fire where it's solving a real problem.
  if (o.full) await page.emulateMedia({ reducedMotion: 'reduce' });
  console.log(`→ ${o.url}`);
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('DOM loaded');
  } catch (e) {
    console.warn(`nav: ${e.message.split('\n')[0]}`);
  }

  await page.waitForTimeout(o.wait);
  console.log(`Routed: ${counts.ok} ok, ${counts.fail} fail`);

  // Wait for network to settle (all pending requests to complete or timeout)
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    console.log('Network idle');
  } catch (e) {
    console.warn('Network timeout (continuing)');
  }

  // A full-page shot needs a real scroll-through FIRST — see scrollThrough()'s own comment for
  // why: scroll-triggered reveal content renders as blank voids without it.
  if (o.full) {
    await scrollThrough(page);
    console.log('Scrolled through for reveal animations');
  }

  // A LIVE desk never stops moving — SSE ticks, marks, pulsing status dots. Playwright's
  // screenshot waits for visual stability, so on /nighthawk it burned the whole 10s budget and
  // threw, leaving NO image while the page had loaded perfectly (145 requests routed, 0 failed).
  // `animations: 'disabled'` freezes CSS animations/transitions for the capture, which is the
  // supported way to shoot a page that is animating by design; the longer budget covers the
  // genuinely tall desk layouts.
  await page.screenshot({ path: o.out, fullPage: o.full, timeout: 45000, animations: 'disabled' });
  console.log(`Saved: ${o.out}`);
  await browser.close();
}

if (require.main === module) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { mobileUaWarning, scrollThrough };
