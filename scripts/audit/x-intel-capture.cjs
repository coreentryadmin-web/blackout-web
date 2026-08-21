/**
 * X-INTEL CAPTURE HARNESS — authenticated, framed screenshots of the BLACKOUT desks.
 *
 * Runs through `proxy-tunnel-context.cjs`, because Chromium in this sandbox has no network of its
 * own (docs/audit/LIVE-UI-CONNECTION.md). Verified working 2026-08-21: `Routed: 96-126 ok, 0 fail`
 * against production on Thermal, Vector and Helix.
 *
 * ── THE OPERATOR'S RULES, ENFORCED HERE RATHER THAN REMEMBERED (2026-08-21) ────────────────────
 *
 * 1. PRODUCT INTERFACE ONLY. Every capture frames a DESK CONTAINER (`.gex-heatmap-desk`,
 *    `.vector-chart-wrap`, `.helix-desk-terminal`), never `page.screenshot()`. That is what keeps
 *    the marketing nav and the "Open desk" CTA out of frame — a crop by pixel offset would drift
 *    the first time the header changes height.
 *
 * 2. THERMAL IS ALWAYS EXPIRY = ALL, and it is ASSERTED (`aria-pressed === "true"`), not clicked
 *    and hoped for. This is correctness, not framing: GexHeatmap defaults the scope to the FRONT
 *    expiry, and on 2026-08-21 that default read `LONG GAMMA · NET GEX -$1.8B` where ALL read
 *    `SHORT GAMMA at EVERY strike · NET GEX -$7.6B`. A post built on the default would have told
 *    readers dealers were dampening volatility on a day the book says they amplify it.
 *
 *    ALL is set on the MATRIX view BEFORE switching tabs. FORCED FLOW (DEPTH) renders no expiry
 *    bar at all — it is inherently near-term — so looking for the chip after switching finds a
 *    control that is legitimately absent, and the run dies on a rule that was already satisfied.
 *    The scope is shared component state, so setting it first carries into whichever tab follows.
 *
 * 3. CHARTS ARE ZOOMED. `--zoom N` wheels the chart in so individual candles, gamma beads and wall
 *    bands are legible. A screenshot at the default fit shows how the page loads, not what moved.
 *
 * Every wait here is a real settle time, not a guess dressed as one: the desks hydrate over SSE
 * and SWR, and the compare grid in particular loads its columns independently — a short wait
 * produces a half-loaded grid, which reads as a broken product rather than a fast capture.
 *
 * Usage:
 *   node scripts/audit/x-intel-capture.cjs --surface thermal --view matrix --lens GEX --cookie "$CK" --out shot.png
 *   node scripts/audit/x-intel-capture.cjs --surface thermal --sector Semis --cookie "$CK" --out grid.png
 *   node scripts/audit/x-intel-capture.cjs --surface vector --ticker SPX --horizon 0DTE --zoom 7 --cookie "$CK" --out v.png
 *   node scripts/audit/x-intel-capture.cjs --surface helix --ticker TSLA --panel analytics --cookie "$CK" --out h.png
 *
 * The cookie comes from `mintClerkPremiumSession`. Session JWTs are ~60s, so mint immediately
 * before the run; batch surfaces across runs rather than reusing a stale cookie.
 *
 * NOT A PUBLISHER. This writes PNGs. It has no path to x-api.ts and must never gain one.
 */
const { createTunneledContext } = require('./lib/proxy-tunnel-context.cjs');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : d; };


/**
 * Remove the marketing chrome before framing.
 *
 * Operator rule 1 is "pure product interface only". Framing on the desk container already excludes
 * the header from the CROP — but the site nav is position:fixed, so it floats OVER the desk and
 * lands inside an element screenshot anyway. Cropping it off afterwards would mean guessing a
 * pixel offset that changes the first time the header's height does.
 *
 * So it is removed from the layer instead, and matched by BEHAVIOUR (fixed/sticky, anchored near
 * the top, carrying marketing affordances) rather than by a class name that a redesign will
 * rename. Returns what it hid so a run says so out loud rather than silently altering the page.
 */
