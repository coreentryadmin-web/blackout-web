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

async function main() {
  const o = parseArgs();
  if (!o.url) { console.error('Usage: node proxy-browser.cjs <url> [out.png]'); process.exit(1); }

  const { browser, ctx, counts } = await createTunneledContext({
    url: o.url,
    cookie: o.ck,
    viewport: o.vp,
    desktop: o.desktop,
    seedStorage: o.seed ? JSON.parse(o.seed) : null,
  });

  const page = await ctx.newPage();
  console.log(`→ ${o.url}`);
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('DOM loaded');
  } catch (e) {
    console.warn(`nav: ${e.message.split('\n')[0]}`);
  }

  await page.waitForTimeout(o.wait);
  console.log(`Routed: ${counts.ok} ok, ${counts.fail} fail`);

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

main().catch(e => { console.error(e.message); process.exit(1); });
