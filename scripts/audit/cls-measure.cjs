/**
 * cls-measure — measure Cumulative Layout Shift on a live page through the agent-proxy tunnel.
 *
 * WHY this exists: the homepage desktop CLS regression (#2453) could only ever be *inferred* from
 * the animation diff (top → transform). "verify green" proves an image shipped, not that layout is
 * stable. This measures the real Web Vital in a real (tunneled) Chromium: a PerformanceObserver on
 * `layout-shift`, summing shift values excluding user-input-driven shifts, exactly as Lighthouse/CrUX
 * define CLS. It scrolls the page to trigger any in-viewport-entry animations (the sweep/spulse
 * keyframes were the culprit) so a shift that only fires on scroll is not missed.
 *
 * Chromium never touches the network — same CONNECT+tls tunnel as proxy-browser.cjs.
 *
 * Usage: node scripts/audit/cls-measure.cjs <url> [--viewport WxH] [--wait ms] [--cookie "k=v"] [--json]
 * Exit non-zero if CLS >= 0.1 (the "needs improvement" boundary) so it can gate.
 */
const { createTunneledContext } = require('./lib/proxy-tunnel-context.cjs');

function parseArgs() {
  const a = process.argv.slice(2), o = { vp: '1440x900', wait: 6000, ck: '', json: false }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--viewport') o.vp = a[++i];
    else if (a[i] === '--wait') o.wait = +a[++i];
    else if (a[i] === '--cookie') o.ck = a[++i];
    else if (a[i] === '--json') o.json = true;
    else pos.push(a[i]);
  }
  return { ...o, url: pos[0] };
}

async function main() {
  const o = parseArgs();
  if (!o.url) { console.error('Usage: node scripts/audit/cls-measure.cjs <url> [--viewport WxH]'); process.exit(2); }

  const { browser, ctx, counts } = await createTunneledContext({ url: o.url, cookie: o.ck, viewport: o.vp, desktop: true });
  const page = await ctx.newPage();

  // Install the observer BEFORE navigation so the very first shifts are captured.
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__cls += entry.value;
            if (entry.value >= 0.01) window.__shifts.push(+entry.value.toFixed(4));
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { window.__clsErr = String(e); }
  });

  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.warn(`nav: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(o.wait);

  // Scroll through the page to trip any entry-animation shifts, then settle.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts, err: window.__clsErr }));
  await browser.close();

  const cls = +(res.cls || 0).toFixed(4);
  const verdict = cls < 0.1 ? 'GOOD' : cls < 0.25 ? 'NEEDS-IMPROVEMENT' : 'POOR';
  if (o.json) {
    console.log(JSON.stringify({ url: o.url, viewport: o.vp, cls, verdict, shifts: res.shifts, routed: counts, observerErr: res.err || null }, null, 2));
  } else {
    console.log(`\nURL:      ${o.url}`);
    console.log(`Viewport: ${o.vp}`);
    console.log(`Routed:   ${counts.ok} ok, ${counts.fail} fail${counts.fail ? '  ⚠️ assets failed — result suspect' : ''}`);
    console.log(`CLS:      ${cls}  → ${verdict}`);
    if (res.shifts && res.shifts.length) console.log(`Shifts ≥0.01: ${res.shifts.join(', ')}`);
    if (res.err) console.log(`Observer error: ${res.err}`);
  }
  process.exit(cls < 0.1 ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
