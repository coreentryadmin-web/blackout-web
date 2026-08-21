/**
 * Thermal live INTERACTION audit — desktop 1440 / phone 430.
 *
 * WHY THIS EXISTS. A harness that checks whether the right SELECTORS painted will pass a panel
 * whose labels have overlapped into garbage — that is how two P2 defects shipped on the Meridian
 * surface (see scripts/audit/meridian-interaction-audit.mjs). Thermal had no equivalent. This one
 * measures BEHAVIOUR and PIXELS: page-level horizontal overflow, elements past the viewport,
 * clipped text, sub-24px tap targets, physical intersection between rendered text leaves, and
 * console errors.
 *
 * GATED ON A PAGE-LOADED PROOF. A blank render, a 404 and an auth bounce all surface as "the
 * marks are missing", which reads as a product defect when it is a harness failure — so a failed
 * gate prints HARNESS, never a verdict. A probe that returns undefined is HARNESS too: "the probe
 * never ran" must not read as "clean".
 *
 * THE COLLISION CHECK NEEDS BOTH FILTERS BELOW, and this is the trap to know about. Measuring raw
 * getBoundingClientRect() overlap between text leaves reported 19 hits on desktop and 54 on phone
 * — nearly all false, because a row scrolled out of its own container still reports a viewport
 * rect and duly "collides" with the page header. Excluding off-screen leaves AND leaves clipped by
 * a scrolling ancestor takes the measured population from 919 leaves to 130 and the hits to 3, all
 * of which are a sticky <thead> over the rows beneath it (opaque, so not a visual defect).
 * Without both filters the real hits drown in the false ones — the same lesson the Meridian
 * harness records.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1 — Chromium cannot reach the network here, so
 * every request is tunnelled (docs/audit/LIVE-UI-CONNECTION.md). Look for `routed N ok / 0 fail`.
 *
 *   CK=$(node --import tsx scripts/audit/lib/... mint)   # any premium session cookie
 *   NODE_USE_ENV_PROXY=1 PROBE_COOKIE="$CK" node scripts/audit/thermal-interaction-audit.cjs
 *
 * Env: PROBE_URL (default https://blackouttrades.com/heatmap), PROBE_COOKIE, PROBE_VIEWPORTS.
 */
const { createTunneledContext } = require('./lib/proxy-tunnel-context.cjs');

const VIEWPORTS = (process.env.PROBE_VIEWPORTS || '1440x900,430x932').split(',');
const URL = process.env.PROBE_URL || 'https://blackouttrades.com/heatmap';
const CK = process.env.PROBE_COOKIE || '';

