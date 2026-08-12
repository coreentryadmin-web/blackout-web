import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WebPageJsonLd, WebApplicationJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { buildPublicGexSnapshot } from "@/lib/public-gex-snapshot";
import { GammaSnapshotWidget } from "@/components/tools/GammaSnapshotWidget";

// Free public lead magnet — docs/marketing/SEO-GROWTH.md finding #5.
export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata(
  "Free Gamma Flip & Wall Levels — Live SPX/SPY/QQQ | BlackOut",
  "Free dealer gamma snapshot for SPX, SPY, and QQQ: the gamma flip level, call wall, put wall, and the long/short-gamma regime, updated live every 5 seconds.",
  "/tools/gamma-snapshot"
);

export default async function GammaSnapshotPage() {
  const initial = await buildPublicGexSnapshot("SPX");

  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Free Gamma Flip & Wall Levels"
        description="Free dealer gamma snapshot for SPX, SPY, and QQQ."
        path="/tools/gamma-snapshot"
      />
      <WebApplicationJsonLd
        name="Gamma Flip & Wall Levels"
        description="Free dealer gamma snapshot for SPX, SPY, and QQQ: the gamma flip level, call wall, put wall, and the long/short-gamma regime, updated live every 5 seconds."
        path="/tools/gamma-snapshot"
      />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Gamma Snapshot", href: "/tools/gamma-snapshot" },
      ]} />
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Free Tool
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          Gamma Flip &amp; Wall Levels
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          Where dealer gamma flips from long to short, and the strikes acting as resistance
          (call wall) and support (put wall) right now — for SPX, SPY, and QQQ. Free, no account
          needed.
        </p>

        <div className="mt-10">
          <GammaSnapshotWidget initial={initial} />
        </div>

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-sky-300/50">
          This snapshot refreshes live every 5 seconds while the tab is open — the same cadence as the dealer-gamma matrix on the member desk.
          Members trading live see tick-by-tick dealer positioning on the full desk (Thermal,
          GEX/VEX/DEX/CHARM by strike and expiry), not just this summary.
        </p>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">What am I looking at?</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-secondary">
          <p>
            <strong className="text-white">Gamma flip</strong> — the price where dealers switch
            from long to short gamma. Above it, dealer hedging tends to dampen moves (dip-buying,
            range-bound). Below it, hedging tends to amplify moves (volatility expands). Full
            explainer: <Link href="/learn/gamma-flip-explained" className="text-cyan-300 hover:underline">Gamma Flip Explained</Link>.
          </p>
          <p>
            <strong className="text-white">Call wall / put wall</strong> — the strikes with the
            largest positive/negative dealer gamma concentration, acting as mechanical
            resistance/support. Full explainer:{" "}
            <Link href="/learn/call-wall-put-wall-explained" className="text-cyan-300 hover:underline">
              Call Wall &amp; Put Wall Explained
            </Link>.
          </p>
        </div>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
          >
            See the live desk →
          </Link>
          <Link
            href="/learn"
            className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
          >
            Learn the framework →
          </Link>
        </div>

        <p className="mt-10 font-mono text-[11px] leading-relaxed text-sky-300/50">
          Educational and informational only — not financial advice. Nothing here is a
          recommendation to buy or sell.
        </p>
      </section>
    </MarketingPageShell>
  );
}
