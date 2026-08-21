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
const { createTunneledContext, applyCookieToContext } = require('./lib/proxy-tunnel-context.cjs');
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
 * Build a case-insensitive matcher from an operator-supplied string, ESCAPED.
 *
 * Every `--flag` on this script eventually becomes a Playwright `hasText` regex, and interpolating
 * raw input into `new RegExp` is wrong twice over.
 *
 * CodeQL flags it as regular-expression injection, which for a local capture harness is a thin
 * threat model. The reason it actually matters is that it is a live correctness bug: the Vector
 * indicator menu labels its opening-range item "Opening range (30m)", and
 * `new RegExp("Opening range (30m)")` reads those parentheses as a capture group, so the pattern
 * becomes `Opening range 30m` and matches nothing. Verified: unescaped `false`, escaped `true`.
 *
 * A label with a metacharacter silently selects the wrong control or no control — exactly the
 * failure class that cost a day on this file already, arriving through a different door.
 *
 * `anchor: true` wraps in ^...$ AFTER escaping, so the anchors are the matcher's and never the
 * caller's.
 */
function textMatch(value, { anchor = true } = {}) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(anchor ? `^${escaped}$` : escaped, 'i');
}

/**
 * Render a container LARGER before screenshotting it.
 *
 * A dense table is the one thing this desk builds that a feed cannot carry. The Universe Scanner
 * at 2560 wide measures 2512x498 — a 5:1 strip that the frame scorer rejects twice over, for
 * aspect and for legibility 0.43, and it is right: eleven rows of small mono type letterboxed to
 * a sliver is a screenshot a reader has to tap to use.
 *
 * Narrowing the viewport fixes the aspect but not the type, because legibility here is the share
 * of the frame a glyph occupies, and that does not change when you shrink the page around it.
 * CSS zoom does change it: the layout reflows at the larger size, so the glyphs grow relative to
 * the frame and the panel gets taller, which improves both numbers at once.
 *
 * Applied to the container rather than the body so the surrounding page does not reflow around a
 * scaled document, and reverted implicitly by the run ending.
 */
async function zoomContainer(page, selector, factor) {
  return page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.style.setProperty('zoom', String(f));
      return true;
    },
    [selector, factor],
  );
}

/**
 * The FIRST match is usually the WRONG match on this desk.
 *
 * `VectorToolbar` renders its controls TWICE — a compact row for narrow viewports and a desk row —
 * and CSS collapses the unused one to a zero-size box rather than unmounting it. Both copies carry
 * the same test id, both report `display: inline-flex` and `visibility: visible`, and
 * `document.elementFromPoint` at the compact copy's origin returns the nav, because its rect is
 * literally `0,0,0,0`.
 *
 * So `.first()` resolves to a control that can never be clicked, and Playwright reports that as an
 * 8-second click timeout — which reads as "the button is broken" rather than "you are pointing at
 * the invisible one". That one mistake cost a day on the Indicators menu and FULL SCREEN alike.
 *
 * MEASURED 2026-08-21 on /vector?ticker=NVDA at 2560x1440: copy 0 rect `[0,0,0,0]`, copy 1 rect
 * `[570,89,116,32]` with the hit test resolving to itself.
 *
 * Playwright's visibility test is "non-empty bounding box and not `visibility:hidden`", so the
 * `:visible` engine is exactly the right filter here.
 */
function vis(page, selector) {
  return page.locator(`${selector} >> visible=true`).first();
}

/**
 * Post-navigation settle — wait for the desk to hydrate, THEN clear the marketing chrome.
 *
 * The nav is `position: fixed`, so it floats over the desk toolbar. Playwright's actionability
 * check will not click through an element that something else is receiving the pointer for, which
 * is why the Indicators trigger and FULL SCREEN both timed out with selectors that matched fine:
 * the click was landing on the nav. Chrome is therefore suppressed BEFORE the first interaction,
 * not only before the screenshot. The final pass at capture time stays — React re-mounts the nav
 * on route and state changes, so hiding it once is not the same as it staying hidden.
 */
