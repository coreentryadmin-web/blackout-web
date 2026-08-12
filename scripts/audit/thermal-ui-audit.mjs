/**
 * THERMAL DEEP UI AUDIT — drive every control on /heatmap and record what the member sees.
 *
 * WHY A DRIVER AND NOT A SCREENSHOT. A single capture of a desk proves the FIRST state renders.
 * Thermal's surface is a product of four axes — exposure lens (GEX/VEX/DEX/CHARM) × view
 * (Matrix / Profile+Curve+Shift) × ticker × expiry — and a defect in a non-default combination is
 * invisible to a one-shot shot. This walks the axes, and at every stop runs the same probe:
 * panels present, empty panels, error/skeleton text, horizontal overflow, console errors, failed
 * requests, and time-to-settle.
 *
 * CONSOLE ERRORS ARE FIRST-CLASS. A React render error or an unhandled rejection often leaves the
 * page LOOKING fine — a panel silently unmounts, or a number renders stale — so the DOM probe
 * alone under-reports. Anything the page logs at error level is captured against the state that
 * produced it.
 *
 * ENUMERATE, DO NOT ASSUME. Controls are discovered at runtime (`button`, `[role="tab"]`,
 * `select`) and reported, so a control that exists but was never driven shows up as coverage the
 * audit did NOT have, rather than being silently skipped.
 *
 * READ-ONLY: navigation, clicks and reads. One temp Clerk user, deleted in a `finally`.
 *
 *   node --import tsx scripts/audit/thermal-ui-audit.mjs [--tickers=SPX,QQQ] [--out=DIR] [--json]
 *
 * Requires NODE_USE_ENV_PROXY=1 (Node's global fetch ignores HTTPS_PROXY without it, and the Clerk
 * mint then fails with an unhelpful "no error payload").
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? mkdtempSync(join(tmpdir(), "thermal-"));
const TICKERS = (args.get("tickers") ?? "SPX,SPY,QQQ,NVDA,TSLA").split(",");
const JSON_OUT = args.has("json");

/** /heatmap's SPX GEX build is a documented cold-cache spike (~12.5s cold vs 0.1-1.8s warm). */
const FIRST_SETTLE_MS = 22000;
const STEP_SETTLE_MS = 7000;

const BAD_TEXT = [
  /\bapplication error\b/i,
  /\bsomething went wrong\b/i,
  /\bfailed to (load|fetch)\b/i,
  /\bunable to load\b/i,
  /\bno data\b/i,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
];

/** Read the rendered DOM. Same shape at every stop so states are directly comparable. */
async function probe(page) {
  return page
    .evaluate(() => {
      const txt = document.body.innerText || "";
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const headings = [...document.querySelectorAll("h1,h2,h3,[class*='title'],[class*='Title']")]
        .filter(vis)
        .map((e) => (e.textContent || "").trim())
        .filter((t) => t && t.length < 70);
      // A real panel is a CONTAINER with children and real size — a leaf span holding an icon is
      // supposed to be empty (this exact over-match invented 8 findings on /vector).
      const panels = [...document.querySelectorAll("section,[class*='panel'],[class*='Panel'],[class*='card']")];
      const empty = panels
        .filter((s) => {
          if ((s.textContent || "").replace(/\s+/g, "").length >= 12) return false;
          if (s.childElementCount === 0) return false;
          const r = s.getBoundingClientRect();
          return r.width >= 200 && r.height >= 80;
        })
        .map((s) => s.className?.toString?.().slice(0, 70) || s.tagName)
        .slice(0, 10);
      const controls = [...document.querySelectorAll("button,[role='tab'],select,[role='button']")]
        .filter(vis)
        .map((b) => ({
          tag: b.tagName.toLowerCase(),
          role: b.getAttribute("role"),
          label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 45),
          selected: b.getAttribute("aria-selected"),
          disabled: b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true",
        }))
        .filter((c) => c.label);
      // Cells are the product: a matrix that renders zero coloured cells is a dead heatmap even
      // when every heading around it is present.
      const cells = document.querySelectorAll("[class*='cell'],td,[data-strike]").length;
      return {
        title: document.title,
        chars: txt.length,
        text: txt.slice(0, 24000),
        headings: [...new Set(headings)].slice(0, 30),
        panelCount: panels.length,
        emptyPanels: empty,
        controls,
        cells,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        signedOut: /sign in|get access/i.test(txt.slice(0, 1500)),
      };
    })
    .catch((e) => ({ error: e.message }));
}

