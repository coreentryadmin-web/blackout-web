/**
 * LARGO INTERACTION walkthrough — type a real question into the live desk and read what renders.
 *
 * WHY THIS EXISTS. Every Largo audit so far has gone through `POST /api/market/largo/query` and
 * asserted on the JSON. That validates the ANSWER and says nothing about the ANSWER AS RENDERED —
 * and the two have already diverged in production: the structured evidence rows printed `**bold**`
 * as literal asterisks for months while every API-level check passed, because the asterisks are in
 * the JSON and are supposed to be.
 *
 * Screenshotting `/terminal` with a seeded session does not work either, and the reason is worth
 * recording: `createTunneledContext`'s `seedStorage` writes **localStorage**, while `useLargoChat`
 * restores from **sessionStorage** (`largo-terminal-session`). A seeded session silently renders
 * the empty state, which looks exactly like "Largo returned nothing" — a harness bug that reads as
 * a product bug. So this harness does what a member does: types the question and waits.
 *
 * Chromium cannot reach the network here; the CONNECT-tunnel context is shared with
 * proxy-browser.cjs. Read docs/audit/LIVE-UI-CONNECTION.md before changing anything about that.
 *
 * Usage:
 *   node scripts/audit/largo-ui-walkthrough.cjs --cookie "$CK" [--out DIR] [--q "question"]...
 *
 * Look for `Routed: N ok, 0 fail`. A non-zero fail count means assets did not load and the
 * screenshots are half-empty pages, not evidence.
 */
const { createTunneledContext } = require('./lib/proxy-tunnel-context.cjs');

const BASE = (process.env.VALIDATE_BASE || 'https://blackouttrades.com').replace(/\/$/, '');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { ck: '', out: '/tmp/largo-ui', qs: [], wait: 90000 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--cookie') o.ck = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--q') o.qs.push(a[++i]);
    else if (a[i] === '--wait') o.wait = +a[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs();
  if (!o.ck) { console.error('need --cookie'); process.exit(1); }
  if (!o.qs.length) { console.error('need at least one --q'); process.exit(1); }

  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/terminal`,
    cookie: o.ck,
    viewport: '1500x1200',
    desktop: true,
  });

  const page = await ctx.newPage();
  const results = [];
  try {
    await page.goto(`${BASE}/terminal`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);

    // The composer. Matched on the placeholder rather than a class, because a class is a styling
    // detail that changes without notice and a silently-missing selector would make this harness
    // report "no answer" for a desk that works.
    // Broad on purpose. An earlier version matched only `textarea, input[type=text]` and timed out
    // on a desk that works — the composer is neither. A harness that cannot find the control must
    // say WHAT IT SAW rather than fail with a bare timeout, or every future selector drift costs
    // another debugging round-trip.
    const SEL = 'textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [contenteditable="true"], [role="textbox"]';
    const box = page.locator(SEL).first();
    try {
      await box.waitFor({ timeout: 20000, state: 'attached' });
    } catch {
      const seen = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('input,textarea,[contenteditable],[role=textbox],button')) {
          out.push({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            placeholder: el.getAttribute('placeholder') || '',
            aria: el.getAttribute('aria-label') || '',
            cls: (el.className || '').toString().slice(0, 60),
            text: (el.innerText || '').slice(0, 40),
          });
        }
        return out.slice(0, 40);
      });
      console.log('COMPOSER NOT FOUND. Interactive elements on the page:');
      console.log(JSON.stringify(seen, null, 1));
      throw new Error('composer not found — see the element dump above');
    }

    for (let i = 0; i < o.qs.length; i++) {
      const q = o.qs[i];
      console.log(`\n[${i + 1}/${o.qs.length}] ${q}`);
      await box.click();
      await box.fill(q);
      await page.keyboard.press('Enter');

      // Wait for a rendered answer, not a fixed sleep. The turn takes 15-40s depending on how many
      // tools run, so a fixed wait either truncates the slow ones or wastes minutes on the fast.
      const started = Date.now();
      let text = '';
      while (Date.now() - started < o.wait) {
        await page.waitForTimeout(2500);
        text = await page.evaluate(() => document.body.innerText || '');
        // The composer clears and the answer lands; "Verdict" is the contract's first section.
        if (/verdict/i.test(text) && !/thinking|pulling live data/i.test(text.slice(-400))) break;
      }
      const ms = Date.now() - started;

      // Evidence that the RENDER is right, not just that text arrived.
      const probe = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const q = (s) => document.querySelectorAll(s).length;
        return {
          literalAsterisks: (body.match(/\*\*/g) || []).length,
          boldSpans: q('.largo-fmt-bold'),
          numSpans: q('.largo-fmt-num'),
          evidenceRows: q('.bie-evidence-row, [class*="bie-evidence"]'),
          kindChips: q('.bie-kind'),
          sourceStamps: q('.bie-source'),
          blocks: q('[class*="largo-block"]'),
          chars: body.length,
        };
      });
      console.log(`   ${Math.round(ms / 1000)}s · ${JSON.stringify(probe)}`);
      if (probe.literalAsterisks > 0) {
        console.log(`   ^^ ${probe.literalAsterisks} literal "**" ON SCREEN — markdown is not being rendered`);
      }
      results.push({ q, ms, ...probe });

      await page.screenshot({ path: `${o.out}/largo-q${i + 1}.png`, fullPage: true });
    }
  } finally {
    console.log(`\nRouted: ${counts.ok} ok, ${counts.fail} fail`);
    console.log(JSON.stringify(results, null, 1));
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