async function hideMarketingChrome(page) {
  return page.evaluate(() => {
    const MARKETING = /open desk|features|pricing|faq|learn/i;
    const hidden = [];
    for (const el of Array.from(document.querySelectorAll('header, [role="banner"], nav, div'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top > 120 || r.height > 220 || r.width < window.innerWidth * 0.5) continue;
      const txt = (el.textContent || '').trim().slice(0, 200);
      if (!MARKETING.test(txt)) continue;
      // A desk panel can be sticky too — never hide anything the desk owns.
      if (el.closest('.gex-heatmap-desk, .vector-chart-wrap, .helix-desk-terminal, .meridian-page-root')) continue;
      el.style.setProperty('display', 'none', 'important');
      hidden.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
    }
    return hidden;
  });
}


/**
 * MERIDIAN. Two desk views (Timeline / Analytics grid) and, on an opened event, five brief tabs
 * (Summary / Report / Estimates / Positioning / History).
 *
 * The timeline mixes earnings, macro, FDA and OpEx rows, so an event is selected by its THEME
 * class rather than by position — clicking "the first row" lands on whatever catalyst happens to
 * be nearest in time, which for an earnings post is usually a macro print with no earnings tabs
 * at all. That trap is already recorded in `meridian-earnings-ui-audit.mjs`; it is re-encoded here
 * rather than re-learned.
 */
async function meridian(page, o, log) {
  await page.goto('https://blackouttrades.com/meridian', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(12000);

  if (o.view === 'analytics') {
    const t = page.locator('[role="tab"]', { hasText: /^Analytics grid$/i }).first();
    if (await t.count()) { await t.click(); await page.waitForTimeout(8000); log.push('view→analytics grid'); }
  }

  // MACRO events (CPI / FOMC / NFP) live in the same catalyst lane as earnings, behind the class
  // filter. `--class macro` selects that filter and opens the event by its own theme, which is how
  // an event-day post gets the macro report panel rather than whatever earnings row was nearest.
  if (o.eventClass) {
    const chip = page.locator('[aria-label="Filter catalysts"] button, .meridian-filter-chip', {
      hasText: new RegExp(`^${o.eventClass}`, 'i'),
    }).first();
    if (await chip.count()) { await chip.click(); await page.waitForTimeout(4000); log.push(`class→${o.eventClass}`); }
    const row = page.locator(`.meridian-theme-${o.eventClass.toLowerCase()}`).first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(9000); log.push('event→opened'); }
    else log.push(`event→no ${o.eventClass} event listed (captured honestly)`);
  }

  if (o.ticker && o.ticker !== 'SPY' && !o.eventClass) {
    const search = page.locator('.meridian-search-input').first();
    if (await search.count()) {
      await search.fill(o.ticker); await page.waitForTimeout(3500); log.push(`search→${o.ticker}`);
    }
    // Select an EARNINGS row specifically — see the header note.
    const row = page.locator('.meridian-theme-earnings').filter({ hasText: o.ticker }).first();
    if (await row.count()) {
      await row.click(); await page.waitForTimeout(9000); log.push('event→opened');
    } else {
      log.push(`event→none for ${o.ticker} (captured honestly)`);
    }
  }

  if (o.panel) {
    const tab = page.locator('[role="tab"]', { hasText: new RegExp(`^${o.panel}$`, 'i') }).first();
    if (await tab.count()) {
      await tab.click(); await page.waitForTimeout(6000);
      if (await tab.getAttribute('aria-selected') !== 'true') throw new Error(`tab ${o.panel} did not select`);
      log.push(`tab→${o.panel} ✓`);
    } else throw new Error(`tab ${o.panel} not present — open an event first`);
  }

  // FRAME A DATA PANEL, NOT THE PAGE.
  //
  // `.meridian-page-root` is the whole scrollable desk — measured at 14,704px tall on the
  // analytics view, which is not an attachment, it is a screenshot of a spreadsheet. The operator's
  // rule is "only the data panels", and Meridian labels every one of them semantically, so the
  // panel is selected by its aria-label rather than by a layout class a redesign will rename.
  //
  //   After-hours movers · Catalyst timeline · Earnings calendar heat grid · Earnings window
  //   summary · EPS surprise versus revenue surprise scatter · Estimate revision timeline ·
  //   Event structure brief · High impact catalyst grid · Mega-cap earnings week · OpEx
  //   cross-market history · Prints in the next 24 hours · Recent calendar revisions ·
  //   Sector peers · Signal dimensions · Timeline summary
  //
  // Fifteen named panels is fifteen distinct frames before a ticker or a tab is even chosen.
  if (o.panelLabel) {
    const panel = page.locator(`[aria-label="${o.panelLabel}"]`).first();
    if (!(await panel.count())) throw new Error(`panel "${o.panelLabel}" not on this view — wrong desk view or no event open`);
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    log.push(`panel→${o.panelLabel}`);
    return panel;
  }
  // An OPENED EVENT frames on `.meridian-detail` — the header row (kicker · title · date · tab
  // pills) plus the tab body, and nothing else. Not `.meridian-page-root`, which is the whole
  // scrollable desk (measured 14,704px), and not the catalyst lane, which is navigation rather
  // than evidence.
  const detail = page.locator('.meridian-detail').first();
  if (await detail.count()) return detail;
  return page.locator('.meridian-page-root').first();
}


/**
 * THE UNIVERSE SCANNER — the story-discovery entry point, not just another frame.
 *
 * Vector's screener ranks every covered name by proximity to a regime change ("Nearest flip",
 * which the product itself labels *most actionable*), by pin strength ("Most pinned") or by
 * vol-expansion risk ("Most explosive"). Running this FIRST turns an hourly cycle from a browse
 * into a pick: the candidate list arrives pre-sorted.
 *
 * `--rows N` crops to the top N rows. The full panel renders ~2,500x3,750px, which is a
 * spreadsheet, not an attachment — the story is in the first ten to fifteen rows.
 */
async function scanner(page, o, log) {
  const t = (o.ticker || 'SPX').toUpperCase();
  const url = `https://blackouttrades.com/vector?ticker=${encodeURIComponent(t)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(14000);

  const panel = page.locator('.vector-scanner-panel').first();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  const summary = page.locator('.vector-scanner-summary').first();
  if (await summary.count()) { await summary.click().catch(() => {}); await page.waitForTimeout(3000); }

  const preset = o.preset || 'Nearest flip';
  const btn = page.locator('[aria-label="Screener view"] button', { hasText: new RegExp(preset, 'i') }).first();
  if (!(await btn.count())) throw new Error(`scanner preset "${preset}" not found`);
  await btn.click();
  await page.waitForTimeout(6000);
  log.push(`scanner→${preset}`);

  // Verify it actually populated — an empty screener is a real state ("No names match") and must
  // be captured honestly, but it must never be mistaken for a loaded one.
  const rowCount = await page.locator('.vector-scanner-body tr, .vector-scanner-body [role="row"]').count();
  log.push(`rows→${rowCount}`);

  if (o.rows) {
    // Crop to the top N rows by clipping the panel box — the story is the head of the ranking.
    const box = await panel.boundingBox();
    if (box) {
      const height = Math.min(box.height, 150 + Number(o.rows) * 26);
      return { clip: { x: box.x, y: box.y, width: box.width, height } };
    }
  }
  return panel;
}

const VIEW_TABS = { matrix: /^MATRIX$/i, profile: /GAMMA PROFILE/i, depth: /FORCED FLOW/i };

async function thermal(page, o, log) {
  await page.goto('https://blackouttrades.com/heatmap', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(9000);

  if (o.ticker !== 'SPY' && !o.sector) {
    await page.locator('[aria-label*="Change ticker"]').first().click({ timeout: 20000 });
    await page.locator('[aria-label="Search any ticker"]').first().fill(o.ticker);
    await page.waitForTimeout(1800);
    await page.locator('#ticker-listbox [role="option"]').first().click({ timeout: 15000 });
    await page.waitForTimeout(9000); log.push(`ticker→${o.ticker}`);
  }

  if (o.sector) {
    const toggle = page.locator('.thermal-grid-toolbar-toggle').first();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(3000); log.push('grid→on'); }
    const combo = page.locator('[aria-label="Sector compare preset"]').first();
    await combo.click(); await page.waitForTimeout(800);
    await page.locator('[role="listbox"] [role="option"]', { hasText: new RegExp(`^${o.sector}$`, 'i') }).first().click();
    await page.waitForTimeout(16000); log.push(`sector→${o.sector}`);
  }

  // EXPIRY = ALL — set FIRST, on the default MATRIX view where the chip bar exists.
  // FORCED FLOW (DEPTH) renders no expiry bar at all (it is inherently near-term), so clicking
  // ALL after switching tabs would look for a control that is legitimately absent. The scope is
  // component state shared across the tabs, so setting it here carries into whichever view we
  // then select. It is asserted, not assumed: the page DEFAULTS to the front expiry, and that
  // default flips the regime read (AUG 21 alone = LONG GAMMA; ALL = SHORT GAMMA at every strike).
  // `--expiry 0DTE` exists for VERIFICATION, not for published frames. The operator's rule is that
  // a published Thermal capture is always ALL; this lets a cycle read the near-dated levels so the
  // COPY can state which horizon each number belongs to. Capturing ALL and then describing a
  // far-dated structural wall as today's resistance is the error it exists to prevent.
  const wantExpiry = (o.expiry || 'All');
  // Resolve the chip by INDEX from its exact trimmed text.
  //
  // Both `hasText: /^0DTE$/` and `getByRole({ name, exact })` matched "All" and silently failed on
  // "0DTE" and "Aug 21" — the chips carry a `title` attribute, so the accessible name and the text
  // content disagree. Reading the real text and taking the index removes the ambiguity instead of
  // guessing at a matcher that happens to work for one label.
  // WAIT FOR THE BAR, do not race it. The expiry chips only render once the matrix data has
  // loaded, and after a ticker switch that can take well over the fixed wait above — an earlier
  // run found them and a later one found only "Grid", which is the signature of a race rather than
  // a selector fault. "All" is always present once the bar exists, so it is the readiness probe.
  await page
    .locator('button[aria-pressed]')
    .filter({ hasText: /^All$/ })
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => {});

  const chipTexts = await page
    .locator('button[aria-pressed]')
    .evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
  const chipIdx = chipTexts.findIndex((t) => t.toLowerCase() === wantExpiry.toLowerCase());
  const allChip = chipIdx >= 0 ? page.locator('button[aria-pressed]').nth(chipIdx) : page.locator('__none__');
  if (chipIdx >= 0) {
    await allChip.click(); await page.waitForTimeout(4500);
    if (await allChip.getAttribute('aria-pressed') !== 'true') throw new Error(`expiry ${wantExpiry} did not take`);
    log.push(`expiry→${wantExpiry.toUpperCase()} ✓`);
  } else if (!o.sector) {
    throw new Error(`expiry "${wantExpiry}" not among chips: ${chipTexts.slice(0, 8).join(", ")}`);
  }

  const lensBtn = page.locator('.thermal-desk-lens-rail [role="tab"]', { hasText: new RegExp(`^${o.lens}$`, 'i') }).first();
  if (await lensBtn.count()) { await lensBtn.click(); await page.waitForTimeout(2500); log.push(`lens→${o.lens}`); }

  if (!o.sector && VIEW_TABS[o.view]) {
    const tab = page.locator('[role="tab"]', { hasText: VIEW_TABS[o.view] }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(7000); log.push(`view→${o.view}`); }
  }

  return page.locator('.gex-heatmap-desk').first();
}

async function helix(page, o, log) {
  await page.goto('https://blackouttrades.com/flows', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(10000);
  for (const t of ['Skip','Got it','Close','Dismiss']) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count().catch(()=>0)) { await b.click().catch(()=>{}); await page.waitForTimeout(700); }
  }
  const search = page.locator('#helix-ticker-search').first();
  if (await search.count()) {
    await search.fill(o.ticker); await search.press('Enter').catch(()=>{});
    await page.waitForTimeout(12000); log.push(`symbol→${o.ticker}`);
  }
  if (o.panel === 'analytics') {
    const a = page.locator('button:has-text("ANALYTICS")').first();
    if (await a.count()) { await a.click(); await page.waitForTimeout(6000); log.push('analytics→open'); }
  }
  return page.locator('.helix-desk-terminal').first();
}


async function vector(page, o, log) {
  const url = `https://blackouttrades.com/vector?ticker=${encodeURIComponent(o.ticker)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(12000);

  // timeframe
  if (o.tf) {
    const sel = page.locator('#vector-tf-select').first();
    if (await sel.count()) { await sel.selectOption(o.tf).catch(()=>{}); await page.waitForTimeout(4000); log.push(`tf→${o.tf}`); }
  }
  // horizon chip (0DTE / WEEKLY / MONTHLY)
  if (o.horizon) {
    const h = page.locator('button', { hasText: new RegExp(`^${o.horizon}$`,'i') }).first();
    if (await h.count()) { await h.click().catch(()=>{}); await page.waitForTimeout(4000); log.push(`horizon→${o.horizon}`); }
  }

  // FULL SCREEN / COMPARE — first-class modes per the operator, not fallbacks.
  if (o.mode === 'fullscreen') {
    const fs = page.locator('button', { hasText: /^FULL SCREEN$/i }).first();
    if (await fs.count()) {
      await fs.click(); await page.waitForTimeout(6000);
      const exited = await page.locator('button', { hasText: /EXIT FULL SCREEN/i }).count();
      if (!exited) throw new Error('FULL SCREEN did not engage');
      log.push('mode→fullscreen ✓');
    }
  }
  if (o.mode === 'compare') {
    const cmp = page.locator('button', { hasText: /^COMPARE$/i }).first();
    if (await cmp.count()) { await cmp.click(); await page.waitForTimeout(7000); log.push('mode→compare'); }
    if (o.preset) {
      const pre = page.locator('button', { hasText: new RegExp(`^${o.preset}$`, 'i') }).first();
      if (await pre.count()) { await pre.click(); await page.waitForTimeout(18000); log.push(`preset→${o.preset}`); }
    }
    const grid = page.locator('.vector-compare, [class*="compare"]').first();
    if (await grid.count()) return grid;
    return page.locator('body').first();
  }

  // INDICATORS. The operator approved the zoomed-chart framing as the reference standard and asked
  // for 1-2 varied indicators per capture. Vector exposes ~18 across moving averages, key levels,
  // structure, oscillators, confluence, flow and expected move — a real variation axis, and the
  // product's OWN annotations (HH/HL, BOS/CHOCH, golden pocket, wall labels) are the annotations
  // the composition rules prefer over anything drawn on afterwards.
  //
  // ⚠️ NOT WORKING YET (2026-08-21). The menu trigger click times out — `.vector-ind-menu > button`
  // matches, but something intercepts the click. Left in place, opt-in via `--indicators`, and
  // wrapped so a failure DEGRADES rather than kills: an indicator is an enhancement to a frame,
  // not a precondition for it, so losing one must not cost the whole capture. The run says so out
  // loud in its step log rather than producing a frame that quietly lacks what the caption
  // promises. Next: find what is intercepting — likely an overlay or a pointer-events guard.
  if (o.indicators) {
    try {
    const trigger = page.locator('.vector-ind-menu > button').first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      for (const name of o.indicators.split(',').map((x) => x.trim()).filter(Boolean)) {
        const item = page.locator('[role="menuitemcheckbox"]', { hasText: new RegExp(name, 'i') }).first();
        if (!(await item.count())) { log.push(`indicator?${name} absent`); continue; }
        const before = await item.getAttribute('aria-checked');
        await item.click();
        await page.waitForTimeout(900);
        const after = await item.getAttribute('aria-checked');
        // Report what actually toggled rather than what was asked for — an indicator that silently
        // failed to enable would leave the frame missing the evidence the caption promises.
        log.push(`indicator→${name}${before === after ? ' (NO CHANGE)' : ' ✓'}`);
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      log.push('indicators→menu trigger not found');
    }
    } catch (e) {
      log.push(`indicators→FAILED (${String(e.message).split('\n')[0].slice(0, 60)}) — frame captured without them`);
    }
  }

  const chart = page.locator('.vector-chart-wrap').first();
  await chart.waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(4000);

  // ZOOM. The operator's exemplar is a TIGHT window — individual candles and gamma beads
  // legible — not the default full-session fit the page loads with. A screenshot of the
  // default view is "how the page loads", not evidence of a move.
  const box = await chart.boundingBox();
  if (box) {
    const cx = box.x + box.width * 0.72, cy = box.y + box.height * 0.5;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < Number(o.zoom || 6); i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(450); }
    await page.waitForTimeout(3500);
    // Park the pointer OFF the chart. Leaving it on leaves a crosshair readout floating over the
    // frame — a tooltip obscuring the data is on the operator's reject list, and it is the one
    // artefact a zoomed capture reliably introduces.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1200);
    log.push(`zoom→${o.zoom || 6}`);
  }
  return chart;
}

