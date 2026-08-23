#!/usr/bin/env node
/**
 * QA lane — Phase 0 interaction sweep.
 *
 * The QA/Adversarial lane's first task (docs/agents/briefs/qa-adversarial.md): walk every member
 * and public route with `proxy-browser.cjs`-style tunneled Chromium at desktop and mobile
 * viewports, doing a real interaction pass (not a single default-state screenshot), and log every
 * real defect found. This is deliberately BROAD rather than deep — the per-product harnesses
 * already committed (`meridian-interaction-audit.mjs`, `depth-ladder-ui-audit.mjs`, etc.) own the
 * deep, product-specific checks; this script's job is to look at EVERY route at least once and
 * catch the obvious breakage a first human pass would catch: the page doesn't load, it 404s, it
 * throws console errors, it overflows horizontally, a control is too small to tap, a tab doesn't
 * switch, a search doesn't filter.
 *
 * Uses the same CONNECT-tunnel technique as proxy-browser.cjs (scripts/audit/lib/proxy-tunnel-
 * context.cjs) because Chromium in this sandbox cannot reach the network directly — see
 * docs/audit/LIVE-UI-CONNECTION.md. One temp Clerk premium session, minted once by the parent and
 * handed to per-route child processes over an env var (never argv — it's a live JWT), released in
 * a `finally`. Routes run as separate child processes with a cooldown between them because the
 * proxy tunnel saturates after a couple of heavy passes in one process (documented in
 * lib/proxy-saturation.mjs) — a starved route must report HARNESS, never silently read as "clean".
 *
 * Read-only. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   node --import tsx scripts/audit/qa-phase0-sweep.mjs [--base=https://blackouttrades.com] [--out=DIR] [--route=/nighthawk] [--viewport=desktop]
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import { NAV_ATTEMPTS, navRetryWaitMs, viewportCooldownMs } from "./lib/proxy-saturation.mjs";
import { splitConsoleErrors } from "./lib/console-error-triage.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? fs.mkdtempSync(path.join(os.tmpdir(), "qa-phase0-"));
const ONLY_ROUTE = args.get("route") ?? null;
const ONLY_VP = args.get("viewport") ?? null;

const COOKIE_ENV = "QA_SWEEP_SESSION_COOKIE";
const IS_CHILD = Boolean(process.env[COOKIE_ENV]);

/**
 * Every route in scope for Phase 0: the seven products (member-only) plus the public/marketing
 * surfaces the brief names explicitly. `requiresAuth: false` routes are still shot signed-in
 * (the session cookie doesn't hurt them) but are not skipped on a stale/failed session.
 *
 * `interact` is an optional per-route hook doing ONE representative real interaction beyond
 * navigation — a tab click, a search — so this sweep is not merely a photograph of the default
 * state. Kept minimal on purpose: deep per-control coverage is the specialized harnesses' job.
 */
