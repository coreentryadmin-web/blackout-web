#!/usr/bin/env node
/**
 * Canonical-safe article syndication — cross-posts BlackOut Academy guides to Dev.to and Hashnode
 * WITHOUT cannibalizing our own rankings.
 *
 * WHY THE CANONICAL IS NON-NEGOTIABLE. Syndicating an article to a higher-authority domain
 * (Dev.to DA ~90) without a cross-domain canonical loses ~40% of the original's organic traffic
 * to the platform in the first week, and increasingly loses the AI citation too. Every post this
 * script makes therefore sets the platform's canonical field back to OUR URL, so Google and the AI
 * engines credit blackouttrades.com as the source and the syndicated copy only adds reach.
 *
 * THE OTHER GUARDRAILS, all encoded here:
 *  - Publish-first: we only syndicate articles that are already live and indexed on our site
 *    (the whole /learn corpus has been live and indexed for months), never draft content.
 *  - Idempotent: before posting, we read what the account already published and skip any article
 *    whose canonical already exists there — safe to run on a schedule forever, never double-posts.
 *  - Paced: one article per run by default (--limit), so a schedule drips rather than blasts, which
 *    is what keeps the account from being flagged as a spam importer.
 *  - Best content only: pillars and full articles, never the glossary or thin stubs.
 *  - Visual: every post carries a per-article branded cover image (maximizes engagement/visibility).
 *
 * Keys come from Secrets Manager (blackout-production/marketing/{devto,hashnode}); NEVER printed.
 * Runs with tsx so it can import the real article source:
 *   node --import tsx scripts/seo/syndicate-articles.mjs [--dry-run] [--limit=N] [--platform=devto|hashnode|both]
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { LEARN_ARTICLES } from "../../src/lib/learn/articles.ts";

const SITE = "https://blackouttrades.com";

/* ── PURE HELPERS (exported, unit-tested by syndicate-articles.test.ts) ─────────────────────── */

/** Rewrite site-relative markdown links (`](/learn/x)`) to absolute so they resolve off-site. */
export function absolutizeLinks(md) {
  // `](/...` but not `](//...` (protocol-relative) and not already-absolute `](http`.
  return md.replace(/\]\(\/(?!\/)/g, `](${SITE}/`);
}

/** Canonical URL for an article — the ONE thing every syndicated copy must point back to. */
export function canonicalUrl(article) {
  return `${SITE}${article.path}`;
}

/**
 * Real BlackOut desk screenshots, mapped by topic. A screenshot of the ACTUAL product outperforms
 * any generated art for a data brand — it shows the real thing and doubles as a soft product demo.
 * Each entry carries the desk path so the in-body CTA links to where the reader can see it live.
 * Order matters: the most specific patterns come first.
 */
const PRODUCT_SHOTS = [
  { re: /gamma|gex|dealer|wall|flip|heatmap|thermal|charm|vex|dex|pin|max-pain/i, img: "thermal", desk: "/heatmap", label: "the Thermal dealer-positioning heatmap" },
  { re: /flow|dark-pool|dark pool|unusual|helix|sweep|whale/i, img: "helix", desk: "/flows", label: "HELIX live options flow" },
  { re: /night-hawk|night hawk|swing|overnight|evening/i, img: "hawk", desk: "/nighthawk", label: "the Night Hawk evening playbook" },
  { re: /largo|ai-market|market analysis/i, img: "largo", desk: "/terminal", label: "the Largo intelligence desk" },
  { re: /vector|structure|rth/i, img: "vector", desk: "/vector", label: "the Vector structure desk" },
  { re: /spx|0dte|iron.?condor|slayer|straddle|butterfly|credit.?spread|lotto/i, img: "spx", desk: "/nighthawk", label: "the SPX Slayer 0DTE desk" },
];

/** The best-matching real desk screenshot for an article, or null for general-options topics. */
export function productShotFor(article) {
  const hay = `${article.slug} ${article.targetKeyword ?? ""} ${article.title}`;
  return PRODUCT_SHOTS.find((m) => m.re.test(hay)) ?? null;
}