(async () => {
  const o = {
    surface: arg('surface','thermal'), ticker: arg('ticker','SPY').toUpperCase(),
    view: arg('view','matrix'), lens: arg('lens','GEX').toUpperCase(),
    sector: arg('sector',''), panel: arg('panel',''), out: arg('out','/tmp/shots/out.png'),
    tf: arg('tf',''), horizon: arg('horizon',''), zoom: arg('zoom','6'),
    mode: arg('mode',''), preset: arg('preset',''), indicators: arg('indicators',''),
    expiry: arg('expiry',''), rows: arg('rows',''), panelLabel: arg('panel-label',''), eventClass: arg('class',''),
  };
  const { browser, ctx, counts } = await createTunneledContext({
    url: 'https://blackouttrades.com/', cookie: arg('cookie',''), viewport: arg('viewport','2560x1440'), desktop: true,
  });
  const page = await ctx.newPage(); const log = [];
  try {
    const target = o.surface === 'helix' ? await helix(page, o, log)
      : o.surface === 'vector' ? await vector(page, o, log)
      : o.surface === 'meridian' ? await meridian(page, o, log)
      : o.surface === 'scanner' ? await scanner(page, o, log)
      : await thermal(page, o, log);
    const hid = await hideMarketingChrome(page);
    if (hid.length) log.push(`chrome hidden→${hid.length}`);
    await page.waitForTimeout(600);
    if (target && target.clip) {
      await page.screenshot({ path: o.out, clip: target.clip, timeout: 60000, animations: 'disabled' });
    } else {
      await target.waitFor({ state: 'visible', timeout: 25000 });
      await target.screenshot({ path: o.out, timeout: 60000, animations: 'disabled' });
    }
    console.log(`Routed: ${counts.ok} ok, ${counts.fail} fail | ${log.join(' · ')} | ${o.out}`);
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
