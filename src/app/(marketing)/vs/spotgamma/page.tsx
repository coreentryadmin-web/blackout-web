import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut vs SpotGamma — Compare GEX & Options Flow Platforms",
  "How BlackOut compares to SpotGamma on price, dealer-gamma coverage, options flow, dark pool, and graded track record. Independent feature-by-feature comparison.",
  "/vs/spotgamma"
);

type Row = { feature: string; blackout: string; spotgamma: string };

const ROWS: Row[] = [
  { feature: "Dealer gamma / GEX exposure", blackout: "Yes — Thermal (GEX/VEX/DEX/CHARM heatmaps)", spotgamma: "Yes — core product" },
  { feature: "Key support/resistance levels", blackout: "Yes — call/put walls, gamma flip", spotgamma: "Yes — 3,500+ tickers" },
  { feature: "0DTE-specific desk", blackout: "Yes — SPX Slayer, graded A–F per play", spotgamma: "0DTE analysis included in Founder's Notes" },
  { feature: "Institutional options flow scanner", blackout: "Yes — HELIX (sweeps, blocks, TideBar)", spotgamma: "Not listed as a dedicated module" },
  { feature: "Dark pool prints", blackout: "Yes — real-time, anchored to price", spotgamma: "Not listed" },
  { feature: "AI desk analyst (chat, grounded in live data)", blackout: "Yes — Largo AI", spotgamma: "Not listed" },
  { feature: "Overnight/evening playbook", blackout: "Yes — Night Hawk", spotgamma: "Twice-daily written commentary (Founder's Notes)" },
  { feature: "Public, graded track record", blackout: "Yes — every play logged A–F, wins and losses", spotgamma: "Not published as a structured record" },
  { feature: "Broker/charting integrations", blackout: "No — standalone desk", spotgamma: "Yes — TradingView, ThinkorSwim, NinjaTrader, and others" },
  { feature: "Entry tier price", blackout: usd(MEMBERSHIP_PRICING.community) + "/mo (SPX Slayer)", spotgamma: "$99/mo (Essential)" },
  { feature: "Top tier price", blackout: usd(MEMBERSHIP_PRICING.monthly) + "/mo (Premium, all 6 modules)", spotgamma: "$299/mo (Alpha)" },
];

export default function VsSpotGammaPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="BlackOut vs SpotGamma"
        description="Feature-by-feature comparison of BlackOut and SpotGamma for options traders."
        path="/vs/spotgamma"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "BlackOut vs SpotGamma", href: "/vs/spotgamma" },
      ]} />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Comparison
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          BlackOut vs SpotGamma
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          Both platforms map dealer gamma exposure for options traders. Here&apos;s how they actually
          differ — features, focus, and price, side by side.
        </p>

        <div className="mt-10 overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#050608]/60 backdrop-blur-md">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Feature
                </th>
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                  BlackOut
                </th>
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  SpotGamma
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={i < ROWS.length - 1 ? "border-b border-white/[0.04]" : ""}
                >
                  <td className="px-5 py-3.5 text-white/90">{row.feature}</td>
                  <td className="px-5 py-3.5 text-white/80">{row.blackout}</td>
                  <td className="px-5 py-3.5 text-white/60">{row.spotgamma}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-sky-300/60">
          SpotGamma figures sourced from spotgamma.com and spotgamma.com/pricing (Aug 2026) —
          pricing and features change; verify current details directly with SpotGamma before
          deciding. &ldquo;Not listed&rdquo; means the feature doesn&apos;t appear on their public
          site as of this writing, not a claim that it doesn&apos;t exist.
        </p>

        <h2 className="mt-12 font-syne text-2xl font-bold text-white">Who each is built for</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300 mb-2">BlackOut</p>
            <p className="text-sm leading-relaxed text-secondary">
              Traders who want one desk covering gamma, institutional flow, dark pool, and 0DTE
              execution together — with every graded play logged publicly, wins and losses both.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">SpotGamma</p>
            <p className="text-sm leading-relaxed text-secondary">
              An established, broker/charting-integrated GEX platform across a wide universe of
              tickers, with daily written commentary from its founder.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
          >
            See BlackOut plans →
          </Link>
          <Link
            href="/track-record"
            className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
          >
            See the graded track record →
          </Link>
        </div>

        <p className="mt-10 font-mono text-[11px] leading-relaxed text-sky-300/50">
          This page is an independent comparison for traders evaluating options-analytics
          platforms. BlackOut is not affiliated with SpotGamma. Nothing here is financial advice.
        </p>
      </section>
    </MarketingPageShell>
  );
}
