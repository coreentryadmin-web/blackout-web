#!/usr/bin/env node
/**
 * Website CTA / auth-chrome sweep — every public route, auth buttons, dead zones.
 * Exits non-zero on any FAIL (broken link, empty nav auth, stale signed-in CTA).
 */
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = process.env.VALIDATE_BASE ?? "https://blackouttrades.com";

const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/faq",
  "/learn",
  "/learn/getting-started",
  "/contact",
  "/terms",
  "/privacy",
  "/sign-in",
  "/sign-up",
  "/upgrade",
  "/track-record",
  "/methodology",
  "/why-blackout",
  "/vs/others",
  "/tools/gamma-snapshot",
  "/about",
  "/dashboard",
  "/flows",
  "/nighthawk",
  "/offline",
];

const findings = [];

function record(route, check, verdict, detail) {
  findings.push({ route, check, verdict, detail });
}

async function checkRoute(page, path, signedInCookie) {
  const label = `${path}${signedInCookie ? " (signed-in cookie)" : ""}`;
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const status = res?.status() ?? 0;
  if (status >= 500) {
    record(label, "http", "FAIL", `HTTP ${status}`);
    return;
  }
  record(label, "http", status >= 400 && path !== "/dashboard" ? "WARN" : "PASS", `HTTP ${status} → ${page.url()}`);

  // Nav auth must never be empty on marketing pages
  if (["/", "/pricing", "/faq", "/learn", "/upgrade", "/methodology", "/why-blackout"].some((p) => path === p || path.startsWith("/learn"))) {
    await page.waitForTimeout(100);
    const nav = page.locator(".mkt-nav-auth").first();
    const html = (await nav.innerHTML().catch(() => "")).trim();
    const signIn = await nav.getByRole("link", { name: /^sign in$/i }).count();
    const openDesk = await nav.getByRole("link", { name: /open desk/i }).count();
    const getAccess = await nav.getByRole("link", { name: /get access/i }).count();
    const total = signIn + openDesk + getAccess;

    if (total === 0 && html.length === 0) {
      record(label, "nav-auth-empty", "FAIL", "Marketing nav auth area empty at t+100ms");
    } else if (signedInCookie && signIn > 0 && openDesk === 0) {
      record(label, "nav-stale-signin", "FAIL", "Signed-in cookie but nav still shows Sign in");
    } else if (signedInCookie && openDesk > 0) {
      record(label, "nav-healed", "PASS", "Nav shows Open desk for signed-in cookie");
    } else if (!signedInCookie && (signIn > 0 || getAccess > 0)) {
      record(label, "nav-signed-out", "PASS", "Nav shows sign-in CTAs");
    } else {
      record(label, "nav-auth", "PASS", `signIn=${signIn} openDesk=${openDesk} getAccess=${getAccess}`);
    }
  }

  // Homepage hero must heal when signed-in cookie present
  if (path === "/" && signedInCookie) {
    await page.waitForTimeout(50);
    const hero = page.locator(".cta-row .btn-p").first();
    const text = (await hero.innerText().catch(() => "")).trim();
    const href = await hero.getAttribute("href");
    if (!/open desk/i.test(text)) {
      record(label, "hero-stale", "FAIL", `Hero CTA text="${text}" href=${href}`);
    } else if (href !== "/dashboard") {
      record(label, "hero-href", "FAIL", `Hero Open desk href=${href}`);
    } else {
      record(label, "hero-healed", "PASS", `Hero="${text}" → ${href}`);
    }
  }

  // Desk nav must not be empty on sign-in page (uses marketing shell) — skip
  if (["/flows", "/nighthawk", "/dashboard"].includes(path) && !signedInCookie) {
    await page.waitForTimeout(200);
    const finalPath = new URL(page.url()).pathname;
    if (finalPath === "/sign-in") {
      record(label, "auth-gate", "PASS", "Redirects unsigned to /sign-in");
    }
    const nav = page.locator(".nav-auth").first();
    if (await nav.count()) {
      const signIn = await nav.getByRole("link", { name: /sign in/i }).count();
      const openDesk = await nav.getByRole("link", { name: /open desk/i }).count();
      if (signIn + openDesk === 0) {
        record(label, "desk-nav-empty", "FAIL", "Desk nav auth empty at t+200ms");
      } else {
        record(label, "desk-nav", "PASS", `signIn=${signIn} openDesk=${openDesk}`);
      }
    }
  }

  // All in-page links with auth labels resolve (no href="#", no 0.0.0.0)
  const badLinks = await page.evaluate(() => {
    const bad = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") ?? "";
      const text = (a.textContent ?? "").trim().slice(0, 40);
      if (href.includes("0.0.0.0")) bad.push(`0.0.0.0: ${text}`);
      if (href === "#" && /sign in|open desk|get access/i.test(text)) bad.push(`dead-hash: ${text}`);
    }
    return bad;
  });
  if (badLinks.length) {
    record(label, "bad-hrefs", "FAIL", badLinks.join("; "));
  } else {
    record(label, "bad-hrefs", "PASS", "No poisoned auth hrefs");
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Signed-out sweep
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const route of PUBLIC_ROUTES) {
      try {
        await checkRoute(page, route, false);
      } catch (e) {
        const msg = String(e);
        if (route === "/dashboard" && msg.includes("ERR_ABORTED")) {
          record(route, "auth-gate", "PASS", "Redirect during /dashboard navigation");
        } else {
          record(route, "exception", "FAIL", msg);
        }
      }
    }
    await ctx.close();
  }

  // Signed-in sweep — real Clerk session (partial __client_uat-only cookies false-FAIL nav).
  {
    const session = await mintClerkPremiumSession({ appUrl: BASE });
    if (session.skip) {
      record("(signed-in sweep)", "auth-setup", "WARN", `skipped: ${session.reason}`);
    } else {
      try {
        const ctx = await browser.newContext();
        const cookies = session.cookieHeader.split("; ").map((pair) => {
          const eq = pair.indexOf("=");
          const name = pair.slice(0, eq);
          const value = pair.slice(eq + 1);
          return { name, value, domain: "blackouttrades.com", path: "/" };
        });
        await ctx.addCookies(cookies);
        const page = await ctx.newPage();
        for (const route of ["/", "/pricing", "/faq", "/upgrade", "/learn", "/methodology"]) {
          try {
            await checkRoute(page, route, true);
          } catch (e) {
            record(`${route} (signed-in cookie)`, "exception", "FAIL", String(e));
          }
        }
        await ctx.close();
      } finally {
        await session.cleanup();
      }
    }
  }

  await browser.close();

  const fails = findings.filter((f) => f.verdict === "FAIL");
  const warns = findings.filter((f) => f.verdict === "WARN");

  console.log(`\n=== Website CTA sweep @ ${BASE} ===\n`);
  for (const f of findings) {
    const icon = f.verdict === "PASS" ? "✓" : f.verdict === "WARN" ? "⚠" : "✗";
    console.log(`${icon} [${f.verdict}] ${f.route} — ${f.check}: ${f.detail}`);
  }
  console.log(`\nSummary: ${findings.length} checks, ${fails.length} FAIL, ${warns.length} WARN\n`);

  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