/** Cover image: a real desk screenshot when the topic maps to a product, else the branded card. */
export function coverImageUrl(article) {
  const shot = productShotFor(article);
  if (shot) return `${SITE}/images/marketing/${shot.img}.webp`;
  const p = new URLSearchParams({ title: article.title, description: article.description });
  return `${SITE}/api/og?${p.toString()}`;
}

/** Body prepared for syndication: absolute links + an explicit "originally published" attribution
 *  that also carries the canonical link in visible text (belt and braces with the API canonical). */
export function syndicatedBody(article) {
  const canonical = canonicalUrl(article);
  const shot = productShotFor(article);
  // A real desk screenshot + a link to see it live — the visual doubles as a soft product demo.
  const demo = shot
    ? `\n\n---\n\n### See it on the live desk\n\n` +
      `![${shot.label}](${SITE}/images/marketing/${shot.img}.webp)\n\n` +
      `*${article.title.replace(/\s*[|:].*$/, "")} in action — ${shot.label} on the BlackOut desk. ` +
      `[Open it live →](${SITE}${shot.desk})*`
    : "";
  return (
    `${absolutizeLinks(article.body)}${demo}\n\n---\n\n` +
    `*Originally published on [BlackOut Trades](${canonical}) — live dealer gamma, 0DTE options ` +
    `flow, and A–F graded SPX setups. [Try the free Gamma Snapshot tool →](${SITE}/tools/gamma-snapshot)*`
  );
}

/** Dev.to tags: max 4, lowercase alphanumeric. Curated to the audience, valid by construction. */
export const DEVTO_TAGS = ["options", "trading", "finance", "investing"];

/** Hashnode tags need {slug,name}. Same topic set. */
export const HASHNODE_TAGS = [
  { slug: "options", name: "Options" },
  { slug: "trading", name: "Trading" },
  { slug: "finance", name: "Finance" },
  { slug: "stock-market", name: "Stock Market" },
];

/** Only real, evergreen educational content — pillars first (our strongest), then articles.
 *  Glossary and any non-article types are excluded. */
export function eligibleArticles(articles) {
  const rank = (t) => (t === "pillar" ? 0 : t === "article" ? 1 : 2);
  return articles
    .filter((a) => a.type === "pillar" || a.type === "article")
    .slice()
    .sort((a, b) => rank(a.type) - rank(b.type));
}

/** Next N eligible articles whose canonical is NOT already syndicated on that platform. */
export function pickToSyndicate(articles, alreadyPostedCanonicals, limit = 1) {
  const posted = new Set(alreadyPostedCanonicals);
  return eligibleArticles(articles)
    .filter((a) => !posted.has(canonicalUrl(a)))
    .slice(0, limit);
}

/* ── LIVE (only runs when invoked directly) ────────────────────────────────────────────────── */

async function readSecret(name) {
  const sm = new SecretsManagerClient({ region: "us-east-1" });
  const raw = (await sm.send(new GetSecretValueCommand({ SecretId: name }))).SecretString;
  return JSON.parse(raw);
}

async function devtoAlreadyPosted(apiKey) {
  const canonicals = new Set();
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://dev.to/api/articles/me/all?per_page=100&page=${page}`, {
      headers: { "api-key": apiKey, "User-Agent": "BlackOut-SEO/1.0" },
    });
    if (!res.ok) break;
    const rows = await res.json();
    if (!rows.length) break;
    for (const r of rows) if (r.canonical_url) canonicals.add(r.canonical_url);
    if (rows.length < 100) break;
  }
  return canonicals;
}

async function postToDevto(apiKey, article, dryRun) {
  const payload = {
    article: {
      title: article.title,
      body_markdown: syndicatedBody(article),
      published: true,
      canonical_url: canonicalUrl(article),
      description: article.description,
      main_image: coverImageUrl(article),
      tags: DEVTO_TAGS,
    },
  };
  if (dryRun) return { dryRun: true, url: canonicalUrl(article) };
  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", "User-Agent": "BlackOut-SEO/1.0" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Dev.to ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return { url: body.url, id: body.id };
}