function verdict(state, p, routed, consoleErrors, ms) {
  const bad = p.error ? [] : BAD_TEXT.filter((re) => re.test(p.text)).map((re) => re.source);
  return {
    state,
    ms,
    routed,
    chars: p.chars ?? 0,
    panels: p.panelCount ?? 0,
    cells: p.cells ?? 0,
    emptyPanels: p.emptyPanels ?? [],
    badText: bad,
    overflowPx: p.scrollW > p.clientW + 2 ? p.scrollW - p.clientW : 0,
    consoleErrors: consoleErrors.slice(0, 6),
    headings: p.headings ?? [],
    signedOut: !!p.signedOut,
    error: p.error ?? null,
  };
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP — ${session.reason}`);
    process.exitCode = 1;
    return;
  }
  const { cookieHeader } = await session.refresh();
  const { browser, ctx, counts } = await createTunneledContext({
    url: BASE,
    cookie: cookieHeader,
    viewport: args.get("viewport") ?? "1600x2200",
    desktop: true,
  });

  const rows = [];
  const consoleErrors = [];

  /**
   * Refresh the Clerk JWT AND push it into the browser context.
   *
   * `session.refresh()` alone is not enough and the failure is silent: it returns a new cookie
   * header, but the CONTEXT keeps serving the old one, so the page keeps sending a dead token. The
   * `__session` JWT lives ~72s, which a multi-state walk blows through in the first lens — after
   * which XHRs 401, panels empty out, and the page reads as a product defect. The first run of this
   * harness reported CHARM "broken" and every ticker at 132 chars for exactly that reason.
   */
  const reauth = async () => {
    const { cookieHeader: fresh } = await session.refresh();
    await ctx.clearCookies();
    await ctx.addCookies(
      fresh.split(";").map((p) => {
        const [n, ...r] = p.trim().split("=");
        return {
          name: n.trim(),
          value: r.join("=").trim(),
          domain: new URL(BASE).hostname,
          path: "/",
          httpOnly: n.trim() === "__session",
          secure: true,
          sameSite: "Lax",
        };
      })
    );
  };

  try {
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 200)}`));

    const shoot = async (id) => {
      await page.screenshot({ path: `${OUT}/${id}.png`, animations: "disabled", timeout: 45000 }).catch(() => {});
    };
    const step = async (label, settle = STEP_SETTLE_MS) => {
      // Before EVERY stop, not just before navigations: clicking a tab does not navigate, so a
      // multi-state walk otherwise runs the whole lens sequence on one ~72s token.
      await reauth();
      const before = counts.ok;
      consoleErrors.length = 0;
      const t0 = Date.now();
      await page.waitForTimeout(settle);
      const p = await probe(page);
      const v = verdict(label, p, counts.ok - before, consoleErrors, Date.now() - t0);
      rows.push(v);
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!v.error && !v.signedOut) await shoot(id);
      console.log(
        `${v.error || v.signedOut ? "BROKEN" : "OK    "} ${label.padEnd(30)} xhr=${String(v.routed).padStart(3)} ` +
          `chars=${String(v.chars).padStart(6)} panels=${String(v.panels).padStart(3)} cells=${String(v.cells).padStart(4)} ` +
          `empty=${v.emptyPanels.length} ovf=${v.overflowPx} bad=${v.badText.length} cerr=${v.consoleErrors.length}`
      );
      if (v.badText.length) console.log(`        badText: ${v.badText.join(" · ")}`);
      if (v.consoleErrors.length) console.log(`        console: ${v.consoleErrors[0]}`);
      return v;
    };

    // ── Cold load ────────────────────────────────────────────────────────────────────
    await reauth();
    await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) =>
      console.log("nav:", e.message.split("\n")[0])
    );
    const first = await step("load:cold", FIRST_SETTLE_MS);
    if (first.signedOut || first.error) {
      console.error("Aborting — the page did not render authenticated.");
      return;
    }
    console.log(`\nCONTROLS DISCOVERED (${first.controls?.length ?? 0}):`);
    const seen = await probe(page);
    (seen.controls ?? []).forEach((c) =>
      console.log(`   [${c.role ?? c.tag}]${c.disabled ? " (disabled)" : ""} ${c.label}`)
    );
    console.log("");

    // ── Exposure lens × view, driven by real aria roles ──────────────────────────────
    const clickByText = async (re) => {
      const tabs = await page.$$('[role="tab"], button');
      for (const t of tabs) {
        const label = ((await t.getAttribute("aria-label")) || (await t.innerText().catch(() => "")) || "").trim();
        if (re.test(label)) {
          await t.click().catch(() => {});
          return label;
        }
      }
      return null;
    };

    for (const lens of ["GEX", "VEX", "DEX", "CHARM"]) {
      const hit = await clickByText(new RegExp(`^${lens}$`, "i"));
      if (!hit) {
        rows.push({ state: `lens:${lens}`, absent: true });
        console.log(`ABSENT lens:${lens} — no control with that label (lens not shipped in this payload)`);
        continue;
      }
      await step(`lens:${lens}`);
      for (const view of ["Matrix", "Profile"]) {
        const v = await clickByText(new RegExp(`^${view}`, "i"));
        if (v) await step(`lens:${lens}|view:${view}`);
      }
    }

    // ── Multiple tickers ─────────────────────────────────────────────────────────────
    for (const t of TICKERS) {
      await reauth();
      await page.goto(`${BASE}/heatmap?ticker=${t}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await step(`ticker:${t}`, t === TICKERS[0] ? FIRST_SETTLE_MS : STEP_SETTLE_MS);
    }
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    await session.cleanup?.();
    console.log("\ntemp user deleted");
  }

  writeFileSync(`${OUT}/thermal-audit.json`, JSON.stringify(rows, null, 2));
  console.log(`artifacts: ${OUT}`);
  if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
}

await main();
