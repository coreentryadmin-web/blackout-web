#!/usr/bin/env node
/**
 * POST-DEPLOY LABEL PROBE — does a string a member is supposed to read actually RENDER?
 *
 * Built after a label rename shipped and could not be verified. The obvious check — fetch the page
 * and grep the HTML — reports ABSENT for every desk label including ones that have been live for
 * weeks: `/dashboard` serves a ~50KB client shell and the labels come from the JS bundle, so an
 * HTML grep answers a different question than the one asked and answers it wrongly. A bundle grep
 * would prove the string SHIPPED; only the rendered DOM proves it REACHES A MEMBER.
 *
 * Reports each needle FOUND (with its rendered count and first ancestor class) or ABSENT, and
 * exits non-zero if any REQUIRED needle is absent or any FORBIDDEN needle is present — so a rename
 * can be gated on both halves: the new label is there AND the old one is gone. Checking only the
 * new one passes a page that renders both.
 *
 * READ-ONLY. One temp Clerk user, released in a finally. Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/spx-rendered-text-probe.mjs \
 *     --path=/dashboard --require="OI Max Pain" --forbid="Max Pain" [--viewport=1440x1000]
 *     [--desktop=0] [--settle-ms=9000] [--json]
 *
 * `--require` / `--forbid` are comma-separated. A FORBIDDEN needle that is a SUBSTRING of a
 * required one is reported as such rather than failing the run — "Max Pain" is inside
 * "OI Max Pain", and a probe that cannot tell those apart would fail every correct rename.
 *
 * `--gate=<needle>` is a PAGE-LOADED PROOF and it is not optional discipline — it is the difference
 * between a product verdict and a harness failure. A blank render, a 404 and an auth bounce all
 * make every required needle absent, which reads as "the label is missing" when the truth is "the
 * page never came up". With a gate, an absent gate reports **HARNESS**, never RED. Measured on the
 * first phone-class run of this probe: `OI max pain` came back 0x and the honest reason was that
 * the iOS metric rows live on a panel the default view does not show — not a missing label.
 *
 * KNOWN SCOPE LIMIT: this probe does not click anything. A label behind a tab, an accordion or an
 * iOS panel segment is out of its reach by construction; driving those is
 * `live-ui-interaction-audit.mjs`'s job. Use a `--gate` that is visible without interaction.
 */
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const BASE = flag("base", "https://blackouttrades.com").replace(/\/$/, "");
const PAGE = flag("path", "/dashboard");
const VIEWPORT = flag("viewport", "1440x1000");
const DESKTOP = flag("desktop", "1") !== "0";
const SETTLE_MS = Number(flag("settle-ms", "9000"));
const GATE = flag("gate", "");
const REQUIRE = list(flag("require", ""));
const FORBID = list(flag("forbid", ""));
const JSON_OUT = args.includes("--json");

async function main() {
  if (!REQUIRE.length && !FORBID.length) {
    console.error("[rendered-text] nothing to check — pass --require and/or --forbid");
    return 2;
  }
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    // "I could not look" must never render as "clean".
    console.error("[rendered-text] no Clerk session available — SKIPPED, not clean");
    return 2;
  }
  const url = `${BASE}${PAGE}`;
  const { browser, ctx } = await createTunneledContext({
    url,
    viewport: VIEWPORT,
    desktop: DESKTOP,
    cookie: session.cookieHeader,
    // The desk forces a GEX matrix rebuild; the tunnel's 20s default drops that panel and the
    // probe would then report a label absent because its panel never painted.
    requestTimeoutMs: 60_000,
  });
  try {
    const page = await ctx.newPage();
    await page.route((u) => /(^|\/|-)(stream|sse|events)(\?|$)/.test(u.pathname + u.search), (r) => r.abort());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(SETTLE_MS);

    const found = await page.evaluate((needles) => {
      const out = {};
      for (const needle of needles) {
        const hits = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? "";
          if (!text.includes(needle)) continue;
          const el = n.parentElement;
          if (!el) continue;
          const st = getComputedStyle(el);
          // Present in the DOM but invisible is not "rendered" — a hidden panel would otherwise
          // let a label pass a check no member could satisfy by looking.
          if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") continue;
          hits.push({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === "string" ? el.className.slice(0, 80) : "",
          });
        }
        out[needle] = hits;
      }
      return out;
    }, [...new Set([...REQUIRE, ...FORBID, ...(GATE ? [GATE] : [])])]);

    // PAGE-LOADED PROOF FIRST. Without it every downstream absence is indistinguishable from a
    // page that never rendered, and this probe would report a harness failure as a product defect.
    if (GATE && !(found[GATE] ?? []).length) {
      const line = `HARNESS  page-loaded gate "${GATE}" did not render — every needle below is UNVERIFIED, not absent`;
      if (JSON_OUT) console.log(JSON.stringify({ url, viewport: VIEWPORT, device: DESKTOP ? "desktop" : "phone", verdict: "HARNESS", gate: GATE }, null, 2));
      else console.log(`${url}  viewport ${VIEWPORT}  device=${DESKTOP ? "desktop" : "phone"}\n  ${line}`);
      return 2;
    }

    const results = [];
    let failed = false;
    for (const needle of REQUIRE) {
      const hits = found[needle] ?? [];
      if (!hits.length) failed = true;
      results.push({ needle, kind: "require", count: hits.length, ok: hits.length > 0, hits: hits.slice(0, 3) });
    }
    for (const needle of FORBID) {
      const hits = found[needle] ?? [];
      // Every occurrence sitting inside a REQUIRED needle is the rename working, not failing.
      const coveredBy = REQUIRE.filter((r) => r !== needle && r.includes(needle));
      const explained = coveredBy.reduce((sum, r) => sum + (found[r]?.length ?? 0), 0);
      const bare = Math.max(0, hits.length - explained);
      if (bare > 0) failed = true;
      results.push({
        needle,
        kind: "forbid",
        count: hits.length,
        explained_by_required: explained,
        bare,
        ok: bare === 0,
        covered_by: coveredBy,
        hits: hits.slice(0, 3),
      });
    }

    if (JSON_OUT) {
      console.log(JSON.stringify({ url, viewport: VIEWPORT, device: DESKTOP ? "desktop" : "phone", results, verdict: failed ? "RED" : "GREEN" }, null, 2));
    } else {
      console.log(`${url}  viewport ${VIEWPORT}  device=${DESKTOP ? "desktop" : "phone"}`);
      if (GATE) console.log(`  GATE OK  "${GATE}" rendered — the page is up, so an absence below is a real absence`);
      else console.log(`  NO GATE  pass --gate=<needle> so a blank page cannot read as a missing label`);
      for (const r of results) {
        if (r.kind === "require") {
          console.log(`  ${r.ok ? "OK      " : "MISSING "} require "${r.needle}" — rendered ${r.count}x${r.hits.length ? ` (${r.hits.map((h) => h.tag + (h.className ? "." + h.className.split(/\s+/)[0] : "")).join(", ")})` : ""}`);
        } else {
          const note = r.explained_by_required
            ? ` (${r.explained_by_required} inside ${r.covered_by.map((c) => `"${c}"`).join("/")}, ${r.bare} bare)`
            : "";
          console.log(`  ${r.ok ? "OK      " : "PRESENT "} forbid  "${r.needle}" — rendered ${r.count}x${note}`);
        }
      }
      console.log(`  verdict: ${failed ? "RED" : "GREEN"}`);
    }
    return failed ? 1 : 0;
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[rendered-text] ${err?.message ?? err}`);
    process.exit(1);
  });
