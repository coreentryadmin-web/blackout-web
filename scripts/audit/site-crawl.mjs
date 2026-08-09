/**
 * Full-site authenticated crawl of production.
 *
 * Signs in ONCE as a temp admin/premium Clerk member (deleted in a finally),
 * then walks every known route plus every internal link discovered along the
 * way, recording what a real signed-in member would get.
 *
 * WHY HTTP AND NOT A BROWSER: Chromium here cannot reach the network directly,
 * and the desks hold open SSE streams that never settle, so a headless render
 * deadlocks (proved earlier today: /nighthawk and /flows both blew their
 * screenshot deadline on /api/market/*\/stream). Fetch sees exactly what the
 * server sends, which is what catches 404s, 500s, redirect loops and dead
 * links. Client-rendered breakage needs the browser pass and is NOT claimed here.
 *
 * Never prints the session cookie.
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { isSoftNotFound, hasServerError, toInternalPath, canonicalPath } from "./lib/site-audit-eval.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.CRAWL_OUT || "/tmp/crawl-report.json";
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 6);

const STATIC_ROUTES = [
  "/", "/about", "/contact", "/pricing", "/faq", "/why-blackout", "/upgrade",
  "/terms", "/privacy", "/disclaimer", "/cookie-policy", "/refund-policy",
  "/learn", "/dashboard", "/account", "/track-record",
  "/nighthawk", "/vector", "/flows", "/heatmap", "/terminal",
  "/admin", "/admin/users", "/admin/track-record", "/admin/largo-answer-preview",
  "/embed/track-record", "/sign-in", "/sign-up",
];

const learnSlugs = JSON.parse(readFileSync(process.env.LEARN_SLUGS, "utf8"));
const SEED = [...STATIC_ROUTES, ...learnSlugs.map((s) => `/learn/${s}`)];


const seen = new Map();
const queue = [...SEED];
const queued = new Set(SEED);

const sameOrigin = (href) => toInternalPath(href, BASE);

function extract(html) {
  const links = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]);
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  return { links, imgs };
}

async function visit(path, cookieHeader) {
  const started = Date.now();
  let res, body = "";
  try {
    res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      headers: { Cookie: cookieHeader, "User-Agent": "BlackOutSiteAudit/1.0" },
    });
    if (res.status < 300 || res.status >= 400) body = await res.text();
  } catch (e) {
    return { path, error: String(e.message).slice(0, 200), ms: Date.now() - started };
  }
  const ms = Date.now() - started;
  const loc = res.headers.get("location");
  const rec = {
    path,
    status: res.status,
    ms,
    bytes: body.length,
    redirect: loc || null,
    softNotFound: isSoftNotFound(res.status, body),
    serverError: hasServerError(body),
    // A real page ships a <main> and a non-trivial body. A 200 with 800 bytes
    // and no <main> is a shell that rendered nothing.
    hasMain: /<main\b/i.test(body),
    title: (body.match(/<title>([^<]*)<\/title>/i)?.[1] || "").trim().slice(0, 90),
  };
  if (body && res.status === 200) {
    const { links, imgs } = extract(body);
    rec.outLinks = [...new Set(links.map(sameOrigin).filter(Boolean))];
    rec.imgs = [...new Set(imgs.map((s) => sameOrigin(s) || (s.startsWith("http") ? null : s)).filter(Boolean))];
    for (const l of rec.outLinks) {
      const clean = canonicalPath(l);
      if (!queued.has(clean)) { queued.add(clean); queue.push(clean); }
    }
  }
  return rec;
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) { console.error(`SKIP: ${session.reason}`); process.exit(2); }

try {
  let done = 0;
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(batch.map((p) => visit(p, session.cookieHeader)));
    for (const r of results) { seen.set(r.path, r); done++; }
    if (done % 30 === 0) console.error(`  …${done} pages, ${queue.length} queued`);
    if (done > 400) { console.error("cap 400 reached"); break; }
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}

const all = [...seen.values()];
writeFileSync(OUT, JSON.stringify(all, null, 2));
console.error(`\ncrawled ${all.length} pages -> ${OUT}`);