(async () => {
  for (const vp of VIEWPORTS) {
    const { browser, ctx, counts } = await createTunneledContext({ url: URL, cookie: CK, viewport: vp });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // ── PAGE-LOADED GATE, POLLED ──
      // Originally a flat 11s sleep. That is a guess about hydration speed, and on 2026-08-21 it
      // reported HARNESS against a perfectly healthy production page that simply painted at ~13s
      // under load — a false alarm on the exact surface the harness exists to judge. A fixed wait
      // can only be too short (false HARNESS) or wastefully long; polling is neither. The gate
      // itself is unchanged: if it never satisfies within the budget we still report HARNESS and
      // never a product verdict.
      const GATE_BUDGET_MS = Number(process.env.PROBE_GATE_MS || 45000);
      const started = Date.now();
      let loaded = null;
      while (Date.now() - started < GATE_BUDGET_MS) {
        // `document.body` can still be null on the first poll — the fixed sleep this replaced
        // happened to hide that. Guard it, and treat an evaluate that throws (a navigation
        // landing mid-poll) as "not loaded yet" rather than letting it abort the run.
        try {
          loaded = await page.evaluate(() => {
            const t = (document.body && document.body.innerText) || '';
            return { thermal: /BlackOut Thermal/i.test(t), matrix: /MATRIX/i.test(t), state: /THERMAL STATE/i.test(t), title: document.title };
          });
        } catch { loaded = loaded || null; }
        if (loaded && loaded.thermal && loaded.matrix) break;
        await page.waitForTimeout(1000);
      }
      // Let late-hydrating panels settle before measuring geometry — a rect read mid-paint is not
      // evidence either.
      await page.waitForTimeout(2500);
      if (loaded) loaded.gate_ms = Date.now() - started;
      if (!loaded || !loaded.thermal || !loaded.matrix) {
        console.log(`\n[${vp}] HARNESS — page-loaded gate never satisfied within ${GATE_BUDGET_MS}ms`, JSON.stringify(loaded), `routed ${counts.ok}/${counts.fail}`);
        await browser.close(); continue;
      }

      const m = await page.evaluate(() => {
        const de = document.documentElement, b = document.body;
        // 1) horizontal overflow of the PAGE (a contained scroller is fine; the body is not)
        const bodyOverflow = Math.max(de.scrollWidth - de.clientWidth, b.scrollWidth - b.clientWidth);

        // 2) which elements overflow the viewport horizontally, and are they scroll containers?
        const vw = de.clientWidth;
        const offenders = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1) {
            const cs = getComputedStyle(el);
            offenders.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className && String(el.className).slice(0, 60)) || '',
              right: Math.round(r.right), vw,
              overflowX: cs.overflowX,
            });
          }
        }

        // 3) clipped text leaves (scrollWidth exceeds clientWidth on a non-scrolling element)
        let clipped = 0;
        for (const el of Array.from(document.querySelectorAll('*'))) {
          if (el.children.length) continue;
          const cs = getComputedStyle(el);
          if (cs.overflowX !== 'visible' && cs.overflowX !== 'clip') continue;
          if (el.scrollWidth > el.clientWidth + 2 && (el.textContent || '').trim()) clipped++;
        }

        // 4) sub-24px interactive targets
        const small = [];
        for (const el of Array.from(document.querySelectorAll('button,a,[role="tab"],[role="button"],input,select'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 24 || r.height < 24) small.push({ tag: el.tagName.toLowerCase(), t: (el.textContent||'').trim().slice(0,24), w: Math.round(r.width), h: Math.round(r.height) });
        }

        // 5) physical intersection between rendered TEXT LEAVES (parents excluded, else real hits drown)
        const leaves = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = walk.nextNode())) {
          if (n.children.length) continue;
          const txt = (n.textContent || '').trim();
          if (!txt) continue;
          const cs = getComputedStyle(n);
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
          const r = n.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          // FILTER 1 — off-screen. A row scrolled out of view still reports a viewport rect and
          // duly "collides" with the page header.
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
          // FILTER 2 — clipped by a scrolling ancestor. Walk up; if the leaf's rect falls outside
          // a scrolling/hidden ancestor's rect it is not visible where it claims to be.
          let clippedOut = false;
          for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
            const acs = getComputedStyle(a);
            if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
            const ar = a.getBoundingClientRect();
            if (r.bottom <= ar.top + 1 || r.top >= ar.bottom - 1 || r.right <= ar.left + 1 || r.left >= ar.right - 1) {
              clippedOut = true; break;
            }
          }
          if (clippedOut) continue;
          leaves.push({ txt: txt.slice(0, 22), x: r.left, y: r.top, w: r.width, h: r.height });
        }
        const hits = [];
        for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i], c = leaves[j];
          const ox = Math.min(a.x+a.w, c.x+c.w) - Math.max(a.x, c.x);
          const oy = Math.min(a.y+a.h, c.y+c.h) - Math.max(a.y, c.y);
          if (ox > 3 && oy > 3) hits.push(`"${a.txt}" ∩ "${c.txt}" ${Math.round(ox)}x${Math.round(oy)}px`);
        }
        return { bodyOverflow, offenders: offenders.slice(0, 8), offenderCount: offenders.length, clipped, small: small.slice(0,40), smallCount: small.length, leafCount: leaves.length, hits: hits.slice(0, 8), hitCount: hits.length };
      });

      if (!m) { console.log(`[${vp}] HARNESS — probe returned undefined`); await browser.close(); continue; }
      console.log(`\n[${vp}] routed ${counts.ok} ok / ${counts.fail} fail — PAGE LOADED in ${loaded.gate_ms}ms (${loaded.title})`);
      console.log(`  body horizontal overflow : ${m.bodyOverflow}px  ${m.bodyOverflow > 1 ? '<-- PAGE SCROLLS SIDEWAYS' : 'ok'}`);
      console.log(`  elements past viewport   : ${m.offenderCount}`);
      for (const o of m.offenders) console.log(`      ${o.tag}.${o.cls} right=${o.right} vw=${o.vw} overflowX=${o.overflowX}`);
      console.log(`  clipped text leaves      : ${m.clipped}`);
      console.log(`  sub-24px tap targets     : ${m.smallCount}`);
      for (const s of m.small) console.log(`      <${s.tag}> "${s.t}" ${s.w}x${s.h}`);
      console.log(`  text leaves measured     : ${m.leafCount}`);
      console.log(`  text collisions          : ${m.hitCount}`);
      for (const h of m.hits) console.log(`      ${h}`);
      console.log(`  console errors           : ${consoleErrors.length}`);
      for (const e of consoleErrors.slice(0,5)) console.log(`      ${e}`);
    } catch (e) {
      console.log(`[${vp}] HARNESS — ${e.message.split('\n')[0]}`);
    }
    await browser.close();
  }
})();
