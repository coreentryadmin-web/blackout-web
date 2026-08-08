import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE } from "@/lib/site";
import { LEARN_ARTICLES } from "@/lib/learn/articles";
import { GET } from "./route.ts";

test("llms.txt includes the shared SITE description, not a hand-typed duplicate", async () => {
  const body = await GET().text();
  assert.ok(body.startsWith(`# ${SITE.name}`));
  assert.ok(body.includes(`> ${SITE.description}`));
});

test("llms.txt links every canonical top-level marketing page", async () => {
  const body = await GET().text();
  for (const path of ["/", "/pricing", "/faq", "/why-blackout", "/about", "/contact", "/learn"]) {
    assert.ok(body.includes(`(${SITE.url}${path === "/" ? "/" : path})`), `missing link to ${path}`);
  }
});

test("llms.txt lists every learn article and points sitemap/RSS at real routes", async () => {
  const body = await GET().text();
  assert.ok(LEARN_ARTICLES.length > 0, "sanity: LEARN_ARTICLES should not be empty");
  for (const article of LEARN_ARTICLES) {
    assert.ok(body.includes(`(${SITE.url}${article.path})`), `missing learn article link: ${article.path}`);
  }
  assert.ok(body.includes(`${SITE.url}/sitemap.xml`));
  assert.ok(body.includes(`${SITE.url}/feed.xml`));
});

test("llms.txt is served as plain text with a public cache header", () => {
  const res = GET();
  assert.equal(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.match(res.headers.get("Cache-Control") ?? "", /public/);
});
