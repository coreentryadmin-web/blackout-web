import { SITE } from "@/lib/site";
import { feedArticles, feedPubDateForArticle } from "@/lib/seo/sitemap-dates";

export const dynamic = "force-static";
export const revalidate = 86400;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*]\s+/gm, "- ")
    .replace(/\|[^\n]+\|/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function GET() {
  const articles = feedArticles();
  const lastBuildDate = new Date(
    Math.max(...articles.map((a) => Date.parse(feedPubDateForArticle(a.slug)))),
  ).toUTCString();

  const items = articles
    .map((a) => {
      const description = stripMarkdown(a.body).slice(0, 500);
      const pubDate = feedPubDateForArticle(a.slug);
      return `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${SITE.url}${a.path}</link>
      <guid isPermaLink="true">${SITE.url}${a.path}</guid>
      <description>${escapeXml(description)}</description>
      <pubDate>${pubDate}</pubDate>
      <category>Options Trading</category>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.name)} — Learn Options Trading</title>
    <link>${SITE.url}/learn</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${SITE.url}/images/blackout-emblem.webp</url>
      <title>${escapeXml(SITE.name)}</title>
      <link>${SITE.url}</link>
    </image>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
