import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ArticleJsonLd, BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { publicPageMetadata } from "@/lib/page-metadata";
import { loadGammaLevelsResearch } from "@/lib/research/gamma-levels";
import { isPublishable, type SessionLevels } from "@/lib/research/gamma-levels-core";
import {
  coverageSentence,
  flipSentence,
  formatLevel,
  formatSessionLabel,
  pageCopy,
  recurringSentence,
  wallSentence,
} from "@/lib/research/gamma-levels-copy";
import { isResearchTicker, researchTickers } from "@/lib/research/research-tickers";

/**
 * Public dealer-gamma research, one page per covered ticker.
 *
 * PUBLISH POSTURE. Everything on this page is a PRIOR CLOSED session, DERIVED by us, and
 * AGGREGATED across a window — the three properties that separate publishable research from
 * redistribution of live vendor data. The delay is enforced by type in
 * `lib/research/publishable-session.ts`, not by anything in this file; see that module for why.
 *
 * A page below the publish floor 404s rather than rendering thin. Mass-produced URLs that make a
 * statistical claim over four sessions are bad for the reader first and the site second, and a
 * 404 is recoverable in a way a de-indexed template is not.
 */

// Revalidated hourly. The underlying window only changes once a day, when a new session becomes
// publishable — the hour is just a bound on how long a stale render can persist after that flip.
export const revalidate = 3600;

// DELIBERATELY NO `generateStaticParams`, and `dynamicParams` left at its default of true.
//
// Pre-rendering these at build time would bind every page to whether the BUILD could reach
// Postgres and Polygon. It cannot: CI builds the image without production data access, so every
// page would find an empty window, fall through to `notFound()`, and bake a permanent 404 into
// the deployment — a page that is fine in production but 404s forever because of where it was
// compiled. On-demand ISR renders each page on its first real request, in the environment that
// actually has the data, then caches it for `revalidate`.
export const dynamicParams = true;

type Params = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  if (!isResearchTicker(symbol)) return {};

  const research = await loadGammaLevelsResearch(symbol);
  const copy = pageCopy(research);
  return publicPageMetadata(copy.metaTitle, copy.metaDescription, `/research/gamma-levels/${ticker.toLowerCase()}`, {
    ogType: "article",
  });
}

function OutcomePill({ outcome }: { outcome: SessionLevels["callWallOutcome"] }) {
  const style =
    outcome === "held"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : outcome === "broke"
        ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
        : "border-white/10 bg-white/5 text-secondary";
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${style}`}>
      {outcome}
    </span>
  );
}

export default async function GammaLevelsTickerPage({ params }: Params) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  if (!isResearchTicker(symbol)) notFound();

  const research = await loadGammaLevelsResearch(symbol);
  if (!isPublishable(research)) notFound();

  const copy = pageCopy(research);
  const path = `/research/gamma-levels/${ticker.toLowerCase()}`;
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Research", href: "/research/gamma-levels" },
    { name: `${symbol} Gamma Levels`, href: path },
  ];
  // Newest session drives dateModified — the page's content genuinely changes only when a new
  // session enters the window, so claiming any other date would misstate its freshness.
  const modified = research.window?.to;
  const peers = researchTickers().filter((t) => t !== symbol).slice(0, 12);

  return (
    <MarketingPageShell showChart={false}>
      <ArticleJsonLd
        title={copy.metaTitle}
        description={copy.metaDescription}
        path={path}
        datePublished={research.window?.from}
        dateModified={modified}
      />
      <BreadcrumbJsonLd items={crumbs} />

      <article className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Breadcrumbs items={crumbs} />

        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Dealer Positioning Research
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl">{copy.h1}</h1>
        <p className="mt-4 text-base leading-relaxed text-secondary sm:text-lg">{copy.standfirst}</p>

        <p className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[11px] leading-relaxed text-sky-300/60">
          Historical research on closed sessions. These are measurements of dealer positioning we
          recorded at the time, not live levels and not trade advice. Members see current
          positioning on the live desk.
        </p>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">What the walls did</h2>
        <div className="mt-4 space-y-4 text-sm leading-relaxed text-secondary">
          <p>{wallSentence(research.callWall, "call wall", symbol)}</p>
          <p>{wallSentence(research.putWall, "put wall", symbol)}</p>
          <p>{recurringSentence(research)}</p>
        </div>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">Which side of the flip</h2>
        <p className="mt-4 text-sm leading-relaxed text-secondary">{flipSentence(research)}</p>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          The gamma flip is the price where dealers switch from long to short gamma — the line
          between hedging that dampens moves and hedging that amplifies them. Full explainer:{" "}
          <Link href="/learn/gamma-flip-explained" className="text-cyan-300 hover:underline">
            Gamma Flip Explained
          </Link>
          .
        </p>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">Session by session</h2>
        <p className="mt-3 text-sm leading-relaxed text-secondary">{coverageSentence(research)}</p>

        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left font-mono text-xs">
            <thead className="bg-white/[0.04] text-secondary">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Session</th>
                <th scope="col" className="px-3 py-2 font-medium">Call wall</th>
                <th scope="col" className="px-3 py-2 font-medium">Result</th>
                <th scope="col" className="px-3 py-2 font-medium">Put wall</th>
                <th scope="col" className="px-3 py-2 font-medium">Result</th>
                <th scope="col" className="px-3 py-2 font-medium">Gamma flip</th>
                <th scope="col" className="px-3 py-2 font-medium">Close</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {research.sessions.map((s) => (
                <tr key={s.session} className="border-t border-white/5">
                  <td className="whitespace-nowrap px-3 py-2 text-secondary">{formatSessionLabel(s.session)}</td>
                  <td className="px-3 py-2 tabular-nums">{s.callWall === null ? "—" : formatLevel(s.callWall)}</td>
                  <td className="px-3 py-2"><OutcomePill outcome={s.callWallOutcome} /></td>
                  <td className="px-3 py-2 tabular-nums">{s.putWall === null ? "—" : formatLevel(s.putWall)}</td>
                  <td className="px-3 py-2"><OutcomePill outcome={s.putWallOutcome} /></td>
                  <td className="px-3 py-2 tabular-nums">{s.gammaFlip === null ? "—" : formatLevel(s.gammaFlip)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatLevel(s.close)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">How this is measured</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-secondary">
          <p>
            Each session&apos;s wall is the strike our recorder saw hold that role most often
            through the day, not wherever it happened to sit at the close — the final minutes of an
            expiry are the least stable read of the book, and a single closing snapshot would
            report noise as a level.
          </p>
          <p>
            A wall counts as <strong className="text-white">tested</strong> only when price
            actually reached it. Held means the session extreme stopped there; broke means price
            went through. A level price never approached is marked untested rather than scored a
            hold — otherwise a wall far from spot would collect a perfect record for doing nothing.
          </p>
        </div>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">Other tickers</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {peers.map((t) => (
            <li key={t}>
              <Link
                href={`/research/gamma-levels/${t.toLowerCase()}`}
                className="inline-block rounded border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-cyan-300 hover:border-cyan-300/40"
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/tools/gamma-snapshot"
            className="rounded-lg border border-cyan-300/30 px-5 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-300/10"
          >
            Free live gamma snapshot →
          </Link>
          <Link
            href="/learn/dealer-gamma-options-flow-guide"
            className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/5"
          >
            Read the full guide
          </Link>
        </div>
      </article>
    </MarketingPageShell>
  );
}