async function hashnodePosted(apiKey, publicationId) {
  const canonicals = new Set();
  const q = `query($id:ObjectId!,$after:String){ publication(id:$id){ posts(first:50, after:$after){ edges{ node{ canonicalUrl } cursor } pageInfo{ hasNextPage endCursor } } } } `;
  let after = null;
  for (let i = 0; i < 20; i++) {
    const res = await fetch("https://gql.hashnode.com/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey, "User-Agent": "BlackOut-SEO/1.0" },
      body: JSON.stringify({ query: q, variables: { id: publicationId, after } }),
    });
    const j = await res.json().catch(() => ({}));
    const posts = j?.data?.publication?.posts;
    if (!posts) break;
    for (const e of posts.edges) if (e.node.canonicalUrl) canonicals.add(e.node.canonicalUrl);
    if (!posts.pageInfo.hasNextPage) break;
    after = posts.pageInfo.endCursor;
  }
  return canonicals;
}

async function postToHashnode(apiKey, publicationId, article, dryRun) {
  if (dryRun) return { dryRun: true, url: canonicalUrl(article) };
  const mutation = `mutation Publish($input: PublishPostInput!){ publishPost(input:$input){ post{ id url } } }`;
  const input = {
    title: article.title,
    publicationId,
    contentMarkdown: syndicatedBody(article),
    originalArticleURL: canonicalUrl(article),
    tags: HASHNODE_TAGS,
    coverImageOptions: { coverImageURL: coverImageUrl(article) },
  };
  const res = await fetch("https://gql.hashnode.com/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey, "User-Agent": "BlackOut-SEO/1.0" },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.errors) throw new Error(`Hashnode: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return { url: j?.data?.publishPost?.post?.url, id: j?.data?.publishPost?.post?.id };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;
  const platform = (args.find((a) => a.startsWith("--platform=")) || "--platform=both").split("=")[1];

  const log = (m) => console.log(m);
  log(`syndicate-articles — platform=${platform} limit=${limit}${dryRun ? " DRY-RUN" : ""}`);

  if (platform === "devto" || platform === "both") {
    try {
      const { DEVTO_API_KEY } = await readSecret("blackout-production/marketing/devto");
      const posted = dryRun ? new Set() : await devtoAlreadyPosted(DEVTO_API_KEY);
      log(`  Dev.to: ${posted.size} already syndicated`);
      const next = pickToSyndicate(LEARN_ARTICLES, posted, limit);
      for (const a of next) {
        const r = await postToDevto(DEVTO_API_KEY, a, dryRun);
        log(`  Dev.to ${dryRun ? "WOULD POST" : "POSTED"}: ${a.title} -> ${r.url || canonicalUrl(a)} (canonical ${canonicalUrl(a)})`);
      }
      if (!next.length) log("  Dev.to: nothing new to syndicate");
    } catch (e) {
      log(`  Dev.to SKIP: ${e.message}`);
    }
  }

  if (platform === "hashnode" || platform === "both") {
    try {
      const sec = await readSecret("blackout-production/marketing/hashnode");
      if (!sec.publication_id) throw new Error("no publication_id stored — create a Hashnode publication first");
      const posted = dryRun ? new Set() : await hashnodePosted(sec.HASHNODE_API_KEY, sec.publication_id);
      log(`  Hashnode: ${posted.size} already syndicated`);
      const next = pickToSyndicate(LEARN_ARTICLES, posted, limit);
      for (const a of next) {
        const r = await postToHashnode(sec.HASHNODE_API_KEY, sec.publication_id, a, dryRun);
        log(`  Hashnode ${dryRun ? "WOULD POST" : "POSTED"}: ${a.title} -> ${r.url || canonicalUrl(a)}`);
      }
      if (!next.length) log("  Hashnode: nothing new to syndicate");
    } catch (e) {
      log(`  Hashnode SKIP: ${e.message}`);
    }
  }
}

// Only run main() when invoked directly, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
