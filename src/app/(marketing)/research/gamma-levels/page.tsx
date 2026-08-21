import type { Metadata } from "next";
import Link from "next/link";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { BreadcrumbJsonLd, CollectionPageJsonLd, ItemListJsonLd } from "@/components/seo/JsonLd";
import { publicPageMetadata } from "@/lib/page-metadata";
import { SITE } from "@/lib/site";
import { researchTickerPath, researchTickers } from "@/lib/research/research-tickers";
import { RESEARCH_WINDOW_SESSIONS } from "@/lib/research/gamma-levels";

/**
 * Hub for the dealer-gamma research pages.
 *
 * Static: it lists routes, not data, so it has no reason to touch Postgres or Polygon and no
 * reason to go stale. A per-ticker page below the coverage floor 404s on its own; the hub does
 * not try to predict that, because doing so would mean querying every ticker to render a list of
 * links.
 */

const TITLE = "Dealer Gamma Levels by Ticker — Wall & Flip History | BlackOut";
const DESCRIPTION =
  "Where the dealer call wall, put wall and gamma flip actually sat for each major ticker over the last quarter — and how often price respected them. Measured from our own recorded positioning.";

export const metadata: Metadata = publicPageMetadata(TITLE, DESCRIPTION, "/research/gamma-levels");

export default function GammaLevelsHubPage() {
  const tickers = researchTickers();
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Research", href: "/research/gamma-levels" },
  ];

  return (
    <MarketingPageShell showChart={false}>
      <CollectionPageJsonLd title={TITLE} description={DESCRIPTION} path="/research/gamma-levels" />
      <BreadcrumbJsonLd items={crumbs} />
      <ItemListJsonLd
        name="Dealer gamma level research by ticker"
        items={tickers.map((t) => ({ name: `${t} gamma levels`, url: `${SITE.url}${researchTickerPath(t)}` }))}
      />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Breadcrumbs items={crumbs} />

        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Research
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          Dealer Gamma Levels by Ticker
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          For every session, we record where each ticker&apos;s dealer gamma concentrates — the
          call wall above price, the put wall below it, and the gamma flip between them. These
          pages are the {RESEARCH_WINDOW_SESSIONS}-session record of what those levels did next:
          which ones capped a rally, which ones gave way, and which strikes kept coming back.
        </p>

        <p className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[11px] leading-relaxed text-sky-300/60">
          Historical research on closed sessions — not live levels, not trade advice. For the
          current read, the{" "}
          <Link href="/tools/gamma-snapshot" className="text-cyan-300 hover:underline">
            free gamma snapshot
          </Link>{" "}
          covers SPX, SPY and QQQ.
        </p>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">Browse by ticker</h2>
        <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tickers.map((t) => (
            <li key={t}>
              <Link
                href={researchTickerPath(t)}
                className="block rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-center font-mono text-sm text-cyan-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/5"
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">How to read these pages</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-secondary">
          <p>
            A <strong className="text-white">call wall</strong> is the strike with the largest
            positive dealer gamma concentration — the level where hedging tends to act as
            resistance. The <strong className="text-white">put wall</strong> is its mirror below
            price. The <strong className="text-white">gamma flip</strong> separates the regime
            where dealer hedging dampens moves from the one where it amplifies them. Each term has
            a full explainer in{" "}
            <Link href="/learn/dealer-gamma-options-flow-guide" className="text-cyan-300 hover:underline">
              the dealer gamma guide
            </Link>
            .
          </p>
          <p>
            Every page states what it is measured over. A hold rate always carries the number of
            sessions that actually tested the level, because a rate without its denominator is not
            a fact — and levels price never approached are marked untested rather than scored as
            holds.
          </p>
        </div>
      </section>
    </MarketingPageShell>
  );
}