async function settle(page, ms, log) {
  await page.waitForTimeout(ms);
  const hid = await hideMarketingChrome(page);
  // Name what was removed, not just how many. Hiding the wrong node is silent otherwise — and the
  // Vector toolbar carries a "Features" button, which is exactly the word the marketing matcher
  // looks for.
  if (hid.length && log) log.push(`chrome hidden→${hid.join(', ')}`);
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
  await settle(page, 12000, log);

  if (o.view === 'analytics') {
    const t = page.locator('[role="tab"]', { hasText: /^Analytics grid$/i }).first();
    if (await t.count()) { await t.click(); await page.waitForTimeout(8000); log.push('view→analytics grid'); }
  }

  // MACRO events (CPI / FOMC / NFP) live in the same catalyst lane as earnings, behind the class
  // filter. `--class macro` selects that filter and opens the event by its own theme, which is how
  // an event-day post gets the macro report panel rather than whatever earnings row was nearest.
  if (o.eventClass) {
    const chip = page.locator('[aria-label="Filter catalysts"] button, .meridian-filter-chip', {
      hasText: textMatch(o.eventClass, { anchor: false }),
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
    const tab = page.locator('[role="tab"]', { hasText: textMatch(o.panel) }).first();
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
  await settle(page, 14000, log);

  const panel = page.locator('.vector-scanner-panel').first();
  await panel.waitFor({ state: 'visible', timeout: 30000 });
  const summary = page.locator('.vector-scanner-summary').first();
  if (await summary.count()) { await summary.click().catch(() => {}); await page.waitForTimeout(3000); }

  const preset = o.preset || 'Nearest flip';
  const btn = page.locator('[aria-label="Screener view"] button', { hasText: textMatch(preset, { anchor: false }) }).first();
  if (!(await btn.count())) throw new Error(`scanner preset "${preset}" not found`);
  await btn.click();
  await page.waitForTimeout(6000);
  log.push(`scanner→${preset}`);

  // Verify it actually populated — an empty screener is a real state ("No names match") and must
  // be captured honestly, but it must never be mistaken for a loaded one.
  const rowCount = await page.locator('.vector-scanner-body tr, .vector-scanner-body [role="row"]').count();
  log.push(`rows→${rowCount}`);

  // Type size is the whole game for a table attachment; see `zoomContainer`.
  if (o.pageZoom) {
    const ok = await zoomContainer(page, '.vector-scanner-panel', o.pageZoom);
    await page.waitForTimeout(1500);
    log.push(`page-zoom→${o.pageZoom}${ok ? '' : ' (NO TARGET)'}`);
  }

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
  // TICKER IN THE URL, not through the search UI.
  //
  // `/heatmap` itself redirects to `?ticker=SPY&lens=gex`, so the query is the page's own state
  // channel and it honours whatever is put there. Driving it that way removes three interactions
  // that could each fail (open the ticker menu, type, pick the option) and, more importantly,
  // removes the need for the desk to be interactive before the ticker is even chosen.
  //
  // That mattered: NVDA's heatmap ran a rebuild loop (`force=1&n=1..4`) and took ~30s to render,
  // during which the desk shows "Loading heatmap…" and the ticker control does not exist. The old
  // flow clicked at 9s and reported a 20s click timeout — which reads as a broken control rather
  // than a slow build. MEASURED 2026-08-21: every API call returned 200 the whole time.
  const lens = (o.lens || 'GEX').toLowerCase();
  const url = `https://blackouttrades.com/heatmap?ticker=${encodeURIComponent(o.ticker)}&lens=${encodeURIComponent(lens)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page, 9000, log);
  // Wait for the desk to finish building rather than for a clock to run out. The expiry chips are
  // the readiness signal — they only exist once the matrix has data.
  await page
    .locator('button[aria-pressed]')
    .first()
    .waitFor({ state: 'visible', timeout: 75000 })
    .catch(() => {});
  log.push(`ticker→${o.ticker} (url)`);


  if (o.sector) {
    const toggle = page.locator('.thermal-grid-toolbar-toggle').first();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(3000); log.push('grid→on'); }
    const combo = page.locator('[aria-label="Sector compare preset"]').first();
    await combo.click(); await page.waitForTimeout(800);
    await page.locator('[role="listbox"] [role="option"]', { hasText: textMatch(o.sector) }).first().click();
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

  const lensBtn = page.locator('.thermal-desk-lens-rail [role="tab"]', { hasText: textMatch(o.lens) }).first();
  if (await lensBtn.count()) { await lensBtn.click(); await page.waitForTimeout(2500); log.push(`lens→${o.lens}`); }

  if (!o.sector && VIEW_TABS[o.view]) {
    const tab = page.locator('[role="tab"]', { hasText: VIEW_TABS[o.view] }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(7000); log.push(`view→${o.view}`); }
  }

  return page.locator('.gex-heatmap-desk').first();
}

async function helix(page, o, log) {
  await page.goto('https://blackouttrades.com/flows', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page, 10000, log);
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
  await settle(page, 12000, log);

  // timeframe
  if (o.tf) {
    const sel = vis(page, '#vector-tf-select');
    if (await sel.count()) { await sel.selectOption(o.tf).catch(()=>{}); await page.waitForTimeout(4000); log.push(`tf→${o.tf}`); }
  }
  // horizon chip (0DTE / WEEKLY / MONTHLY)
  if (o.horizon) {
    const h = page.locator('button', { hasText: textMatch(o.horizon) }).first();
    if (await h.count()) { await h.click().catch(()=>{}); await page.waitForTimeout(4000); log.push(`horizon→${o.horizon}`); }
  }

  // ORDER: indicators BEFORE mode. Entering full screen first and then opening the Indicators menu
  // dropped the chart back to its column width — a 2512x1354 frame became 1196x1398, portrait, in
  // an otherwise identical run (MEASURED 2026-08-21). Same shape as the Thermal lesson: set the
  // state that lives on the base view, THEN change the view.
  // The trigger click used to time out. The selector was never the problem — the fixed marketing
  // nav was floating over the toolbar and receiving the pointer, so Playwright correctly refused
  // to click through it. `settle()` now clears the chrome before the first interaction. The
  // trigger is addressed by its test id rather than by `.vector-ind-menu > button`, so a wrapper
  // element added later does not silently break it.
  //
  // Still wrapped so a failure DEGRADES rather than kills: an indicator is an enhancement to a
  // frame, not a precondition for it, so losing one must not cost the whole capture. The run says
  // so out loud in its step log rather than producing a frame that quietly lacks what the caption
  // promises.
  if (o.indicators) {
    try {
    const trigger = vis(page, '[data-testid="vector-indicator-trigger"]');
    // WAIT for it rather than asking whether it is there yet. The toolbar hydrates after the
    // chart, and at a 12s settle a `count()` returns 0 while a 14s probe on the same URL finds the
    // trigger every time — so the old check was reporting a race as an absent control.
    await trigger.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await trigger.count()) {
      await trigger.click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      for (const name of o.indicators.split(',').map((x) => x.trim()).filter(Boolean)) {
        const item = page
          .locator('[role="menuitemcheckbox"] >> visible=true', { hasText: textMatch(name, { anchor: false }) })
          .first();
        if (!(await item.count())) { log.push(`indicator?${name} absent`); continue; }
        // An MA family the current timeframe cannot compute renders DISABLED ("needs ≥N bars").
        // Clicking it would hang on actionability; say which one and why instead.
        if (await item.isDisabled()) {
          const why = (await item.getAttribute('title')) || 'unavailable at this timeframe';
          log.push(`indicator!${name} disabled (${why.slice(0, 40)})`);
          continue;
        }
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
      // Vector ships with indicators already ON (the trigger carries a badge count). Report the
      // set the frame actually carries, so a caption never credits an overlay that a toggle just
      // turned off.
      const badge = (await trigger.textContent()) || '';
      log.push(`indicators on→${badge.replace(/[^0-9]/g, '') || '0'}`);
    } else {
      log.push('indicators→menu trigger not found');
    }
    } catch (e) {
      log.push(`indicators→FAILED (${String(e.message).split('\n')[0].slice(0, 60)}) — frame captured without them`);
    }
  }

  // FULL SCREEN / COMPARE — first-class modes per the operator, not fallbacks.
  if (o.mode === 'fullscreen') {
    const fs = vis(page, 'button:text-is("Full screen")');
    if (await fs.count()) {
      await fs.click(); await page.waitForTimeout(6000);
      const exited = await page.locator('button:text-is("Exit full screen") >> visible=true').count();
      if (!exited) throw new Error('FULL SCREEN did not engage');
      log.push('mode→fullscreen ✓');
    }
  }
  if (o.mode === 'compare') {
    const cmp = vis(page, 'button:text-is("Compare")');
    if (await cmp.count()) { await cmp.click(); await page.waitForTimeout(7000); log.push('mode→compare'); }
    if (o.preset) {
      const pre = page.locator('button', { hasText: textMatch(o.preset) }).first();
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

  const chart = page.locator('.vector-chart-wrap').first();
  await chart.waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(4000);

  // ZOOM. The operator's exemplar is a TIGHT window — individual candles and gamma beads
  // legible — not the default full-session fit the page loads with. A screenshot of the
  // default view is "how the page loads", not evidence of a move.
  //
  // ANCHOR NEAR THE RIGHT EDGE. The chart zooms about the cursor, so wheeling at 72% width walks
  // the newest bars off-frame: at `--zoom 11` the last candle shown was 12:12 on a chart that was
  // live to 14:00 (MEASURED 2026-08-21). For a post whose whole claim is that the desk saw a move
  // as it happened, the right edge is the evidence — losing it is not a cosmetic loss.
  const box = await chart.boundingBox();
  if (box) {
    const anchor = Number(o.zoomAnchor || 0.9);
    const cx = box.x + box.width * anchor, cy = box.y + box.height * 0.5;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < Number(o.zoom || 6); i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(450); }
    await page.waitForTimeout(3500);
    // Park the pointer OFF the chart. Leaving it on leaves a crosshair readout floating over the
    // frame — a tooltip obscuring the data is on the operator's reject list, and it is the one
    // artefact a zoomed capture reliably introduces.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1200);
    log.push(`zoom→${o.zoom || 6}@${anchor}`);
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
    zoomAnchor: arg('zoom-anchor',''), pageZoom: arg('page-zoom',''),
    expiry: arg('expiry',''), rows: arg('rows',''), panelLabel: arg('panel-label',''), eventClass: arg('class',''),
  };
  /**
   * AUTHENTICATE IN-PROCESS, AND KEEP AUTHENTICATING.
   *
   * A Clerk `__session` JWT lives about a minute. A capture run lives two to five — every surface
   * here waits 9-14s for hydration before it touches a control, and a zoomed Vector frame with
   * indicators is slower still. So a cookie minted by some earlier command and pasted in via
   * `--cookie` is expired before the first chart finishes loading.
   *
   * MEASURED 2026-08-21. Minting in a separate process and passing the string produced
   * `net::ERR_CONNECTION_RESET` on `page.goto` for EVERY surface, reproducibly, while an
   * unauthenticated context loaded the marketing site at 200. The reset names neither auth nor
   * expiry: the origin 307s an expired session to `/sign-in`, and the tunnel gives the page no
   * working Clerk client to complete that bounce, so the navigation dies at the transport. It
   * reads as "the site is down" — it is not. `applyCookieToContext`'s header already records the
   * same mechanism surfacing as ERR_TOO_MANY_REDIRECTS.
   *
   * So the run mints its own session and re-applies a refreshed JWT on a timer that is well inside
   * the token's lifetime. `--cookie` still wins when given, for a caller driving its own identity.
   */
  const log = [];
  const explicitCookie = arg('cookie','');
  let session = null;
  if (!explicitCookie) {
    const { mintClerkPremiumSession } = await import('./lib/prod-clerk-session.mjs');
    session = await mintClerkPremiumSession({ appUrl: 'https://blackouttrades.com' });
    if (session.skip) throw new Error(`no session: ${session.reason} — pass --cookie or set CLERK_SECRET_KEY`);
  }
  const { browser, ctx, counts } = await createTunneledContext({
    url: 'https://blackouttrades.com/',
    cookie: explicitCookie || session.cookieHeader,
    viewport: arg('viewport','2560x1440'), desktop: true,
  });
  // 45s: comfortably inside a ~60s token, and short enough that a refresh failure shows up in the
  // step log while there is still a live token to finish the frame on.
  const refresher = session
    ? setInterval(() => {
        session
          .refresh()
          .then((r) => r && applyCookieToContext(ctx, r.cookieHeader, 'https://blackouttrades.com/'))
          .catch((e) => log.push(`auth refresh FAILED (${String(e.message).slice(0, 40)})`));
      }, 45_000)
    : null;
  const page = await ctx.newPage();
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
  } catch (e) {
    // A failed run is only useful if it says how far it got. Without the step log a timeout on the
    // final locator looks identical whether the ticker never loaded or a filter silently reset.
    console.error(`STEPS: ${log.join(' · ') || '(none)'}`);
    throw e;
  } finally {
    if (refresher) clearInterval(refresher);
    await browser.close();
    // Temp Clerk users hold a phone number from a small pool; a run that skips this leaks one.
    if (session) await session.cleanup().catch(() => {});
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
