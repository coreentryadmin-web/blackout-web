/**
 * Live-DOM geometry predicates: is anything CLIPPED, and is anything COLLIDING?
 *
 * Extracted so the page-load audit and the interaction audit share ONE implementation. Two copies
 * would drift, and the part that is subtle here is not the geometry — it is the exclusions. Both
 * predicates are heuristics over a real DOM, and the first live run of the naive version reported
 * 133 clipped elements and 12 collisions on a healthy page. A check that fires on healthy pages
 * teaches its reader to skip the report, which is worse than having no check at all, so every
 * exclusion below is there because it removed a class of lie without removing a real defect.
 *
 * Both predicates matter MOST right after an interaction. A drawer that opens over the page, a
 * modal that pushes the layout, a tab that swaps a panel — those are the moments a layout breaks,
 * and they are invisible to any check that only ever looks at a freshly loaded page.
 */

/** Runs both predicates in the page and returns `{ clipped, collide }` (deduped strings). */
export async function probeGeometry(page) {
  return page
    .evaluate(() => {
      const vis = (el) => {
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
      };

      /**
       * Scrolled out of its own scrollport — present in the DOM, invisible on screen.
       *
       * getBoundingClientRect reports where content WOULD be, and inside a scroll container that is
       * routinely somewhere else entirely: the GEX ladder's scrolled-away rows return rects sitting
       * on top of a completely different panel. Every one of the twelve collisions the first live
       * run reported was a pair like that — two elements that share coordinates and never share a
       * screen. Both predicates are about what a member SEES, so anything clipped away by a
       * scrollport is not a participant.
       */
      const hiddenByScroll = (el) => {
        const r = el.getBoundingClientRect();
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (!/auto|scroll/.test(s.overflowX) && !/auto|scroll/.test(s.overflowY)) continue;
          const pr = p.getBoundingClientRect();
          if (r.bottom <= pr.top || r.top >= pr.bottom || r.right <= pr.left || r.left >= pr.right) {
            return true;
          }
        }
        return false;
      };

      const leaves = [...document.querySelectorAll("body *")].filter(
        (el) => el.children.length === 0 && (el.textContent ?? "").trim() && vis(el)
      );

      const label = (el) =>
        `.${(el.className || "").toString().split(/\s+/)[0] || el.tagName.toLowerCase()}`;

      // (1) CLIPPED: a text leaf sticking out of an ancestor that will CUT it off.
      //
      //   - `auto`/`scroll` STOPS the walk. Content is reachable by scrolling, so it is not
      //     clipped — and every ancestor further up is irrelevant, because the scroll container
      //     will have brought the content inside them by the time it is on screen. Without this
      //     break the GEX ladder reported all 300+ of its own scrolled-away rows as "cut by 940px"
      //     inside the panel that scrolls them.
      //   - a zero-size ancestor is a DELIBERATE collapse (`.nav-brand-ios-compact` sets
      //     `width: 0; overflow: hidden` to hide the wordmark), not an accident.
      //   - 6px of slack absorbs sub-pixel rounding and the odd descender.
      const clipped = new Map();
      for (const el of leaves) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/auto|scroll/.test(s.overflowX) || /auto|scroll/.test(s.overflowY)) break;
          if (s.overflowX !== "hidden" && s.overflowY !== "hidden") continue;
          const pr = p.getBoundingClientRect();
          if (pr.width === 0 || pr.height === 0) break;
          const outX = s.overflowX === "hidden" ? Math.max(pr.left - r.left, r.right - pr.right) : 0;
          const outY = s.overflowY === "hidden" ? Math.max(pr.top - r.top, r.bottom - pr.bottom) : 0;
          const out = Math.max(outX, outY);
          if (out > 6) {
            // Keyed on WHAT is clipped by WHICH box, not on how many pixels — the same defect
            // measures differently as the layout shifts under it (the GEX ladder button reads 17px
            // normally and 23px with the nav mega-menu open), and keying on the number reports one
            // defect twice and makes a fix look partial.
            const key = `"${el.textContent.trim().slice(0, 24)}" inside ${label(p)}`;
            clipped.set(key, Math.max(clipped.get(key) ?? 0, Math.round(out)));
            break;
          }
        }
      }

      // (2) COLLIDING: text printing on top of an interactive control.
      //
      // Restricted to text-over-CONTROL because unrelated text boxes overlap legitimately all the
      // time (chart annotations, badges, decorative layers) while a label sitting on a button is a
      // defect in every design. Ancestor pairs are skipped — a button's own label is inside it —
      // and anything under a modal is skipped, where covering the page is the entire point.
      /**
       * Which painting layer a node lives in: `fixed` (is it inside any position:fixed subtree),
       * plus the nearest positioned ancestor's `floating`ness and z-index.
       *
       * Covering a control is the WHOLE POINT of a dropdown, a mega-menu, a popover or a tooltip,
       * so an overlay sitting on top of the page is correct behaviour, not a collision. Opening the
       * nav's "Features ▾" menu on /vector produced 23 "defects" of this kind — every one a menu
       * item correctly painting over the chart toolbar beneath it.
       *
       * The discriminator is layering, not element type. What survives it — two things in the SAME
       * layer fighting for the same pixels — is the real defect, and it is what caught the iOS tool
       * label printing under the hamburger, where both sit inside the same fixed nav bar.
       */
      const layer = (el) => {
        let fixed = false;
        let z = 0;
        let floating = false;
        let seen = false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.position === "fixed") fixed = true;
          if (s.position === "static") continue;
          if (!seen) {
            const parsed = parseInt(s.zIndex, 10);
            z = Number.isFinite(parsed) ? parsed : 0;
            floating = s.position === "absolute" || s.position === "fixed";
            seen = true;
          }
        }
        return { z, floating, fixed };
      };

      const controls = [...document.querySelectorAll("button, a, input, select, [role=button]")].filter(
        (el) => vis(el) && !hiddenByScroll(el)
      );
      const collide = [];
      for (const t of leaves) {
        if (t.closest("[role=dialog], [aria-modal=true], [role=menu], [role=listbox], [role=tooltip]")) continue;
        if (hiddenByScroll(t)) continue;
        const tLayer = layer(t);
        const a = t.getBoundingClientRect();
        if (a.width === 0 || a.height === 0) continue;
        for (const c of controls) {
          if (c.contains(t) || t.contains(c)) continue;
          const b = c.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          // A deliberate overlay painting over what is beneath it — see `layer`.
          //
          // The FIXED test comes first and does most of the work. A `position: fixed` subtree is
          // chrome that floats over the document by construction — the nav bar, its mega-menu, a
          // sticky action bar — so a fixed thing and a non-fixed thing sharing pixels is the
          // intended design, not a collision. When BOTH are fixed (the iOS tool label and the
          // hamburger, both inside `.nav-bar`) they are peers competing for the same space, and
          // that is exactly the defect worth reporting.
          //
          // z-index is only a tie-breaker, and deliberately a weak one: it is comparable only
          // WITHIN a stacking context, so comparing it across two subtrees says little. Ordering
          // the two tests the other way round let all 23 of the mega-menu's overlaps through, each
          // one a menu item correctly painting over the chart toolbar beneath it.
          const cLayer = layer(c);
          if (tLayer.fixed !== cLayer.fixed) continue;
          if (tLayer.floating && !cLayer.floating) continue;
          if (cLayer.floating && !tLayer.floating) continue;
          if (tLayer.floating && cLayer.floating && tLayer.z !== cLayer.z) continue;
          const ov =
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          // A quarter of the smaller box: a 1px kiss is a rounding artifact, a quarter is a collision.
          if (ov > 0.25 * Math.min(a.width * a.height, b.width * b.height)) {
            const ctrl = (c.innerText || c.getAttribute("aria-label") || c.tagName).trim();
            collide.push(`"${t.textContent.trim().slice(0, 20)}" over control "${ctrl.slice(0, 20)}"`);
          }
        }
      }

      return {
        clipped: [...clipped].map(([k, px]) => `${k} — cut by ${px}px`),
        collide: [...new Set(collide)],
      };
    })
    .catch(() => ({ clipped: [], collide: [] }));
}