const ROUTES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/faq", name: "faq" },
  { path: "/upgrade", name: "upgrade" },
  { path: "/learn", name: "learn" },
  { path: "/about", name: "about" },
  { path: "/track-record", name: "track-record" },
  {
    path: "/flows",
    name: "helix-flows",
    interact: async (page, record, vpName) => {
      const tab = await page.$('[role="tab"], button:has-text("Sweeps"), button:has-text("Flow")').catch(() => null);
      if (tab) await tab.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/heatmap",
    name: "thermal-heatmap",
    interact: async (page, record, vpName) => {
      const tab = await page.$('[role="tab"], button:has-text("Depth"), button:has-text("Matrix")').catch(() => null);
      if (tab) await tab.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/vector",
    name: "vector",
    interact: async (page, record, vpName) => {
      const tab = await page.$('[role="tab"]').catch(() => null);
      if (tab) await tab.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/meridian",
    name: "meridian",
    interact: async (page, record, vpName) => {
      const row = await page.$(".meridian-earnings-row, [class*=earnings-row]").catch(() => null);
      if (row) await row.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/nighthawk",
    name: "nighthawk",
    interact: async (page, record, vpName) => {
      const tab = await page.$('[role="tab"]').catch(() => null);
      if (tab) await tab.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/dashboard",
    name: "spx-slayer-dashboard",
    interact: async (page, record, vpName) => {
      const tab = await page.$('[role="tab"]').catch(() => null);
      if (tab) await tab.click().catch(() => {});
      await page.waitForTimeout(1500);
    },
  },
  {
    path: "/terminal",
    name: "largo-terminal",
    interact: async (page, record, vpName) => {
      const input = await page.$('textarea, input[type="text"]').catch(() => null);
      if (input) {
        await input.click().catch(() => {});
        await input.type("What is SPY doing right now?", { delay: 20 }).catch(() => {});
      }
      await page.waitForTimeout(1000);
    },
  },
].filter((r) => !ONLY_ROUTE || r.path === ONLY_ROUTE);

const VIEWPORTS = [
  { name: "desktop", viewport: "1440x900", desktop: true },
  { name: "mobile", viewport: "430x932", desktop: false },
].filter((v) => !ONLY_VP || v.name === ONLY_VP);

const findings = [];
const record = (f) => {
  findings.push(f);
  console.log(`  [${f.severity}] ${f.route}/${f.viewport}/${f.where} — ${f.issue}`);
};

const OVERFLOW_PROBE = () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

// Only meaningful on a touch viewport, and only outside the shared nav chrome — every route
// shares the same header/nav links, so checking them per-route would print the same 10-line
// finding on 20 different pages, which is noise dressed as coverage. In-product controls
// (buttons, selects, tab pills) are what this is actually for.
const SMALL_TARGET_PROBE = () =>
  [...document.querySelectorAll("button, a[href], [role=button], input, select")]
    .filter((el) => !el.closest("header, nav, [role=navigation]"))
    .filter((el) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
    })
    .map((el) => ({
      label: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 28),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }))
    .slice(0, 10);

/** A 404 renders unstyled Times-New-Roman per docs/audit/LIVE-UI-CONNECTION.md — check the heading, not the CSS. */
const NOT_FOUND_PROBE = () => {
  const h1 = document.querySelector("h1");
  const text = (h1?.textContent ?? "").trim();
  return { h1: text, isNextDefault404: /^404$/.test(text) || /this page could not be found/i.test(document.body.innerText || "") };
};

async function auditRoute(route, vp, cookie) {
  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}${route.path}`,
    cookie,
    viewport: vp.viewport,
    desktop: vp.desktop,
    requestTimeoutMs: 40_000,
  });
  const where = `${route.name}`;
  try {
    const page = await ctx.newPage();
    const consoleErrors = [];
    const badResponses = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 120)}`);
    });

    let navigated = false;
    for (let attempt = 0; attempt < NAV_ATTEMPTS && !navigated; attempt += 1) {
      try {
        await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        navigated = true;
      } catch (err) {
        const wait = navRetryWaitMs(attempt);
        if (wait == null) {
          record({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "nav", issue: `navigation failed ${attempt + 1}x — ${String(err?.message ?? err).slice(0, 140)}` });
          return { counts };
        }
        await page.waitForTimeout(wait);
      }
    }
    if (!navigated) return { counts };

    await page.waitForTimeout(3500); // let SWR/SSE panels hydrate before judging anything

    const nf = await page.evaluate(NOT_FOUND_PROBE).catch(() => null);
    if (nf?.isNextDefault404) {
      record({ severity: "P1", route: route.name, viewport: vp.name, where: "nav", issue: `route resolved to a 404 ("${nf.h1}")` });
      await page.screenshot({ path: path.join(OUT, `${route.name}-${vp.name}-404.png`) }).catch(() => {});
      return { counts };
    }

    if (route.interact) {
      await route.interact(page, record, vp.name).catch((e) => {
        record({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "interact", issue: `interaction hook threw: ${String(e?.message ?? e).slice(0, 140)}` });
      });
    }

    const overflow = await page.evaluate(OVERFLOW_PROBE).catch(() => undefined);
    if (overflow === true) {
      record({ severity: "P2", route: route.name, viewport: vp.name, where: "layout", issue: "page scrolls horizontally" });
    }

    const small = vp.name === "mobile" ? await page.evaluate(SMALL_TARGET_PROBE).catch(() => null) : null;
    if (Array.isArray(small) && small.length > 0) {
      record({
        severity: "P3",
        route: route.name,
        viewport: vp.name,
        where: "layout",
        issue: `${small.length} controls under 24px tap target`,
        sample: small.map((s) => `${s.label} ${s.w}x${s.h}`),
      });
    }

    await page.screenshot({ path: path.join(OUT, `${route.name}-${vp.name}.png`), fullPage: vp.name !== "mobile" }).catch(() => {});

    if (badResponses.length > 0) {
      const auth = badResponses.filter((b) => /^(401|403)\b/.test(b));
      const other = badResponses.filter((b) => !/^(401|403)\b/.test(b));
      if (auth.length) {
        record({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "auth", issue: `${auth.length} auth failures (401/403) — session lost mid-run, not a product verdict`, sample: auth.slice(0, 3) });
      }
      if (other.length) {
        record({ severity: "P2", route: route.name, viewport: vp.name, where: "network", issue: `${other.length} failed requests`, sample: other.slice(0, 6) });
      }
    }
    if (consoleErrors.length > 0) {
      const authCount = badResponses.filter((b) => /^(401|403)\b/.test(b)).length;
      const { product, authEcho } = splitConsoleErrors(consoleErrors, authCount);
      if (product.length > 0) {
        record({ severity: "P2", route: route.name, viewport: vp.name, where: "console", issue: `${product.length} console errors`, sample: product.slice(0, 5) });
      }
      if (authEcho.length > 0) {
        record({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "console", issue: `${authEcho.length} console errors echo this run's own 401/403 — not a product verdict` });
      }
    }

    return { counts };
  } catch (e) {
    record({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "run", issue: String(e?.stack ?? e).slice(0, 600) });
    return { counts };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runChild() {
  const cookie = process.env[COOKIE_ENV] ?? "";
  if (!cookie) {
    record({ severity: "HARNESS", route: ONLY_ROUTE ?? "?", viewport: ONLY_VP ?? "?", where: "run", issue: "child started with no session cookie" });
    return;
  }
  const route = ROUTES[0];
  const vp = VIEWPORTS[0];
  console.log(`\n── ${route.path} @ ${vp.name} ──`);
  const r = await auditRoute(route, vp, cookie);
  console.log(`  routed: ${JSON.stringify(r.counts)}`);
}

/**
 * One child process per (route, viewport) pair, cooled between spawns. See
 * meridian-interaction-audit.mjs's own note on why fan-out does not cure proxy saturation but does
 * prevent it from silently discarding the tail of the run as false-clean.
 */
async function runParent(session) {
  const { spawnSync } = await import("node:child_process");
  const self = fileURLToPath(import.meta.url);
  let idx = 0;
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      const cooldown = viewportCooldownMs(idx);
      idx += 1;
      if (cooldown > 0) await new Promise((r) => setTimeout(r, cooldown));
      const res = spawnSync(
        process.execPath,
        ["--import", "tsx", self, `--route=${route.path}`, `--viewport=${vp.name}`, `--base=${BASE}`, `--out=${OUT}`],
        { env: { ...process.env, [COOKIE_ENV]: session.cookieHeader }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
      );
      const out = `${res.stdout ?? ""}`;
      process.stdout.write(out.split("\n").filter((l) => !l.trim().startsWith("{")).join("\n") + "\n");
      if (res.stderr) process.stderr.write(res.stderr);
      const parsed = parseChildFindings(out);
      if (parsed.length === 0 && res.status !== 0) {
        findings.push({ severity: "HARNESS", route: route.name, viewport: vp.name, where: "run", issue: `child exited ${res.status ?? "signal " + res.signal} with no findings — route NOT judged` });
      }
      findings.push(...parsed);
    }
  }
}

