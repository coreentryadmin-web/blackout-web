#!/usr/bin/env node
/**
 * Ping Bing IndexNow with all public sitemap URLs after deploy.
 * Key file: public/a1522e9c3ec34cf57a2f7ce063981593.txt (must stay reachable).
 *
 * Usage: node scripts/seo/indexnow-ping.mjs
 * Env: INDEXNOW_BASE (default https://blackouttrades.com)
 */
import { indexNowUrls } from "../../src/lib/seo/sitemap-urls.ts";
import { INDEXNOW_KEY, INDEXNOW_KEY_URL } from "../../src/lib/seo/verification.ts";

const BASE = (process.env.INDEXNOW_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const host = new URL(BASE).hostname;

const urlList = indexNowUrls().map((u) => u.replace("https://blackouttrades.com", BASE));

async function main() {
  const body = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_URL.replace("https://blackouttrades.com", BASE),
    urlList: urlList.slice(0, 10_000),
  };

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (res.ok || res.status === 202) {
    console.log(`IndexNow OK (${res.status}) — ${urlList.length} URLs for ${host}`);
    process.exit(0);
  }

  console.error(`IndexNow FAIL ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
