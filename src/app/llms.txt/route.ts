import { SITE } from "@/lib/site";
import { LEARN_ARTICLES } from "@/lib/learn/articles";
import { LEARN_NAV } from "@/lib/learn/nav";

export function GET() {
  const lines: string[] = [
    `# ${SITE.name}`,
    `> ${SITE.description}`,
    "",
    "## Product",
    `- [Home](${SITE.url}/)`,
    `- [Pricing](${SITE.url}/pricing)`,
    `- [FAQ](${SITE.url}/faq)`,
    `- [Why BlackOut](${SITE.url}/why-blackout)`,
    `- [About](${SITE.url}/about)`,
    `- [Contact](${SITE.url}/contact)`,
    "",
    "## BlackOut Academy (free guides)",
    `- [Learn hub](${SITE.url}/learn)`,
    "",
    "### Curriculum",
    ...LEARN_NAV.map((item) => `- [${item.label}](${SITE.url}/learn/${item.slug}) — ${item.description}`),
    "",
    "### Guides",
    ...LEARN_ARTICLES.map(
      (a) => `- [${a.title}](${SITE.url}${a.path}) — ${a.description}`,
    ),
    "",
    "## Notes",
    "- The live trading desk (dealer gamma, options flow, dark-pool, scanners) is an authenticated, paid app — not crawlable. The Curriculum guides above are the public explainer for each tool.",
    "",
    "## Optional",
    `- [Sitemap](${SITE.url}/sitemap.xml)`,
    `- [RSS](${SITE.url}/feed.xml)`,
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