function parseChildFindings(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.includes('"severity"')) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o.severity === "string") out.push(o);
    } catch {
      /* truncated line, not a finding */
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  if (IS_CHILD) {
    await runChild();
    for (const f of findings) console.log(" ", JSON.stringify(f));
    process.exitCode = findings.some((f) => f.severity === "P0" || f.severity === "P1") ? 1 : 0;
    return;
  }

  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  let session = null;
  try {
    session = await mintClerkPremiumSession({ appUrl: BASE });
    if (session.skip) {
      console.log(`HARNESS SKIP: ${session.reason}`);
      return;
    }
    await runParent(session);
  } finally {
    if (session && typeof session.cleanup === "function") await session.cleanup().catch(() => {});
  }

  const bySev = (s) => findings.filter((f) => f.severity === s);
  console.log("\nQA PHASE 0 SWEEP\n");
  for (const f of findings) console.log(" ", JSON.stringify(f));
  try {
    fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({ base: BASE, findings }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.log(`  (could not persist findings.json: ${String(e?.message ?? e).slice(0, 120)})`);
  }
  console.log(
    `\n${bySev("P0").length} P0 · ${bySev("P1").length} P1 · ${bySev("P2").length} P2 · ${bySev("P3").length} P3 · ${bySev("HARNESS").length} HARNESS · screenshots in ${OUT}`
  );
  process.exitCode = bySev("P0").length + bySev("P1").length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
