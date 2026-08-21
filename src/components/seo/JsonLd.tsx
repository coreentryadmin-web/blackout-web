import { SITE } from "@/lib/site";
import { IMAGES } from "@/lib/images";
import { MEMBERSHIP_PRICING } from "@/lib/pricing";

type JsonLdProps = { data: Record<string, unknown> };

function JsonLdScript({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Stable @id nodes so the Organization and WebSite are ONE linked entity graph rather than two
 * unrelated blobs. Google and the AI answer engines resolve `@id` references to build a single
 * entity; without them, WebSite.publisher is a second, duplicate Organization that dilutes the
 * signal instead of reinforcing it.
 */
const ORG_ID = `${SITE.url}/#organization`;
const WEBSITE_ID = `${SITE.url}/#website`;

/**
 * The subjects BlackOut is authoritative on. `knowsAbout` is the single strongest topical-authority
 * signal a site controls in structured data: it tells Google's entity graph and the AI answer
 * engines (which increasingly cite by entity, not by backlink) what this brand is an authority FOR.
 * Every term here is a subject the site actually has depth on — matched to the real query demand in
 * Search Console (gamma exposure, dealer positioning, 0DTE, options flow), never aspirational.
 */
const BRAND_TOPICS = [
  "Gamma exposure (GEX)",
  "Dealer gamma positioning",
  "0DTE options trading",
  "SPX options",
  "Options order flow",
  "Unusual options activity",
  "Dark pool activity",
  "Market maker hedging",
  "Options Greeks",
  "Gamma flip and dealer hedging levels",
] as const;

export function OrganizationJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": ORG_ID,
        name: SITE.name,
        // Brand variants a searcher actually types. Without these, "BlackOut Trades" and the bare
        // "BlackOut" read as different strings to the entity graph.
        alternateName: ["BlackOut", "BlackOut Trades", SITE.legalName],
        legalName: SITE.legalName,
        url: SITE.url,
        slogan: SITE.tagline,
        // ImageObject rather than a bare URL string — Google's Organization logo guidelines want a
        // resolvable image node, and it lets the same asset be referenced as the entity's logo.
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}${IMAGES.ogImage}`,
        },
        description: SITE.description,
        knowsAbout: [...BRAND_TOPICS],
        sameAs: [
          SITE.social.x.url,
          SITE.social.instagram.url,
          SITE.social.discord.url,
        ],
        contactPoint: {
          "@type": "ContactPoint",
          email: "support@blackouttrades.com",
          contactType: "customer support",
        },
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE.name,
        url: SITE.url,
        inLanguage: "en-US",
        description: SITE.description,
        // Reference the Organization node by @id instead of inlining a second, duplicate
        // Organization — this is what fuses the two into one entity for Google and AI engines.
        // No potentialAction/SearchAction: the site has no site-wide search endpoint, and a
        // SearchAction pointing at a URL that does not resolve is a structured-data error, not a
        // feature.
        publisher: { "@id": ORG_ID },
        about: { "@id": ORG_ID },
      }}
    />
  );
}

export function FAQPageJsonLd({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      }}
    />
  );
}

export function BreadcrumbJsonLd({ items }: { items: { name: string; href: string }[] }) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.name,
          item: `${SITE.url}${item.href}`,
        })),
      }}
    />
  );
}

export function SoftwareApplicationJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE.name,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web, iOS",
        url: SITE.url,
        description: SITE.description,
        offers: [
          {
            "@type": "Offer",
            name: "SPX Slayer",
            price: String(MEMBERSHIP_PRICING.community),
            priceCurrency: "USD",
            url: `${SITE.url}/pricing`,
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: "Premium",
            price: String(MEMBERSHIP_PRICING.monthly),
            priceCurrency: "USD",
            url: `${SITE.url}/pricing`,
            availability: "https://schema.org/InStock",
          },
        ],
        provider: {
          "@type": "Organization",
          name: SITE.name,
          url: SITE.url,
        },
      }}
    />
  );
}

/**
 * Distinct from SoftwareApplicationJsonLd (the paid membership product on /pricing) — this
 * describes a single free, no-account browser tool (e.g. /tools/gamma-snapshot) as its own
 * WebApplication entity, separate from the site-wide paid product schema.
 */
export function WebApplicationJsonLd({
  name,
  description,
  path,
}: {
  name: string;
  description: string;
  path: string;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name,
        description,
        url: `${SITE.url}${path}`,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        provider: {
          "@type": "Organization",
          name: SITE.name,
          url: SITE.url,
        },
      }}
    />
  );
}

export function WebPageJsonLd({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        description,
        url: `${SITE.url}${path}`,
        isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
      }}
    />
  );
}

export function CollectionPageJsonLd({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: `${SITE.url}${path}`,
        isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
      }}
    />
  );
}

export function ItemListJsonLd({
  name,
  items,
}: {
  name: string;
  items: { name: string; url: string }[];
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "ItemList",
        name,
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.name,
          url: item.url,
        })),
      }}
    />
  );
}

export function ArticleJsonLd({
  title,
  description,
  path,
  image,
  datePublished,
  dateModified,
  authorName = "BlackOut Trades",
}: {
  title: string;
  description: string;
  path: string;
  /** Falls back to the site's default OG image — Google's Article guidelines require one. */
  image?: string;
  datePublished?: string;
  dateModified?: string;
  authorName?: string;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        url: `${SITE.url}${path}`,
        image: image ?? `${SITE.url}${IMAGES.ogImage}`,
        ...(datePublished && { datePublished }),
        ...(dateModified && { dateModified }),
        author: {
          "@type": "Organization",
          name: authorName,
          url: SITE.url,
        },
        publisher: {
          "@type": "Organization",
          name: SITE.name,
          url: SITE.url,
          logo: { "@type": "ImageObject", url: `${SITE.url}${IMAGES.ogImage}` },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE.url}${path}` },
      }}
    />
  );
}
