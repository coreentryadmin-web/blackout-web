/**
 * LIVE VISUAL MATRIX — does the card generator work, across the questions members actually ask?
 *
 * Every card check before this one went through `POST /api/largo/visual` and asserted on the JSON.
 * That validates the ENDPOINT. It does not validate the FEATURE: the member's path runs through a
 * streamed answer, an auto-render directive, a template/size/format picker and a RENDER IMAGE
 * button, and defects have already been found at three of those layers that the endpoint check
 * could not see (the refusal, the raw markdown, the harness's own severed SSE).
 *
 * So this drives the real browser: type the question, wait for the answer, find the visual panel,
 * click RENDER IMAGE, and record whether a card actually appeared — plus a screenshot of each.
 *
 * SCENARIOS ARE CHOSEN FOR THE EDGES, not the happy path. A matrix of five ways to ask for an NVDA
 * card proves nothing; the interesting cases are the ones where the honest answer is "no card":
 * a ticker with no data, a question with no numbers in it, a refusal. A generator that draws
 * something anyway is worse than one that draws nothing.
 *
 *   node scripts/audit/largo-visual-matrix.cjs --cookie "$CK" --out DIR [--only N]
 */
const { createTunneledContext } = require('./lib/proxy-tunnel-context.cjs');
const { writeFileSync, mkdirSync } = require('node:fs');

const BASE = (process.env.VALIDATE_BASE || 'https://blackouttrades.com').replace(/\/$/, '');

/** `expectCard` is what the run is judged against — see the header on why the NO cases matter most. */
const SCENARIOS = [
  { id: 'nh-plays',   q: 'Can you generate me an image for todays Night Hawk plays',        expectCard: true },
  { id: 'ticker-nvda',q: 'Generate an image of how NVDA looks today',                        expectCard: true },
  { id: 'spx-gamma',  q: 'Make me a card of the SPX gamma picture right now',                expectCard: true },
  { id: 'flow',       q: 'Create an image of the biggest options flow today',                expectCard: true },
  { id: '0dte',       q: 'Generate an image of todays 0DTE board results',                   expectCard: true },
  { id: 'unknown-tkr',q: 'Generate an image for ZZZQ positioning',                           expectCard: false },
  { id: 'no-numbers', q: 'Can you make me an image about how trading feels',                 expectCard: false },
  { id: 'earnings',   q: 'Create an image of this weeks earnings calendar',                  expectCard: true },
  { id: 'crwv',       q: 'Generate an image for CRWV earnings setup today',                  expectCard: true },
  { id: 'record',     q: 'Make an image of the track record this month',                     expectCard: true },
];

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { ck: '', out: '/tmp/largo-visual', only: 0, wait: 130000 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--cookie') o.ck = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--only') o.only = +a[++i];
    else if (a[i] === '--wait') o.wait = +a[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs();
  if (!o.ck) { console.error('need --cookie'); process.exit(1); }
  mkdirSync(o.out, { recursive: true });
  const list = o.only ? SCENARIOS.slice(0, o.only) : SCENARIOS;

  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/terminal`, cookie: o.ck, viewport: '1500x1400', desktop: true,
  });
  const page = await ctx.newPage();
  const rows = [];
  try {
    await page.goto(`${BASE}/terminal`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    const SEL = 'textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [contenteditable="true"], [role="textbox"]';
    const box = page.locator(SEL).first();
    await box.waitFor({ timeout: 20000, state: 'attached' });

    for (const sc of list) {
      const t0 = Date.now();
      console.log(`\n[${sc.id}] ${sc.q}`);
      await box.click();
      await box.fill(sc.q);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(o.wait);

      // CREATE VISUAL opens the picker; RENDER IMAGE is the only control that produces output.
      // Both are matched on their visible text — a class here would be a styling detail that
      // silently drifts, and a missing selector must read as "button absent", not "card absent".
      const clickByText = async (re) => {
        const b = page.locator('button', { hasText: re }).first();
        if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); return true; }
        return false;
      };
      const openedPicker = await clickByText(/create visual/i);
      if (openedPicker) await page.waitForTimeout(3000);
      const clickedRender = await clickByText(/render image/i);
      if (clickedRender) await page.waitForTimeout(9000);

      // A card is present when an <img> the page created from a blob/data URL is on screen, or the
      // inline markup card rendered. Counted in the DOM rather than by eye so the verdict is data.
      const probe = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')]
          .filter((i) => /^(blob:|data:image)/.test(i.src) && i.naturalWidth > 200);
        const inline = document.querySelectorAll('.largo-visual-card, [class*="visual-card"], [class*="largo-visual"]').length;
        const refusal = /cannot generate images|not a graphics engine|nothing to render|no template can be filled/i.test(document.body.innerText);
        const truncation = /no room on this card/i.test(document.body.innerText);
        return { imgs: imgs.length, imgW: imgs[0]?.naturalWidth ?? 0, imgH: imgs[0]?.naturalHeight ?? 0, inline, refusal, truncation };
      });

      const drew = probe.imgs > 0 || probe.inline > 0;
      const verdict = drew === sc.expectCard ? 'PASS' : (sc.expectCard ? 'FAIL(no card)' : 'FAIL(drew anyway)');
      const shot = `${o.out}/${sc.id}.png`;
      await page.screenshot({ path: shot, timeout: 15000 }).catch(() => {});
      const row = { ...sc, ...probe, drew, verdict, openedPicker, clickedRender, ms: Date.now() - t0, shot };
      rows.push(row);
      console.log(`  ${verdict} · card=${drew} img=${probe.imgs}(${probe.imgW}x${probe.imgH}) inline=${probe.inline} refusal=${probe.refusal} truncNote=${probe.truncation} picker=${openedPicker} render=${clickedRender}`);
    }
  } finally {
    console.log(`\nRouted: ${counts.ok} ok, ${counts.fail} fail, ${counts.streamsBuffered} streams buffered`);
    writeFileSync(`${o.out}/matrix.json`, JSON.stringify(rows, null, 2));
    const pass = rows.filter((r) => r.verdict === 'PASS').length;
    console.log(`\nMATRIX ${pass}/${rows.length} PASS`);
    for (const r of rows) console.log(`  ${r.verdict.padEnd(16)} ${r.id}`);
    await browser.close();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
